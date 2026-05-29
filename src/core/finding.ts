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
  "efficiency",
  "refactor_readiness"
] as const;

export type FindingSource = (typeof FINDING_SOURCES)[number];
export type FindingCategory = (typeof FINDING_CATEGORIES)[number];
export type Severity = "info" | "low" | "medium" | "high" | "critical";
export type Confidence = "low" | "medium" | "high";

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
  isNew: boolean;
  isAutofixable: boolean;
  safeToAutofix: boolean;
  fixCommand?: string;
  agentInstruction?: string;
  tags: string[];
  evidence?: {
    snippet?: string;
    toolRawId?: string;
    matchedPattern?: string;
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
  return findings.map((finding) => ({
    ...finding,
    id: finding.id || fingerprintFinding(finding),
    isNew: !baselineFingerprints.has(fingerprintFinding(finding))
  }));
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
      scoreImpact: Math.max(existing.scoreImpact, finding.scoreImpact)
    });
  }

  return Array.from(byKey.values());
}
