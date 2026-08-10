import { promises as fs } from "node:fs";
import path from "node:path";
import { assessCredential, extractAssignedValue, maskValue } from "./credentialHeuristics";
import { isSyntheticRole, type FileRole } from "./fileRole";
import type { Confidence, EvidenceGrade, Finding, Severity } from "./finding";

/**
 * Turns raw tool output into a report worth reading.
 *
 * Every scanner ships its own idea of what to report, and none of them know what
 * else ran. The result was a report where a type-checker's 857 pre-existing
 * findings, a dead-code detector's 12,060 low-confidence guesses, and three real
 * secrets all arrived as one flat list — so the real items were unreachable.
 *
 * The controls here are uniform across tools rather than patched into each
 * adapter: a confidence floor, awareness of what kind of file a finding sits in,
 * validation of claims that a value is a credential, ranking that puts new and
 * changed-code findings first, and a cap. Nothing is dropped silently: every
 * filter records what it withheld and why, and that reaches the report.
 */

export type RelevanceToolPolicy = {
  minConfidence?: Confidence;
  minEvidenceGrade?: EvidenceGrade;
  /** 0 means no cap. */
  maxFindings?: number;
  /** Only surface findings another tool also reported. */
  requireCorroboration?: boolean;
};

export type RelevanceConfig = {
  enabled: boolean;
  minConfidence: Confidence;
  maxFindingsPerTool: number;
  maxFindingsTotal: number;
  /** What to do with findings in tests, fixtures, generated, and vendored files. */
  syntheticFilePolicy: "keep" | "downgrade" | "drop";
  /** Check that findings claiming to be credentials look like credentials. */
  validateSecrets: boolean;
  perTool: Record<string, RelevanceToolPolicy>;
};

export const defaultRelevanceConfig: RelevanceConfig = {
  enabled: true,
  minConfidence: "low",
  maxFindingsPerTool: 200,
  maxFindingsTotal: 1000,
  syntheticFilePolicy: "downgrade",
  validateSecrets: true,
  perTool: {
    // Whole-repository dead-code guessing produces far more candidates than
    // anyone can triage, and its own confidence percentage is the best available
    // ranking signal. Report the defensible subset and say how many were held.
    vulture: { minConfidence: "medium", maxFindings: 50 },
    // Type-checkers report accumulated debt in full. The ranking below puts new
    // and changed-file findings first; the cap keeps the tail out of the report.
    pyright: { maxFindings: 150 },
    tsc: { maxFindings: 150 },
    // Duplication and complexity are advisory, and the top offenders are the
    // only actionable ones.
    jscpd: { maxFindings: 50 },
    lizard: { maxFindings: 50 },
    radon: { maxFindings: 50 }
  }
};

const confidenceRank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
const severityRank: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3, critical: 4 };
const evidenceGradeRank: Record<EvidenceGrade, number> = { unproven: 0, heuristic: 1, observed: 2, verified: 3 };

const severityOrder: Severity[] = ["info", "low", "medium", "high", "critical"];

function downgradeSeverity(severity: Severity, steps = 1): Severity {
  return severityOrder[Math.max(0, severityRank[severity] - steps)];
}

/** Reasons a finding did not reach the report. Each one is disclosed, never silent. */
export type WithholdReason =
  | "below_confidence_floor"
  | "below_evidence_floor"
  | "synthetic_file"
  | "not_corroborated"
  | "over_tool_cap"
  | "over_total_cap";

export type WithheldGroup = {
  reason: WithholdReason;
  count: number;
  detail: string;
  /** How to see the withheld findings if they are wanted. */
  remediation: string;
};

export type ToolRelevance = {
  tool: string;
  reported: number;
  surfaced: number;
  withheld: WithheldGroup[];
  /** Findings whose severity or confidence was adjusted rather than removed. */
  adjusted: number;
};

export type RelevanceReport = {
  enabled: boolean;
  perTool: ToolRelevance[];
  totalReported: number;
  totalSurfaced: number;
  /** Human-readable notes for the report footer. */
  notes: string[];
  /**
   * Set when these totals describe a wider set of findings than the report they
   * appear in (a category-filtered view), so the counts are not read as if they
   * applied to the filtered slice.
   */
  scopeNote?: string;
};

type WithholdRecord = { reason: WithholdReason; detail: string; remediation: string };

class ToolLedger {
  reported = 0;
  adjusted = 0;
  private readonly withheld = new Map<string, WithheldGroup>();

  record({ reason, detail, remediation }: WithholdRecord) {
    const key = `${reason}:${detail}`;
    const existing = this.withheld.get(key);
    if (existing) {
      existing.count += 1;
      return;
    }
    this.withheld.set(key, { reason, count: 1, detail, remediation });
  }

  toResult(tool: string, surfaced: number): ToolRelevance {
    return {
      tool,
      reported: this.reported,
      surfaced,
      adjusted: this.adjusted,
      withheld: Array.from(this.withheld.values()).sort((left, right) => right.count - left.count)
    };
  }
}

/**
 * Ranks a finding by how much it deserves a reader's attention. Severity leads,
 * but a new finding in code the author just touched outranks an older, nominally
 * more severe one they cannot act on right now.
 */
export function computePriority(finding: Finding): number {
  let priority = severityRank[finding.severity] * 10;
  priority += confidenceRank[finding.confidence] * 3;
  priority += evidenceGradeRank[finding.evidenceGrade ?? "observed"] * 3;

  if (finding.isNew) {
    priority += 8;
  }
  if (finding.inChangedFile) {
    priority += 6;
  }
  if (finding.baselineState === "resurfaced") {
    priority += 5;
  }
  priority += Math.min(3, finding.corroboratedBy?.length ?? 0) * 4;

  if (finding.fileRole && isSyntheticRole(finding.fileRole)) {
    priority -= 8;
  }
  if (finding.evidence?.reviewState === "false_positive") {
    priority -= 20;
  }
  if (finding.isAutofixable && finding.safeToAutofix) {
    priority += 2;
  }

  return priority;
}

type LineReader = (file: string, line: number) => Promise<string | undefined>;

function createLineReader(root: string): LineReader {
  const cache = new Map<string, string[] | undefined>();

  return async (file, line) => {
    if (!cache.has(file)) {
      try {
        cache.set(file, (await fs.readFile(path.join(root, file), "utf8")).split(/\r?\n/));
      } catch {
        cache.set(file, undefined);
      }
    }
    return cache.get(file)?.[line - 1];
  };
}

function isSecretClaim(finding: Finding): boolean {
  return (
    finding.tags.includes("secret") ||
    finding.source === "gitleaks" ||
    /secret|credential|api[- _]?key|token|password/i.test(finding.title)
  );
}

/**
 * Re-examines findings that claim to have found a credential. Scanners redact
 * their own output, so the source line the finding points at is the only place
 * the matched value can still be evaluated.
 */
async function validateSecretClaim(finding: Finding, readLine: LineReader): Promise<Finding> {
  if (!finding.file || finding.startLine === undefined) {
    return finding;
  }

  const line = await readLine(finding.file, finding.startLine);
  const candidate = extractAssignedValue(line);
  const assessment = assessCredential(candidate);

  if (assessment.verdict === "credential" || assessment.verdict === "unknown") {
    return assessment.verdict === "credential"
      ? {
          ...finding,
          evidenceGrade: "verified",
          evidence: {
            ...finding.evidence,
            rationale: assessment.reason,
            confidenceScore: Number(assessment.entropy.toFixed(2))
          }
        }
      : finding;
  }

  const isPlaceholder = assessment.verdict === "placeholder";

  return {
    ...finding,
    // Still reported, because a scanner match is a fact worth showing — but not
    // at a severity that implies a live credential is in the repository.
    severity: isPlaceholder ? "info" : downgradeSeverity(finding.severity, 2),
    confidence: "low",
    evidenceGrade: "heuristic",
    title: isPlaceholder ? `${finding.title} (placeholder value)` : `${finding.title} (likely not a credential)`,
    message: `${finding.message} Contextual check: ${assessment.reason}`,
    tags: Array.from(new Set([...finding.tags, "likely-false-positive"])),
    evidence: {
      ...finding.evidence,
      reviewState: "false_positive",
      rationale: assessment.reason,
      maskedValue: maskValue(candidate),
      confidenceScore: Number(assessment.entropy.toFixed(2))
    },
    remediation: {
      kind: "human_review",
      steps: [
        "Confirm the matched value is not a credential.",
        `Add an acknowledgement for rule "${finding.title}" in .vibedoctor/suppressions.yml to stop reporting it.`
      ],
      requiredEvidence: "Confirmation that the value is an identifier rather than a credential."
    }
  };
}

function syntheticNote(role: FileRole): string {
  switch (role) {
    case "fixture":
      return "test fixture";
    case "test":
      return "test file";
    case "generated":
      return "generated file";
    case "vendor":
      return "vendored dependency";
    default:
      return role;
  }
}

export type ApplyRelevanceOptions = {
  root: string;
  config: RelevanceConfig;
};

export type ApplyRelevanceResult = {
  findings: Finding[];
  report: RelevanceReport;
};

/**
 * Applies relevance controls to the deduped finding set. Runs after dedupe so
 * corroboration between tools is already recorded, and after the baseline so
 * new-versus-existing can drive ranking.
 */
export async function applyRelevance(
  findings: Finding[],
  options: ApplyRelevanceOptions
): Promise<ApplyRelevanceResult> {
  const { config } = options;
  const ledgers = new Map<string, ToolLedger>();

  function ledgerFor(tool: string): ToolLedger {
    const existing = ledgers.get(tool);
    if (existing) {
      return existing;
    }
    const created = new ToolLedger();
    ledgers.set(tool, created);
    return created;
  }

  for (const finding of findings) {
    ledgerFor(finding.source).reported += 1;
  }

  if (!config.enabled) {
    const ranked = findings.map((finding) => ({ ...finding, priority: computePriority(finding) }));
    return {
      findings: ranked,
      report: {
        enabled: false,
        perTool: Array.from(ledgers.entries()).map(([tool, ledger]) =>
          ledger.toResult(tool, ranked.filter((finding) => finding.source === tool).length)
        ),
        totalReported: findings.length,
        totalSurfaced: ranked.length,
        notes: ["Relevance filtering is disabled; every finding every tool reported is included."]
      }
    };
  }

  const readLine = createLineReader(options.root);
  const kept: Finding[] = [];

  for (const original of findings) {
    const policy = config.perTool[original.source] ?? {};
    const ledger = ledgerFor(original.source);
    let finding = original;

    if (config.validateSecrets && isSecretClaim(finding)) {
      const validated = await validateSecretClaim(finding, readLine);
      if (validated !== finding) {
        ledger.adjusted += 1;
        finding = validated;
      }
    }

    const role = finding.fileRole ?? "unknown";
    if (isSyntheticRole(role)) {
      if (config.syntheticFilePolicy === "drop") {
        ledger.record({
          reason: "synthetic_file",
          detail: `in a ${syntheticNote(role)}`,
          remediation: "Set relevance.synthetic_file_policy: downgrade in vibedoctor.yml to include these."
        });
        continue;
      }
      if (config.syntheticFilePolicy === "downgrade") {
        finding = {
          ...finding,
          severity: downgradeSeverity(finding.severity),
          tags: Array.from(new Set([...finding.tags, `role:${role}`]))
        };
        ledger.adjusted += 1;
      }
    }

    const floor = policy.minConfidence ?? config.minConfidence;
    if (confidenceRank[finding.confidence] < confidenceRank[floor]) {
      ledger.record({
        reason: "below_confidence_floor",
        detail: `${finding.confidence} confidence, below the ${floor} floor for ${finding.source}`,
        remediation: `Lower relevance.per_tool.${finding.source}.min_confidence in vibedoctor.yml to see these.`
      });
      continue;
    }

    if (policy.minEvidenceGrade) {
      const grade = finding.evidenceGrade ?? "observed";
      if (evidenceGradeRank[grade] < evidenceGradeRank[policy.minEvidenceGrade]) {
        ledger.record({
          reason: "below_evidence_floor",
          detail: `${grade} evidence, below the ${policy.minEvidenceGrade} floor for ${finding.source}`,
          remediation: `Lower relevance.per_tool.${finding.source}.min_evidence_grade in vibedoctor.yml to see these.`
        });
        continue;
      }
    }

    if (policy.requireCorroboration && (finding.corroboratedBy?.length ?? 0) === 0) {
      ledger.record({
        reason: "not_corroborated",
        detail: `only ${finding.source} reported it, and ${finding.source} findings require corroboration`,
        remediation: `Set relevance.per_tool.${finding.source}.require_corroboration: false in vibedoctor.yml to see these.`
      });
      continue;
    }

    kept.push({ ...finding, priority: computePriority(finding) });
  }

  // Cap per tool, keeping the highest-ranked. A cap is a reading-order decision,
  // so what falls outside it is reported as a count rather than dropped quietly.
  const byTool = new Map<string, Finding[]>();
  for (const finding of kept) {
    const bucket = byTool.get(finding.source) ?? [];
    bucket.push(finding);
    byTool.set(finding.source, bucket);
  }

  const capped: Finding[] = [];
  for (const [tool, bucket] of byTool) {
    const limit = config.perTool[tool]?.maxFindings ?? config.maxFindingsPerTool;
    bucket.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

    if (limit > 0 && bucket.length > limit) {
      const ledger = ledgerFor(tool);
      for (let index = limit; index < bucket.length; index += 1) {
        ledger.record({
          reason: "over_tool_cap",
          detail: `beyond the ${limit}-finding cap for ${tool}, ranked by severity, novelty, and evidence`,
          remediation: `Raise relevance.per_tool.${tool}.max_findings in vibedoctor.yml, or run \`vibedoctor scan --category <category>\` to see the full set.`
        });
      }
      capped.push(...bucket.slice(0, limit));
      continue;
    }

    capped.push(...bucket);
  }

  capped.sort((left, right) => (right.priority ?? 0) - (left.priority ?? 0));

  let surfaced = capped;
  if (config.maxFindingsTotal > 0 && capped.length > config.maxFindingsTotal) {
    for (const finding of capped.slice(config.maxFindingsTotal)) {
      ledgerFor(finding.source).record({
        reason: "over_total_cap",
        detail: `beyond the ${config.maxFindingsTotal}-finding report cap`,
        remediation: "Raise relevance.max_findings_total in vibedoctor.yml, or filter with `vibedoctor scan --category`."
      });
    }
    surfaced = capped.slice(0, config.maxFindingsTotal);
  }

  const perTool = Array.from(ledgers.entries())
    .map(([tool, ledger]) => ledger.toResult(tool, surfaced.filter((finding) => finding.source === tool).length))
    .sort((left, right) => left.tool.localeCompare(right.tool));

  return {
    findings: surfaced,
    report: {
      enabled: true,
      perTool,
      totalReported: findings.length,
      totalSurfaced: surfaced.length,
      notes: buildRelevanceNotes(perTool)
    }
  };
}

function buildRelevanceNotes(perTool: ToolRelevance[]): string[] {
  const notes: string[] = [];

  for (const tool of perTool) {
    const withheldTotal = tool.withheld.reduce((sum, group) => sum + group.count, 0);
    if (withheldTotal === 0) {
      continue;
    }
    const breakdown = tool.withheld.map((group) => `${group.count} ${group.detail}`).join("; ");
    notes.push(`${tool.tool}: showing ${tool.surfaced} of ${tool.reported} — withheld ${breakdown}.`);
  }

  return notes;
}

export function renderRelevanceLines(report: RelevanceReport): string[] {
  if (!report.enabled) {
    return ["Relevance filtering: disabled (all findings shown)."];
  }

  const withheld = report.totalReported - report.totalSurfaced;
  if (withheld === 0 && report.perTool.every((tool) => tool.adjusted === 0)) {
    return [];
  }

  const lines = [`Relevance: showing ${report.totalSurfaced} of ${report.totalReported} findings.`];
  if (report.scopeNote) {
    lines.push(`- ${report.scopeNote}`);
  }
  lines.push(...report.notes.map((note) => `- ${note}`));

  const adjusted = report.perTool.filter((tool) => tool.adjusted > 0);
  if (adjusted.length > 0) {
    lines.push(
      `- Adjusted (severity or confidence changed after contextual checks): ${adjusted
        .map((tool) => `${tool.tool} ${tool.adjusted}`)
        .join(", ")}.`
    );
  }

  const remediations = Array.from(
    new Set(report.perTool.flatMap((tool) => tool.withheld.map((group) => group.remediation)))
  );
  if (remediations.length > 0) {
    lines.push("To see withheld findings:");
    lines.push(...remediations.map((remediation) => `- ${remediation}`));
  }

  return lines;
}
