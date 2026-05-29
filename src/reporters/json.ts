import os from "node:os";
import type { ScanOutput } from "../core/engine";

export function renderJsonReport(scan: ScanOutput): string {
  return JSON.stringify(
    {
      score: scan.score.overall,
      categoryScores: scan.score.categories,
      findings: scan.findings,
      topFindings: scan.topFindings,
      toolStatuses: scan.toolStatuses,
      skippedTools: scan.skippedTools,
      agentPlan: scan.agentPlan
    },
    null,
    2
  ).replace(/\n/g, os.EOL) + os.EOL;
}
