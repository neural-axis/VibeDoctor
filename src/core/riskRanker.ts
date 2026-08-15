import type { Confidence, EvidenceGrade, Finding, FindingCategory, Severity } from "./finding";

/**
 * Holistic risk ranking. Category-first sort buried real bugs under unused-import
 * warnings of the same scanner family. This scores likely runtime defects,
 * secrets, and broken flows above lint and maintainability.
 */

const SEVERITY_SCORE: Record<Severity, number> = {
  critical: 1000,
  high: 700,
  medium: 280,
  low: 70,
  info: 10
};

const CONFIDENCE_SCORE: Record<Confidence, number> = {
  high: 80,
  medium: 30,
  low: 0
};

const EVIDENCE_SCORE: Record<EvidenceGrade, number> = {
  verified: 60,
  observed: 40,
  heuristic: 10,
  unproven: 0
};

const STYLE_LINT = /^(F401|F841|I00|I001|W29|E5\d|COM|Q0|T20|ISC|WPS|UP0|SIM\d)/i;

export function isStyleOrHygieneFinding(finding: Finding): boolean {
  const code = finding.evidence?.toolRawId ?? finding.title;
  if (STYLE_LINT.test(code)) {
    return true;
  }
  return finding.category === "leftovers" || finding.category === "maintainability" || finding.category === "efficiency";
}

export function isLikelyRealBug(finding: Finding): boolean {
  if (finding.source === "flow-doctor" && finding.evidenceGrade !== "heuristic") {
    return true;
  }
  if (finding.source === "tsc" || finding.source === "pyright") {
    return true;
  }
  if (finding.category === "tests" && (finding.severity === "high" || finding.severity === "critical")) {
    return true;
  }
  const code = finding.evidence?.toolRawId ?? finding.title;
  return /^(F8|F82|F821|E9|B0|S1|TS\d)/i.test(code);
}

export function riskScore(finding: Finding): number {
  const evidence = finding.evidenceGrade ?? "observed";
  let score = SEVERITY_SCORE[finding.severity] + CONFIDENCE_SCORE[finding.confidence] + EVIDENCE_SCORE[evidence];

  if (finding.category === "security" || finding.source === "gitleaks" || finding.source === "osv-scanner") {
    score += 520;
  }
  if (finding.source === "flow-doctor") {
    score += evidence === "heuristic" ? 60 : 460;
  }
  if (isLikelyRealBug(finding)) {
    score += 380;
  }
  if (finding.category === "correctness" && !isStyleOrHygieneFinding(finding)) {
    score += 140;
  }
  if (finding.category === "dependencies" && (finding.severity === "high" || finding.severity === "critical")) {
    score += 360;
  }
  if (finding.inChangedFile || finding.isNew) {
    score += 70;
  }
  if (finding.fileRole === "source" || finding.fileRole === undefined) {
    score += 35;
  }
  if (finding.fileRole === "test" || finding.fileRole === "fixture" || finding.fileRole === "generated") {
    score -= 90;
  }
  if (isStyleOrHygieneFinding(finding)) {
    score -= 220;
  }
  if (finding.category === "dead_code" && finding.confidence !== "high") {
    score -= 80;
  }
  if (finding.corroboratedBy && finding.corroboratedBy.length > 0) {
    score += 40 * finding.corroboratedBy.length;
  }

  return score;
}

function compareIds(left: Finding, right: Finding): number {
  const fileDelta = (left.file ?? "").localeCompare(right.file ?? "");
  if (fileDelta !== 0) {
    return fileDelta;
  }
  const lineDelta = (left.startLine ?? 0) - (right.startLine ?? 0);
  if (lineDelta !== 0) {
    return lineDelta;
  }
  const titleDelta = left.title.localeCompare(right.title);
  if (titleDelta !== 0) {
    return titleDelta;
  }
  return left.id.localeCompare(right.id);
}

export function rankFindings(findings: Finding[]): Finding[] {
  return [...findings]
    .map((finding) => ({ ...finding, priority: riskScore(finding) }))
    .sort((left, right) => {
      const scoreDelta = (right.priority ?? 0) - (left.priority ?? 0);
      if (scoreDelta !== 0) {
        return scoreDelta;
      }
      return compareIds(left, right);
    });
}

export const RANKING_CATEGORY_HINT: FindingCategory[] = [
  "security",
  "correctness",
  "tests",
  "dependencies",
  "privacy",
  "dead_code",
  "leftovers",
  "refactor_readiness",
  "maintainability",
  "efficiency"
];
