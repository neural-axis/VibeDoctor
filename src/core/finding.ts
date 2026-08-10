import { createHash } from "node:crypto";
import path from "node:path";

export const FINDING_SOURCES = [
  "ruff",
  "biome",
  "tsc",
  "pyright",
  "semgrep",
  "gitleaks",
  "osv-scanner",
  "knip",
  "vulture",
  "deptry",
  "jscpd",
  "lizard",
  "radon",
  "coverage.py",
  "vitest",
  "jest",
  "privacy-detector",
  "presidio",
  "privacy-ai-review",
  "telemetry-detector",
  "dpdp",
  "custom-leftovers",
  "custom-refactor",
  "custom-dead-chain"
] as const;

export const FINDING_CATEGORIES = [
  "security",
  "correctness",
  "dead_code",
  "leftovers",
  "maintainability",
  "dependencies",
  "tests",
  "privacy",
  "efficiency",
  "refactor_readiness"
] as const;

export type FindingSource = (typeof FINDING_SOURCES)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

/**
 * How strongly the evidence supports the claim, independent of how bad the claim
 * would be if true.
 *
 * Severity and confidence together could not express the difference between "we
 * traced this data into a log call" and "a variable name looked like an email
 * field", so both were presented the same way. Reports that mix the two read as
 * stronger than the evidence supports.
 */
export type EvidenceGrade =
  /** A code path was followed and the claim holds. */
  | "verified"
  /** A concrete match exists at a real location; its meaning is inferred. */
  | "observed"
  /** Inferred from names, patterns, or shape rather than behaviour. */
  | "heuristic"
  /** Neither presence nor absence could be established from the code. */
  | "unproven";

/**
 * For findings that assert something is missing, whether the absence is a fact
 * or a limit of static analysis. A missing control and an unprovable control
 * need different responses, and conflating them inflates readiness scores.
 */
export type AbsenceClaim = "control_absent" | "not_statically_provable" | "not_applicable";

/** How precisely the finding is anchored in the source. */
export type LocationQuality =
  /** File, line, and column. */
  | "exact"
  /** File and line. */
  | "line_only"
  /** File only; the tool reported no position. */
  | "file_only"
  /** No file; the claim is about the repository as a whole. */
  | "repository";

/** Where a finding stands relative to the recorded baseline. */
export type BaselineState =
  /** Not in the baseline. */
  | "new"
  /** In the baseline; pre-existing debt. */
  | "existing"
  /** In the baseline but previously suppressed, and the suppression has lapsed. */
  | "resurfaced";

/** One hop in a traced data path, for findings that follow data rather than match text. */
export type DataFlowStep = {
  kind: "source" | "store" | "transform" | "processor" | "sink";
  /** What this step is, in the repository's own terms ("sessionStorage", "OpenAI chat completion"). */
  label: string;
  file?: string;
  startLine?: number;
  /** How this specific hop was established. */
  evidenceGrade: EvidenceGrade;
  detail?: string;
};

/** What kind of work a fix actually is, so it reaches the right person. */
export type RemediationKind = "code" | "config" | "dependency" | "policy" | "human_review";

export type FindingRemediation = {
  kind: RemediationKind;
  /** The component or module that owns the fix. */
  component?: string;
  steps: string[];
  /** What would have to be shown for this finding to be considered resolved. */
  requiredEvidence?: string;
  /** Set when the fix is not something an automated agent should attempt. */
  requiresHumanDecision?: boolean;
};

/** Dependency identity, so advisories can be triaged rather than just counted. */
export type PackageReference = {
  name: string;
  version?: string;
  ecosystem?: string;
  /** Runtime exposure. A dev-only advisory is not equivalent to a shipped one. */
  scope: "runtime" | "dev" | "optional" | "transitive" | "unknown";
  /** Path from a direct dependency to this package. */
  dependencyPath?: string[];
  /** First version that resolves the advisory. */
  fixedIn?: string;
  /** Manifest or lockfile the dependency was read from. */
  manifest?: string;
};

export type FindingSuppression = {
  /** Suppression rule that matched. */
  ruleId: string;
  classification: "false_positive" | "accepted_risk" | "deferred" | "fixture";
  reason: string;
  owner?: string;
  /** ISO date. A suppression without an expiry is a permanent exemption. */
  expiresAt?: string;
  expired: boolean;
};

export type Finding = {
  id: string;
  source: FindingSource;
  category: FindingCategory;
  severity: Severity;
  confidence: Confidence;
  title: string;
  message: string;
  file?: string;
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  endColumn?: number;
  isNew: boolean;
  isAutofixable: boolean;
  safeToAutofix: boolean;
  fixCommand?: string;
  agentInstruction?: string;
  tags: string[];

  /** How well the evidence supports the claim. Defaults per source at normalization. */
  evidenceGrade?: EvidenceGrade;
  /** Only meaningful for findings asserting something is missing. */
  absenceClaim?: AbsenceClaim;
  /** Set by the normalizer from whichever position fields the tool supplied. */
  locationQuality?: LocationQuality;
  /** Traced path from data source to sink, when the finding follows data. */
  dataFlow?: DataFlowStep[];
  remediation?: FindingRemediation;
  package?: PackageReference;

  /** Position relative to the baseline. `isNew` stays as the boolean shorthand. */
  baselineState?: BaselineState;
  /** True when the finding sits in a file changed on this branch. */
  inChangedFile?: boolean;
  /** Role of the containing file, used for relevance decisions. */
  fileRole?: "source" | "test" | "fixture" | "generated" | "vendor" | "config" | "docs" | "unknown";
  /** Ranking score used to order and cap output. Higher is more worth reading. */
  priority?: number;
  /**
   * Other tools that independently reported the same problem. Agreement between
   * tools is the cheapest available corroboration, and it lets noisy detectors
   * be filtered down to their cross-validated subset.
   */
  corroboratedBy?: string[];
  /** Present when a suppression rule matched this finding. */
  suppression?: FindingSuppression;

  evidence?: {
    snippet?: string;
    toolRawId?: string;
    matchedPattern?: string;
    detector?: string;
    entityType?: string;
    sensitivity?: string;
    maskedValue?: string;
    fieldPath?: string;
    detectionPath?: string;
    confidenceScore?: number;
    coverageConfidence?: number;
    reviewState?: "confirmed" | "likely" | "false_positive" | "needs_human_review";
    reviewedAt?: string;
    reviewedBy?: string;
    rationale?: string;
    recommendedAction?: string;
    reasons?: string[];
    /**
     * Byte offset into the file, when a tool reports positions that way. The
     * normalizer converts it to a line number so no tool's locations are lost
     * just because it uses a different position model.
     */
    startOffset?: number;
    endOffset?: number;
  };
  scoreImpact: number;
};

export function isFindingCategory(value: string): value is FindingCategory {
  return FINDING_CATEGORIES.includes(value as FindingCategory);
}

export function parseFindingCategoryList(value: string | undefined): FindingCategory[] | undefined {
  if (!value) {
    return undefined;
  }

  const categories = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  const invalid = categories.filter((category) => !isFindingCategory(category));
  if (invalid.length > 0) {
    throw new Error(`Unsupported finding categories: ${invalid.join(", ")}`);
  }

  return categories as FindingCategory[];
}

export type BaselineEntry = {
  fingerprint: string;
};

export function normalizeFilePath(file: string | undefined, root: string): string | undefined {
  if (!file) {
    return undefined;
  }

  const normalized = file.replaceAll("/", path.sep);
  const relative = path.isAbsolute(normalized) ? path.relative(root, normalized) : normalized;
  return relative.split(path.sep).join("/");
}

export function stableSnippetHash(value: string | undefined): string {
  return createHash("sha1").update(value?.trim().toLowerCase() ?? "").digest("hex").slice(0, 12);
}

export function fingerprintFinding(finding: Finding): string {
  const payload = [
    finding.category,
    finding.source,
    finding.title,
    finding.file ?? "",
    finding.evidence?.snippet ? "" : String(finding.startLine ?? ""),
    stableSnippetHash(finding.evidence?.snippet ?? finding.message)
  ].join(":");

  return createHash("sha1").update(payload).digest("hex");
}

export function applyBaseline(findings: Finding[], baselineFingerprints: Set<string>): Finding[] {
  return findings.map((finding) => {
    const isNew = !baselineFingerprints.has(fingerprintFinding(finding));
    return {
      ...finding,
      id: finding.id || fingerprintFinding(finding),
      isNew,
      // A finding whose suppression has lapsed is neither new nor quietly
      // pre-existing: it was deliberately hidden and that decision has expired.
      baselineState: finding.suppression?.expired ? "resurfaced" : isNew ? "new" : "existing"
    } satisfies Finding;
  });
}

function dedupeKey(finding: Finding): string {
  return [
    finding.category,
    finding.file ?? "",
    finding.startLine ?? "",
    finding.title.toLowerCase(),
    finding.message.replace(/\s+/g, " ").trim().toLowerCase()
  ].join("|");
}

const severityOrder: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

const confidenceOrder: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const evidenceGradeOrder: Record<EvidenceGrade, number> = {
  unproven: 0,
  heuristic: 1,
  observed: 2,
  verified: 3
};

const locationQualityOrder: Record<LocationQuality, number> = {
  repository: 0,
  file_only: 1,
  line_only: 2,
  exact: 3
};

/**
 * When two tools report the same problem, keep the better-supported version of
 * each fact rather than whichever arrived first: the stronger evidence grade,
 * the more precise location, and any structured detail the other tool lacked.
 */
function mergeEvidenceGrade(left: Finding, right: Finding): EvidenceGrade | undefined {
  if (!left.evidenceGrade) {
    return right.evidenceGrade;
  }
  if (!right.evidenceGrade) {
    return left.evidenceGrade;
  }
  return evidenceGradeOrder[right.evidenceGrade] > evidenceGradeOrder[left.evidenceGrade]
    ? right.evidenceGrade
    : left.evidenceGrade;
}

function preferPreciseLocation(left: Finding, right: Finding): Pick<Finding, "startLine" | "endLine" | "startColumn" | "endColumn" | "locationQuality"> {
  const leftRank = locationQualityOrder[left.locationQuality ?? "file_only"];
  const rightRank = locationQualityOrder[right.locationQuality ?? "file_only"];
  const winner = rightRank > leftRank ? right : left;
  return {
    startLine: winner.startLine,
    endLine: winner.endLine,
    startColumn: winner.startColumn,
    endColumn: winner.endColumn,
    locationQuality: winner.locationQuality
  };
}

export function dedupeFindings(findings: Finding[]): Finding[] {
  const byKey = new Map<string, Finding>();

  for (const finding of findings) {
    const key = dedupeKey(finding);
    const existing = byKey.get(key);

    if (!existing) {
      byKey.set(key, finding);
      continue;
    }

    byKey.set(key, {
      ...existing,
      source: severityOrder[finding.severity] > severityOrder[existing.severity] ? finding.source : existing.source,
      severity: severityOrder[finding.severity] > severityOrder[existing.severity] ? finding.severity : existing.severity,
      confidence:
        confidenceOrder[finding.confidence] > confidenceOrder[existing.confidence]
          ? finding.confidence
          : existing.confidence,
      isAutofixable: existing.isAutofixable || finding.isAutofixable,
      safeToAutofix: existing.safeToAutofix || finding.safeToAutofix,
      tags: Array.from(new Set([...existing.tags, ...finding.tags])),
      evidence: existing.evidence ?? finding.evidence,
      fixCommand: existing.fixCommand ?? finding.fixCommand,
      agentInstruction: existing.agentInstruction ?? finding.agentInstruction,
      ...preferPreciseLocation(existing, finding),
      evidenceGrade: mergeEvidenceGrade(existing, finding),
      absenceClaim: existing.absenceClaim ?? finding.absenceClaim,
      dataFlow: existing.dataFlow ?? finding.dataFlow,
      remediation: existing.remediation ?? finding.remediation,
      package: existing.package ?? finding.package,
      fileRole: existing.fileRole ?? finding.fileRole,
      suppression: existing.suppression ?? finding.suppression,
      inChangedFile: existing.inChangedFile ?? finding.inChangedFile,
      // Two tools agreeing is itself corroboration, so record who else saw it.
      corroboratedBy: Array.from(
        new Set([...(existing.corroboratedBy ?? []), ...(finding.corroboratedBy ?? []), finding.source, existing.source])
      ).filter((source) => source !== existing.source),
      scoreImpact: Math.max(existing.scoreImpact, finding.scoreImpact)
    });
  }

  return Array.from(byKey.values());
}
