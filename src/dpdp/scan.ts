import { promises as fs } from "node:fs";
import path from "node:path";
import { applyBaseline, fingerprintFinding, type Finding } from "../core/finding";
import { loadBaseline } from "../core/baseline";
import { loadConfig, type VibeDoctorConfig } from "../core/config";
import { detectProject } from "../core/projectDetector";
import type { ToolAdapterContext } from "../adapters/shared";
import { LEGAL_SOURCE_MANIFEST_VERSION } from "./legalSources";
import { collectDpdpSignals } from "./collectors";
import { loadDeclaredEvidence, resolveDpdpContext, renderDefaultContextYaml, renderDefaultEvidenceYaml } from "./context";
import { evidenceFromSignal, sanitizeEvidenceForOutput } from "./evidence";
import { evaluateAllControls, attachDeclaredEvidenceIds } from "./evaluators";
import { buildPersonalDataMap } from "./dataMap";
import { controlResultsToFindings, syncControlIsNewFromFindings } from "./findings";
import { buildDpdpScores } from "./scoring";
import { buildReviewQueue } from "./reviewQueue";
import { loadCachedDpdpScanResult, writeDpdpArtifacts } from "./artifacts";
import { controlToGateCandidate, evaluateDpdpFailureGate } from "./gates";
import type {
  ControlResult,
  DpdpCapabilityStatus,
  DpdpScanMode,
  DpdpScanResult,
  EvidenceItem
} from "./types";

const DISCLAIMER =
  "VibeDoctor DPDP output is a technical readiness / engineering-risk assessment. It is not legal advice and not a DPDP compliance certification.";

export type RunDpdpScanOptions = {
  /** Reuse the engine's project/config and completed tool results during a normal scan. */
  context?: ToolAdapterContext;
  /** Quick scans deliberately skip slow external tools; direct DPDP scans default to enabled. */
  optionalScannersEnabled?: boolean;
};

export async function runDpdpScan(
  root: string,
  mode: DpdpScanMode = "full",
  options: RunDpdpScanOptions = {}
): Promise<DpdpScanResult> {
  const loaded = options.context ? undefined : await loadConfig(root);
  const config = options.context?.config ?? loaded!.config;
  const project = options.context?.project ?? (await detectProject(root, config.paths.exclude));
  const ctx: ToolAdapterContext = options.context
    ? { ...options.context, root, project, config }
    : {
        root,
        project,
        config,
        scanMode: mode === "changed" ? "changed" : mode === "full" ? "full" : "default"
      };

  const capabilities: DpdpCapabilityStatus[] = [
    { id: "privacy-detector", status: "available", message: "Built-in deterministic privacy detector (always on with DPDP)" }
  ];

  if (!config.checks.dpdp.enabled) {
    return emptyDisabledResult(root, mode, config, [
      ...capabilities,
      {
        id: "presidio",
        status: "skipped",
        message: "DPDP disabled"
      },
      {
        id: "semgrep",
        status: "skipped",
        message: "DPDP disabled"
      }
    ]);
  }

  const context = await resolveDpdpContext(root, config);
  const declared = await loadDeclaredEvidence(root, config.checks.dpdp.evidenceFile);
  const { signals, filesScanned, scope, scopeCapability, optionalCapabilities } = await collectDpdpSignals(ctx, {
    optionalScannersEnabled: options.optionalScannersEnabled ?? ctx.scanMode !== "quick"
  });

  // Presidio/Semgrep run by default (opt-out). Missing tools → skipped, never a pass.
  capabilities.push(...optionalCapabilities);

  if (scopeCapability) {
    capabilities.push(scopeCapability);
  } else if (mode === "full" || mode === "default") {
    capabilities.push({
      id: "changed-scope",
      status: "available",
      message: `Full repository collection scope (${scope})`
    });
  }

  const evidence: EvidenceItem[] = signals.map((signal) => sanitizeEvidenceForOutput(evidenceFromSignal(signal)));
  for (const assertion of declared) {
    evidence.push(
      sanitizeEvidenceForOutput({
        id: `declared:${assertion.id}`,
        kind: "declared_assertion",
        detectionMethod: "declared-evidence-file",
        confidence: "low",
        provenance: "declared",
        relatedControls: assertion.relatedControls,
        certainty: "declared",
        summary: assertion.statement,
        tags: ["declared", assertion.suppliedRole]
      })
    );
  }

  let controlResults = evaluateAllControls({
    signals,
    evidence,
    context,
    declared,
    capabilities
  });
  controlResults = attachDeclaredEvidenceIds(controlResults, declared);

  const generatedAt = new Date().toISOString();
  const evidenceById = new Map(evidence.map((item) => [item.id, item]));
  let findings = controlResultsToFindings(controlResults, evidenceById, capabilities);

  // Apply shared baseline fingerprints, then sync control isNew from findings.
  if (config.baseline.enabled) {
    const baseline = await loadBaseline(root, config.baseline.file);
    findings = applyBaseline(findings, new Set(baseline.findings.map((entry) => entry.fingerprint)));
  }
  controlResults = syncControlIsNewFromFindings(controlResults, findings, config.baseline.enabled);

  const scores = buildDpdpScores(controlResults, capabilities);
  const dataMap = buildPersonalDataMap(signals, evidence, controlResults, generatedAt);
  const reviewQueue = buildReviewQueue(controlResults);

  const fixNext = controlResults
    .filter((result) => result.status === "VIOLATED" || result.status === "PARTIAL")
    .sort((left, right) => severityRank(right.severity) - severityRank(left.severity))
    .slice(0, 10)
    .map((result) => ({
      controlId: result.controlId,
      title: result.title,
      severity: result.severity,
      remediation: result.remediation ?? "Review control evidence and remediate.",
      evidenceIds: result.evidenceIds
    }));

  const result: DpdpScanResult = {
    version: 1,
    generatedAt,
    root,
    mode,
    disclaimer: DISCLAIMER,
    scores,
    dataMap,
    controlMatrix: {
      version: 1,
      generatedAt,
      disclaimer: DISCLAIMER,
      legalSourceVersion: config.checks.dpdp.legalSourceVersion || LEGAL_SOURCE_MANIFEST_VERSION,
      controls: controlResults,
      summary: scores.statusCounts
    },
    evidenceLedger: {
      version: 1,
      generatedAt,
      disclaimer: DISCLAIMER,
      evidence,
      declared
    },
    reviewQueue,
    fixNext,
    capabilities: [
      ...capabilities,
      {
        id: "files-scanned",
        status: "available",
        message: `Scanned ${filesScanned} text file(s) for DPDP technical signals`
      }
    ],
    findings,
    legalSourceVersion: config.checks.dpdp.legalSourceVersion || LEGAL_SOURCE_MANIFEST_VERSION,
    context,
    baselineApplied: config.baseline.enabled
  };

  await writeDpdpArtifacts(root, result);
  return result;
}

function severityRank(severity: Finding["severity"]): number {
  return { info: 0, low: 1, medium: 2, high: 3, critical: 4 }[severity];
}

function emptyDisabledResult(
  root: string,
  mode: DpdpScanMode,
  config: VibeDoctorConfig,
  capabilities: DpdpCapabilityStatus[]
): DpdpScanResult {
  const generatedAt = new Date().toISOString();
  return {
    version: 1,
    generatedAt,
    root,
    mode,
    disclaimer: DISCLAIMER,
    scores: {
      technicalPostureScore: 0,
      evidenceCompletenessPercent: 0,
      openRiskBySeverity: { critical: 0, high: 0, medium: 0, low: 0, info: 0 },
      statusCounts: {
        verified: 0,
        violated: 0,
        partial: 0,
        notObserved: 0,
        needsContext: 0,
        notApplicable: 0,
        skipped: 0,
        error: 0,
        humanReview: 0,
        unresolved: 0
      },
      labels: {
        technicalPosture: "DPDP technical posture (not legal compliance)",
        evidenceCompleteness: "Evidence completeness (technical observability)",
        openRisk: "Open technical risk counts by severity"
      }
    },
    dataMap: {
      version: 1,
      generatedAt,
      disclaimer: DISCLAIMER,
      categories: [],
      collectionPoints: [],
      stores: [],
      externalRecipients: [],
      lifecycleSignals: [],
      safeguardGaps: [],
      relatedControls: [],
      graph: { nodes: [], edges: [] }
    },
    controlMatrix: {
      version: 1,
      generatedAt,
      disclaimer: DISCLAIMER,
      legalSourceVersion: config.checks.dpdp.legalSourceVersion,
      controls: [],
      summary: {
        verified: 0,
        violated: 0,
        partial: 0,
        notObserved: 0,
        needsContext: 0,
        notApplicable: 0,
        skipped: 0,
        error: 0,
        humanReview: 0,
        unresolved: 0
      }
    },
    evidenceLedger: { version: 1, generatedAt, disclaimer: DISCLAIMER, evidence: [], declared: [] },
    reviewQueue: [],
    fixNext: [],
    capabilities: [...capabilities, { id: "dpdp", status: "skipped", message: "checks.dpdp.enabled is false" }],
    findings: [],
    legalSourceVersion: config.checks.dpdp.legalSourceVersion,
    context: {
      version: 1,
      organization: { ...config.checks.dpdp.organization }
    },
    baselineApplied: false
  };
}

/**
 * Load cached DPDP artifacts when present; otherwise run a scan.
 * Prefer this for map/report/explain/handoff paths so repeated CLI/MCP calls avoid re-walking the tree.
 */
export async function loadOrScanDpdp(
  root: string,
  mode: DpdpScanMode = "full",
  refresh = false
): Promise<DpdpScanResult> {
  if (!refresh) {
    const cached = await loadCachedDpdpScanResult(root);
    if (cached) {
      return cached;
    }
  }
  return runDpdpScan(root, mode);
}

export async function explainDpdpTarget(
  root: string,
  id: string,
  options: { refresh?: boolean } = {}
): Promise<{ type: "control" | "finding" | "unknown"; payload: unknown; fromCache?: boolean }> {
  const refresh = options.refresh === true;
  const hadCache = !refresh && Boolean(await loadCachedDpdpScanResult(root));
  const result = await loadOrScanDpdp(root, "full", refresh);
  const control = result.controlMatrix.controls.find((item) => item.controlId === id);
  if (control) {
    const relatedEvidence = result.evidenceLedger.evidence.filter(
      (item) => control.evidenceIds.includes(item.id) || item.relatedControls.includes(control.controlId)
    );
    return {
      type: "control",
      fromCache: hadCache && !refresh,
      payload: {
        control,
        relatedEvidence,
        disclaimer: DISCLAIMER
      }
    };
  }

  const finding = result.findings.find((item) => item.id === id);
  if (finding) {
    return { type: "finding", fromCache: hadCache && !refresh, payload: { finding, disclaimer: DISCLAIMER } };
  }

  return {
    type: "unknown",
    fromCache: hadCache && !refresh,
    payload: { message: `No control or finding matched '${id}'`, disclaimer: DISCLAIMER }
  };
}

export function determineDpdpExitCode(result: DpdpScanResult, config: VibeDoctorConfig): number {
  return evaluateDpdpFailureGate(result.controlMatrix.controls.map(controlToGateCandidate), config) ? 1 : 0;
}

export async function initDpdpWorkspace(root: string): Promise<string[]> {
  const { config } = await loadConfig(root);
  const dir = path.join(root, ".vibedoctor", "dpdp");
  await fs.mkdir(dir, { recursive: true });
  const written: string[] = [];
  const contextPath = path.join(root, config.checks.dpdp.contextFile);
  const evidencePath = path.join(root, config.checks.dpdp.evidenceFile);
  await fs.mkdir(path.dirname(contextPath), { recursive: true });
  await fs.mkdir(path.dirname(evidencePath), { recursive: true });

  try {
    await fs.access(contextPath);
  } catch {
    await fs.writeFile(contextPath, renderDefaultContextYaml(), "utf8");
    written.push(config.checks.dpdp.contextFile);
  }

  try {
    await fs.access(evidencePath);
  } catch {
    await fs.writeFile(evidencePath, renderDefaultEvidenceYaml(), "utf8");
    written.push(config.checks.dpdp.evidenceFile);
  }

  written.push(".vibedoctor/dpdp/");
  return written;
}

export { fingerprintFinding };
