import type { Finding, FindingCategory } from "./finding";
import { categoryWeights, confidenceMultiplier, severityPenalty } from "../rules/severityMap";

export type ScoreBreakdown = {
  overall: number;
  categories: Record<FindingCategory, number>;
  penalties: Record<FindingCategory, number>;
};

const defaultCategoryScore: Record<FindingCategory, number> = {
  security: 100,
  correctness: 100,
  dead_code: 100,
  leftovers: 100,
  maintainability: 100,
  dependencies: 100,
  tests: 100,
  efficiency: 100,
  refactor_readiness: 100
};

const defaultPenalties: Record<FindingCategory, number> = {
  security: 0,
  correctness: 0,
  dead_code: 0,
  leftovers: 0,
  maintainability: 0,
  dependencies: 0,
  tests: 0,
  efficiency: 0,
  refactor_readiness: 0
};

export function scoreFinding(finding: Finding): number {
  const issueMultiplier = finding.isNew ? 1.5 : 0.3;
  const confidence = confidenceMultiplier[finding.confidence];
  const autofix = finding.safeToAutofix ? 0.5 : 1;
  const fileWeight = finding.file && (/\.test\./.test(finding.file) || /(^|\/)tests?\//.test(finding.file)) ? 0.6 : 1.2;

  return Number((severityPenalty[finding.severity] * issueMultiplier * confidence * autofix * fileWeight).toFixed(2));
}

export function buildScore(findings: Finding[]): ScoreBreakdown {
  const penalties = { ...defaultPenalties };

  for (const finding of findings) {
    penalties[finding.category] += finding.scoreImpact || scoreFinding(finding);
  }

  const categories = { ...defaultCategoryScore };
  for (const key of Object.keys(categories) as FindingCategory[]) {
    categories[key] = Math.max(0, Number((100 - penalties[key]).toFixed(2)));
  }

  const overall = Math.round(
    categories.security * categoryWeights.security +
      categories.correctness * categoryWeights.correctness +
      categories.tests * categoryWeights.tests +
      categories.dependencies * categoryWeights.dependencies +
      categories.maintainability * categoryWeights.maintainability +
      categories.dead_code * categoryWeights.dead_code +
      categories.leftovers * categoryWeights.leftovers +
      categories.refactor_readiness * categoryWeights.refactor_readiness +
      categories.efficiency * categoryWeights.efficiency
  );

  return { overall, categories, penalties };
}
