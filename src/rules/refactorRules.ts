export const refactorWeights = {
  fileLines: 0.25,
  complexity: 0.25,
  duplication: 0.15,
  leftovers: 0.1,
  deadCode: 0.1,
  imports: 0.075,
  exports: 0.075
} as const;

export const safetyThresholds = {
  ready: 65,
  pain: 60
} as const;
