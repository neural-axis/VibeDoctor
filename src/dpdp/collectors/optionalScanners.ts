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
  if (status?.status === "error" || status?.status === "timeout") {
    return {
      id,
      status: "error",
      cause: status.status === "timeout" ? "timed_out" : "failed",
      message: status.stderr.trim() || status.stdout.trim() || `${id} failed`,
      remediation: `Run \`vibedoctor tool retry ${id}\` to see the full output.`
    };
  }
  return {
    id,
    status: "available",
    cause: "ran",
    message: `Reused ${id} scan; ${mapped} scoped finding(s) contributed to DPDP evidence`,
    resolvedVia: status?.resolvedPath,
    signalsContributed: mapped
  };
}

/**
 * Whether a shared scan result can stand in for a DPDP-scoped run.
 *
 * DPDP runs these scanners under a context that forces privacy checks on, so a
 * shared result that was skipped for a configuration reason says nothing about
 * whether the scanner works — inheriting that skip is what reported an installed
 * Presidio as unavailable for DPDP.
 *
 * A skip caused by the tool being absent is different: it is authoritative, and
 * retrying under a different config would only spend time failing again.
 */
function canReuseExecution(execution: SharedToolExecution | undefined): execution is SharedToolExecution {
  if (!execution) {
    return false;
  }
  // An entry with no process status came from an adapter that did its work
  // in-process, so the results stand.
  if (!execution.status) {
    return true;
  }
  if (execution.status.status !== "skipped") {
    return true;
  }
  return Boolean(execution.status.installHint);
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
        {
          id: "presidio",
          status: "skipped",
          cause: "quick_mode",
          message: "Skipped in quick mode",
          remediation: "Run `vibedoctor dpdp scan --full` for evidence from the optional scanners."
        },
        {
          id: "semgrep",
          status: "skipped",
          cause: "quick_mode",
          message: "Skipped in quick mode",
          remediation: "Run `vibedoctor dpdp scan --full` for evidence from the optional scanners."
        }
      ]
    };
  }

  // --- Presidio (default on; opt out with use_presidio: false) ---
  const wantPresidio = dpdp.usePresidio;
  if (!wantPresidio) {
    capabilities.push({
      id: "presidio",
      status: "skipped",
      cause: "opted_out",
      message: "Opted out (set checks.dpdp.use_presidio: true to re-enable for DPDP evidence)",
      remediation: "Set checks.dpdp.use_presidio: true in vibedoctor.yml."
    });
  } else if (candidates.length === 0) {
    capabilities.push({
      id: "presidio",
      status: "skipped",
      cause: "nothing_in_scope",
      message: "No DPDP candidate files in scope",
      remediation: "Widen checks.dpdp.include or paths.include in vibedoctor.yml."
    });
  } else {
    try {
      const shared = ctx.sharedToolResults?.presidio;
      const reused = canReuseExecution(shared) ? shared : undefined;
      // Note why the shared result could not be reused, so a fresh attempt that
      // also fails can report both facts instead of only the second one.
      const sharedSkipReason =
        shared && !reused ? shared.status?.installHint ?? shared.status?.stderr?.trim() : undefined;

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
            cause: "not_applicable",
            message: "Presidio not selected for this project",
            remediation: "Set checks.privacy.enabled and checks.dpdp.use_presidio to true in vibedoctor.yml."
          });
        } else {
          const result = await presidioAdapter.runStandalone?.(presidioCtx);
          const status = result?.status;
          if (!result || status?.status === "skipped") {
            const detail =
              status?.installHint ?? status?.stderr?.trim() ?? "Presidio could not be started in the project Python environment.";
            capabilities.push({
              id: "presidio",
              status: "skipped",
              cause: "not_installed",
              message: sharedSkipReason
                ? `${detail} (the privacy scan also skipped Presidio: ${sharedSkipReason})`
                : detail,
              remediation:
                "Install it in the interpreter the scanner uses: python -m pip install presidio-analyzer, then run `vibedoctor setup --apply` to confirm it resolves."
            });
          } else if (status?.status === "error" || status?.status === "timeout") {
            capabilities.push({
              id: "presidio",
              status: "error",
              cause: status.status === "timeout" ? "timed_out" : "failed",
              message: status.stderr?.trim() || status.stdout?.trim() || "Presidio failed",
              remediation: "Run `vibedoctor tool retry presidio` to see the full output."
            });
          } else {
            findings.push(...result.findings);
            for (const finding of result.findings) {
              mapPrivacyLikeFindingToSignals(finding, signals, dpdp.minConfidenceToReport, "presidio");
            }
            capabilities.push({
              id: "presidio",
              status: "available",
              cause: "ran",
              message: `Presidio contributed ${result.findings.length} finding(s) to DPDP evidence`,
              resolvedVia: status?.resolvedPath,
              signalsContributed: result.findings.length
            });
          }
        }
      }
    } catch (error) {
      capabilities.push({
        id: "presidio",
        status: "error",
        cause: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // --- Semgrep (default on; opt out with use_semgrep: false) ---
  if (!dpdp.useSemgrep) {
    capabilities.push({
      id: "semgrep",
      status: "skipped",
      cause: "opted_out",
      message: "Opted out (set checks.dpdp.use_semgrep: true to re-enable for DPDP evidence)",
      remediation: "Set checks.dpdp.use_semgrep: true in vibedoctor.yml."
    });
  } else if (candidates.length === 0) {
    capabilities.push({
      id: "semgrep",
      status: "skipped",
      cause: "nothing_in_scope",
      message: "No DPDP candidate files in scope",
      remediation: "Widen checks.dpdp.include or paths.include in vibedoctor.yml."
    });
  } else {
    try {
      const sharedSemgrep = ctx.sharedToolResults?.semgrep;
      const reused = canReuseExecution(sharedSemgrep) ? sharedSemgrep : undefined;
      const sharedSkipReason =
        sharedSemgrep && !reused ? sharedSemgrep.status?.installHint ?? sharedSemgrep.status?.stderr?.trim() : undefined;
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
            cause: "not_applicable",
            message: "Semgrep not applicable for this project",
            remediation: "Semgrep needs source files in a language it supports; widen paths.include if that is wrong."
          });
        } else if (!semgrepAdapter.buildScanCommand || !semgrepAdapter.parseResult) {
          capabilities.push({
            id: "semgrep",
            status: "skipped",
            cause: "not_applicable",
            message: "Semgrep adapter cannot run in this build",
            remediation: "This is a packaging problem, not a configuration one; please report it."
          });
        } else {
          const command = semgrepAdapter.buildScanCommand(semgrepCtx);
          // Honour the configured budget here too. The adapter's own default is
          // not the user's setting, and a DPDP scan that ignores
          // runtime.tool_timeouts can outlast the whole scan it belongs to.
          const timeoutSeconds =
            ctx.config.runtime.toolTimeouts.semgrep ?? ctx.config.runtime.defaultTimeoutSeconds;
          command.timeoutMs = Math.max(1, timeoutSeconds) * 1000;
          const toolResult = await runCommand(command, semgrepAdapter.installHint);
          if (toolResult.status === "skipped") {
            capabilities.push({
              id: "semgrep",
              status: "skipped",
              cause: "not_installed",
              message: (() => {
                const detail =
                  toolResult.installHint ?? toolResult.stderr?.trim() ?? "Semgrep not installed (never counted as pass)";
                return sharedSkipReason ? `${detail} (the main scan also skipped Semgrep: ${sharedSkipReason})` : detail;
              })(),
              remediation: "Install Semgrep (pipx install semgrep), then run `vibedoctor setup --apply` to confirm it resolves."
            });
          } else if (toolResult.status === "error" || toolResult.status === "timeout") {
            capabilities.push({
              id: "semgrep",
              status: "error",
              cause: toolResult.status === "timeout" ? "timed_out" : "failed",
              message:
                toolResult.status === "timeout"
                  ? `Semgrep exceeded its ${Math.round(toolResult.durationMs / 1000)}s budget, so its rules did not run over DPDP candidates.`
                  : toolResult.stderr?.trim() || "Semgrep failed",
              remediation:
                toolResult.status === "timeout"
                  ? "Raise runtime.tool_timeouts.semgrep in vibedoctor.yml, or narrow checks.dpdp.include."
                  : "Run `vibedoctor tool retry semgrep` to see the full output."
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
              cause: "ran",
              message: `Semgrep ran (${semgrepFindings.length} finding(s); ${mapped} privacy-relevant mapped to DPDP evidence)`,
              resolvedVia: toolResult.resolvedPath,
              signalsContributed: mapped
            });
          }
        }
      }
    } catch (error) {
      capabilities.push({
        id: "semgrep",
        status: "error",
        cause: "failed",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  return { signals, capabilities, findings };
}
