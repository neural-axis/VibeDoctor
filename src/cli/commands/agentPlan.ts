import { loadAgentPolicy } from "../../agentPack/policy";
import { createAgentPlan, runScan } from "../../core/engine";
import { renderAgentJson, renderAgentMarkdown } from "../../reporters/agent";

export async function runAgentPlanCommand(
  root: string,
  format: "markdown" | "json" = "markdown",
  target: "codex" | "copilot" | "claude" | "cursor" | undefined = undefined
): Promise<string> {
  const scan = await runScan(root, "default");
  const { policy } = await loadAgentPolicy(root);
  const plan = createAgentPlan(
    {
      findings: scan.findings,
      score: scan.score,
      skippedTools: scan.skippedTools,
      toolStatuses: scan.toolStatuses,
      completeness: scan.completeness,
      recoveryActions: scan.recoveryActions,
      testCommands: scan.testCommands
    },
    { policy, target: target ?? "generic" }
  );
  return format === "json" ? `${renderAgentJson(plan)}\n` : renderAgentMarkdown(plan);
}
