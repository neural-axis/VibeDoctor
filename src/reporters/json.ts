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
      capabilityMatrix: scan.capabilityMatrix,
      relevance: scan.relevance,
      suppressions: scan.suppressions,
      suppressedFindings: scan.suppressedFindings,
      verifications: scan.verifications,
      agentPlan: scan.agentPlan,
      notes: {
        dpdp:
          "DPDP findings are technical readiness signals integrated into privacy findings. See .vibedoctor/dpdp/ for the control matrix and data map. Not legal compliance.",
        coverage:
          "capabilityMatrix is authoritative for what actually ran: toolStatuses and skippedTools are views of it. relevance explains any difference between findings a tool reported and findings shown here, so a short report is never a clean one."
      }
    },
    null,
    2
  ) + "\n";
}
