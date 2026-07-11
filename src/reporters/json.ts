import type { ScanOutput } from "../core/engine";

export function renderJsonReport(scan: ScanOutput): string {
  return JSON.stringify(
    {
      score: scan.score.overall,
      completeness: scan.completeness,
      recoveryActions: scan.recoveryActions,
      categoryScores: scan.score.categories,
      findings: scan.findings,
      topFindings: scan.topFindings,
      privacyFindings: scan.privacyFindings,
      privacyReview: scan.privacyReview,
      toolStatuses: scan.toolStatuses,
      skippedTools: scan.skippedTools,
      agentPlan: scan.agentPlan
    },
    null,
    2
  ) + "\n";
}
