import { presidioAdapter } from "../../adapters/presidio";
import { semgrepAdapter } from "../../adapters/semgrep";
import type { SharedToolExecution, ToolAdapterContext } from "../../adapters/shared";
import type { Finding } from "../../core/finding";
import { runCommand } from "../../core/toolRunner";
import type { DataCategory, DpdpCapabilityStatus, TechnicalSignalBag } from "../types";
import { confidenceMeetsThreshold } from "./confidence";
import { classifyPrivacyFindingTags } from "./privacyBridge";
import { pushSignal } from "./shared";
import { redactLikelyPii } from "../evidence";

const ENTITY_TO_CATEGORY: Record<string, DataCategory> = {
  aadhaar: "aadhaar",
  pan: "pan",
  passport: "passport",
  email: "email",
  phone: "phone",
  phone_number: "phone",
  date_of_birth: "date_of_birth",
  date_time: "date_of_birth",
  address: "postal_address",
  location: "location",
  ip_address: "ip_device_id",
  ip: "ip_device_id",
  device_id: "ip_device_id",
  credit_card: "financial_payment",
  payment_card: "financial_payment",
  iban: "financial_payment",
  bank_account: "financial_payment",
  medical_license: "health_disability",
  person: "name",
  nrp: "other_personal",
  us_ssn: "other_personal",
  url: "other_personal"
};

function sanitizeSnippet(snippet: string | undefined): string | undefined {
  return snippet ? redactLikelyPii(snippet) : undefined;
}

function mapPrivacyLikeFindingToSignals(
  finding: Finding,
  signals: TechnicalSignalBag[],
  minConfidence: "low" | "medium" | "high",
  provenance: "presidio" | "semgrep"
): void {
  if (!confidenceMeetsThreshold(finding.confidence, minConfidence)) {
    return;
  }

  const entity = finding.evidence?.entityType ?? finding.tags.find((tag) => tag !== "privacy") ?? "other_personal";
  const category = ENTITY_TO_CATEGORY[entity.toLowerCase()] ?? "other_personal";
  const snippet = sanitizeSnippet(finding.evidence?.snippet ?? finding.evidence?.maskedValue);
  const detectionMethod = finding.evidence?.matchedPattern ?? provenance;
  const detectionPath = finding.evidence?.detectionPath ?? provenance;
  const tags = [
    provenance,
    entity.toLowerCase(),
    ...(finding.tags ?? []),
    ...classifyPrivacyFindingTags(finding.file, detectionMethod, detectionPath)
  ];

  pushSignal(signals, {
    kind: finding.evidence?.fieldPath ? "field" : "category",
    file: finding.file,
    line: finding.startLine,
    category,
    field: finding.evidence?.fieldPath,
    summary: `${finding.title} (${entity})`,
    snippet,
    confidence: finding.confidence,
    confidenceScore: finding.evidence?.confidenceScore,
    tags,
    detectionMethod: `${provenance}:${detectionMethod}`,
    provenance,
    certainty: finding.confidence === "high" ? "confirmed" : "inferred",
    relatedControls: ["DPDP-APP-001", "DPDP-SEC-007"]
  });

  const blob = `${finding.title} ${finding.message} ${finding.tags.join(" ")}`.toLowerCase();
  if (/log|logger|unsanitized/.test(blob)) {
    pushSignal(signals, {
      kind: "safeguard_gap",
      file: finding.file,
      line: finding.startLine,
      category,
      summary: "Potential PII in logging path (optional scanner)",
      snippet,
      confidence: finding.confidence,
      tags: ["pii-in-logs", provenance],
      detectionMethod: `${provenance}-log`,
      provenance,
      relatedControls: ["DPDP-SEC-001"]
    });
  }
  if (/secret|password|credential|hardcoded|api[_-]?key/.test(blob)) {
    pushSignal(signals, {
      kind: "safeguard_gap",
      file: finding.file,
      line: finding.startLine,
      category,
      summary: "Potential credential or sensitive secret signal (optional scanner)",
      snippet,
      confidence: finding.confidence,
      tags: ["hardcoded-secret", provenance],
      detectionMethod: `${provenance}-secret`,
      provenance,
      relatedControls: ["DPDP-SEC-007", "DPDP-SEC-010"]
    });
  }
}

function isPrivacyRelevantSemgrep(finding: Finding): boolean {
  const blob = `${finding.id} ${finding.title} ${finding.message} ${(finding.tags ?? []).join(" ")}`.toLowerCase();
  return /pii|privacy|secret|password|credential|token|personal|gdpr|log|auth|jwt|cookie|ssn|aadhaar|pan|email|phone|encrypt|mask|redact/.test(
    blob
  );
}

function inCandidateScope(finding: Finding, candidates: Set<string>): boolean {
  if (!finding.file) {
    return false;
  }
  return candidates.has(finding.file.replaceAll("\\", "/"));
}

function scopedScannerContext(ctx: ToolAdapterContext, candidates: string[]): ToolAdapterContext {
  return {
    ...ctx,
    project: { ...ctx.project, projectFiles: candidates },
    config: {
      ...ctx.config,
      paths: {
        ...ctx.config.paths,
        // Candidates have already passed global + DPDP include/exclude resolution.
        include: candidates,
        exclude: []
      }
    }
  };
}

function capabilityFromExecution(
  id: "presidio" | "semgrep",
  execution: SharedToolExecution,
  mapped: number
): DpdpCapabilityStatus {
  const status = execution.status;
  if (status?.status === "skipped") {
    return {
      id,
      status: "skipped",
      message: status.installHint ?? (status.stderr.trim() || `${id} was unavailable (never counted as pass)`)
    };
  }
  if (status?.status === "error" || status?.status === "timeout") {
    return {
      id,
      status: "error",
      message: status.stderr.trim() || status.stdout.trim() || `${id} failed`
    };
  }
  return {
    id,
    status: "available",
    message: `Reused ${id} scan; ${mapped} scoped finding(s) contributed to DPDP evidence`
  };
}

/**
 * Run opt-out optional scanners (Presidio, Semgrep) when enabled.
 * Missing tools are skipped — never counted as a pass.
 */
export async function collectOptionalScannerSignals(
  ctx: ToolAdapterContext,
  candidates: string[],
  options: { enabled?: boolean } = {}
): Promise<{
  signals: TechnicalSignalBag[];
  capabilities: DpdpCapabilityStatus[];
  findings: Finding[];
}> {
  const dpdp = ctx.config.checks.dpdp;
  const signals: TechnicalSignalBag[] = [];
  const capabilities: DpdpCapabilityStatus[] = [];
  const findings: Finding[] = [];
  const candidateSet = new Set(candidates.map((file) => file.replaceAll("\\", "/")));

  if (options.enabled === false) {
    return {
      signals,
      findings,
      capabilities: [
        { id: "presidio", status: "skipped", message: "Skipped in quick mode" },
        { id: "semgrep", status: "skipped", message: "Skipped in quick mode" }
      ]
    };
  }

  // --- Presidio (default on; opt out with use_presidio: false) ---
  const wantPresidio = dpdp.usePresidio;
  if (!wantPresidio) {
    capabilities.push({
      id: "presidio",
      status: "skipped",
      message: "Opted out (set checks.dpdp.use_presidio: true to re-enable for DPDP evidence)"
    });
  } else if (candidates.length === 0) {
    capabilities.push({ id: "presidio", status: "skipped", message: "No DPDP candidate files in scope" });
  } else {
    try {
      const reused = ctx.sharedToolResults?.presidio;
      if (reused) {
        const scopedFindings = reused.findings.filter((finding) => inCandidateScope(finding, candidateSet));
        findings.push(...scopedFindings);
        for (const finding of scopedFindings) {
          mapPrivacyLikeFindingToSignals(finding, signals, dpdp.minConfidenceToReport, "presidio");
        }
        capabilities.push(capabilityFromExecution("presidio", reused, scopedFindings.length));
      } else {
        const baseCtx = scopedScannerContext(ctx, candidates);
        const presidioCtx: ToolAdapterContext = {
          ...baseCtx,
          config: {
            ...baseCtx.config,
            checks: {
              ...baseCtx.config.checks,
              privacy: {
                ...baseCtx.config.checks.privacy,
                enabled: true,
                presidio: { enabled: true },
                minConfidenceToReport: dpdp.minConfidenceToReport,
                maskExamples: dpdp.maskExamples
              }
            }
          }
        };

        if (!(await presidioAdapter.detect(presidioCtx.project, presidioCtx.config))) {
          capabilities.push({
            id: "presidio",
            status: "skipped",
            message: "Presidio not selected for this project"
          });
        } else {
          const result = await presidioAdapter.runStandalone?.(presidioCtx);
          const status = result?.status;
          if (!result || status?.status === "skipped") {
            capabilities.push({
              id: "presidio",
              status: "skipped",
              message:
                status?.installHint ??
                status?.stderr?.trim() ??
                "Presidio not installed or unavailable (never counted as pass)"
            });
          } else if (status?.status === "error" || status?.status === "timeout") {
            capabilities.push({
              id: "presidio",
              status: "error",
              message: status.stderr?.trim() || status.stdout?.trim() || "Presidio failed"
            });
          } else {
            findings.push(...result.findings);
            for (const finding of result.findings) {
              mapPrivacyLikeFindingToSignals(finding, signals, dpdp.minConfidenceToReport, "presidio");
            }
            capabilities.push({
              id: "presidio",
              status: "available",
              message: `Presidio contributed ${result.findings.length} finding(s) to DPDP evidence`
            });
          }
        }
      }
    } catch (error) {
      capabilities.push({
        id: "presidio",
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // --- Semgrep (default on; opt out with use_semgrep: false) ---
  if (!dpdp.useSemgrep) {
    capabilities.push({
      id: "semgrep",
      status: "skipped",
      message: "Opted out (set checks.dpdp.use_semgrep: true to re-enable for DPDP evidence)"
    });
  } else if (candidates.length === 0) {
    capabilities.push({ id: "semgrep", status: "skipped", message: "No DPDP candidate files in scope" });
  } else {
    try {
      const reused = ctx.sharedToolResults?.semgrep;
      if (reused) {
        const scopedFindings = reused.findings.filter((finding) => inCandidateScope(finding, candidateSet));
        findings.push(...scopedFindings);
        let mapped = 0;
        for (const finding of scopedFindings) {
          if (isPrivacyRelevantSemgrep(finding)) {
            mapped += 1;
            mapPrivacyLikeFindingToSignals(finding, signals, dpdp.minConfidenceToReport, "semgrep");
          }
        }
        capabilities.push(capabilityFromExecution("semgrep", reused, mapped));
      } else {
        const semgrepCtx = scopedScannerContext(ctx, candidates);
        if (!(await semgrepAdapter.detect(semgrepCtx.project, semgrepCtx.config))) {
          capabilities.push({
            id: "semgrep",
            status: "skipped",
            message: "Semgrep not applicable for this project"
          });
        } else if (!semgrepAdapter.buildScanCommand || !semgrepAdapter.parseResult) {
          capabilities.push({
            id: "semgrep",
            status: "skipped",
            message: "Semgrep adapter cannot run in this build"
          });
        } else {
          const command = semgrepAdapter.buildScanCommand(semgrepCtx);
          const toolResult = await runCommand(command, semgrepAdapter.installHint);
          if (toolResult.status === "skipped") {
            capabilities.push({
              id: "semgrep",
              status: "skipped",
              message:
                toolResult.installHint ??
                toolResult.stderr?.trim() ??
                "Semgrep not installed (never counted as pass)"
            });
          } else if (toolResult.status === "error" || toolResult.status === "timeout") {
            capabilities.push({
              id: "semgrep",
              status: "error",
              message: toolResult.stderr?.trim() || "Semgrep failed"
            });
          } else {
            const semgrepFindings = semgrepAdapter.parseResult(toolResult, semgrepCtx);
            findings.push(...semgrepFindings);
            let mapped = 0;
            for (const finding of semgrepFindings) {
              if (!isPrivacyRelevantSemgrep(finding)) {
                continue;
              }
              mapped += 1;
              mapPrivacyLikeFindingToSignals(finding, signals, dpdp.minConfidenceToReport, "semgrep");
            }
            capabilities.push({
              id: "semgrep",
              status: "available",
              message: `Semgrep ran (${semgrepFindings.length} finding(s); ${mapped} privacy-relevant mapped to DPDP evidence)`
            });
          }
        }
      }
    } catch (error) {
      capabilities.push({
        id: "semgrep",
        status: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { signals, capabilities, findings };
}
