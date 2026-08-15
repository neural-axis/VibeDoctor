import { buildAgentDiagnosis } from "../core/agentDiagnosis";
import type { AgentPlan, ScanOutput } from "../core/engine";

function getPlan(input: Pick<ScanOutput, "agentPlan"> | AgentPlan): AgentPlan {
  return "agentPlan" in input ? input.agentPlan : input;
}

function isScanOutput(input: Pick<ScanOutput, "agentPlan"> | AgentPlan | ScanOutput): input is ScanOutput {
  return "findings" in input && "completeness" in input && "score" in input;
}

export function renderAgentMarkdown(input: Pick<ScanOutput, "agentPlan"> | AgentPlan): string {
  const plan = getPlan(input);
  const lines = ["# VibeDoctor Agent Plan", "", `Goal: ${plan.goal}.`, "", `Target: ${plan.target}`, "", "## Workflow", ""];

  plan.workflow.forEach((step, index) => lines.push(`${index + 1}. ${step}`));

  if (plan.recoveryActions.length > 0) {
    lines.push("", "## Recover before editing", "");
    plan.recoveryActions.forEach((action) => {
      lines.push(`- ${action.tool}: \`${action.command}\``);
      lines.push(`  Success: ${action.successCondition}.`);
      lines.push(`  If it fails: ${action.onFailure}`);
    });
  }

  lines.push("", "## Allowed actions", "");
  plan.allowedActions.forEach((action) => lines.push(`- ${action}`));

  lines.push("", "## Forbidden actions", "");
  plan.forbiddenActions.forEach((action) => lines.push(`- ${action}`));

  lines.push("", "## Rules", "");

  for (const rule of plan.rules) {
    lines.push(`- ${rule}`);
  }

  if (plan.doNotTouch.length > 0) {
    lines.push("", "## What not to trust blindly", "");
    plan.doNotTouch.forEach((item) => lines.push(`- ${item}`));
  }

  for (const task of plan.tasks) {
    lines.push("", `## Task ${task.priority}: ${task.title}`, "");
    if (task.files.length > 0) {
      lines.push("Files:");
      task.files.forEach((file) => lines.push(`- ${file}`));
      lines.push("");
    }

    lines.push("Instructions:");
    task.instructions.forEach((instruction, index) => lines.push(`${index + 1}. ${instruction}`));
    if (task.doNotTouch.length > 0) {
      lines.push("", "Do not touch:");
      task.doNotTouch.forEach((item) => lines.push(`- ${item}`));
    }
    if (task.commands.length > 0) {
      lines.push("", "Commands:");
      task.commands.forEach((command) => lines.push(`- ${command}`));
    }
    lines.push("", "Verify:");
    task.verify.forEach((command) => lines.push(`- ${command}`));
  }

  return `${lines.join("\n")}\n`;
}

export function renderAgentJson(input: Pick<ScanOutput, "agentPlan"> | AgentPlan | ScanOutput): string {
  if (isScanOutput(input)) {
    return JSON.stringify(input.diagnosis ?? buildAgentDiagnosis(input), null, 2);
  }
  return JSON.stringify(getPlan(input), null, 2);
}
