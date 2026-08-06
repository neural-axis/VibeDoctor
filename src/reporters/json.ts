import type { ScanOutput } from "../core/engine";

export function renderJsonReport(scan: ScanOutput): string {
  const dpdpFindings = scan.privacyFindings.filter((finding) => finding.source === "dpdp");
  return JSON.stringify(
    {
      score: scan.score.overall,
      completeness: scan.completeness,
      recoveryActions: scan.recoveryActions,
      categoryScores: scan.score.categories,
      findings: scan.findings,
      topFindings: scan.topFindings,
      privacyFindings: scan.privacyFindings,
      dpdpFindings,
      privacyReview: scan.privacyReview,
      toolStatuses: scan.toolStatuses,
      skippedTools: scan.skippedTools,
      agentPlan: scan.agentPlan,
      notes: {
        dpdp:
          "DPDP findings are technical readiness signals integrated into privacy findings. See .vibedoctor/dpdp/ for the control matrix and data map. Not legal compliance."
      }
    },
    null,
    2
  ) + "\n";
}
