import type { Confidence, Severity } from "../core/finding";

export const severityPenalty: Record<Severity, number> = {
  critical: 42,
  high: 15,
  medium: 6,
  low: 2,
  info: 0.5
};

export const confidenceMultiplier: Record<Confidence, number> = {
  low: 0.25,
  medium: 0.6,
  high: 1
};

export const severityRank: Record<Severity, number> = {
  info: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export const categoryWeights = {
  security: 0.22,
  correctness: 0.18,
  tests: 0.15,
  dependencies: 0.13,
  maintainability: 0.12,
  dead_code: 0.08,
  leftovers: 0.06,
  refactor_readiness: 0.04,
  efficiency: 0.02
} as const;
