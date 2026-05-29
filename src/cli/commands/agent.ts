import {
  doctorAgentPack,
  initAgentPack,
  loadAgentPackManifest,
  packAgentPack,
  parseAgentTargets,
  syncAgentPack,
  type AgentPackApplyResult,
  type AgentTarget
} from "../../agentPack/generateAgentPack";

function formatFileSection(title: string, files: string[]): string[] {
  if (files.length === 0) {
    return [];
  }

  return [title, ...files.sort().map((file) => `- ${file}`), ""];
}

function formatApplyResult(title: string, result: AgentPackApplyResult, includeNextSteps = false): string {
  const lines = [title, ""];

  lines.push(...formatFileSection("Created:", result.created));
  lines.push(...formatFileSection("Updated:", result.updated));
  lines.push(...formatFileSection("Skipped:", result.skipped));

  if (result.created.length === 0 && result.updated.length === 0 && result.skipped.length === 0) {
    lines.push("No files changed.", "");
  }

  if (includeNextSteps) {
    lines.push("Next:", '1. Open your agent.', "2. Run /skills.", '3. Ask: "Use VibeDoctor to scan this repo."');
  }

  return `${lines.join("\n").trimEnd()}\n`;
}

function resolveTargets(options: { target?: string; targets?: string }, fallback: AgentTarget[] = ["codex"]): AgentTarget[] {
  const merged = options.target ? options.target : options.targets;
  return parseAgentTargets(merged, fallback);
}

export async function runAgentInitCommand(
  root: string,
  options: { target?: string; targets?: string; force?: boolean }
): Promise<string> {
  const targets = resolveTargets(options);
  const result = await initAgentPack(root, { targets, force: options.force });
  return formatApplyResult("VibeDoctor Agent Pack installed ✅", result, true);
}

export async function runAgentPackCommand(
  root: string,
  options: { target?: string; targets?: string; force?: boolean }
): Promise<string> {
  const manifest = await loadAgentPackManifest(root);
  const targets = resolveTargets(options, manifest?.targets ?? ["codex"]);
  const result = await packAgentPack(root, { targets, force: options.force });
  return formatApplyResult("VibeDoctor Agent Pack regenerated ✅", result);
}

export async function runAgentSyncCommand(
  root: string,
  options: { target?: string; targets?: string; force?: boolean }
): Promise<string> {
  const manifest = await loadAgentPackManifest(root);
  const targets = resolveTargets(options, manifest?.targets ?? ["codex"]);
  const result = await syncAgentPack(root, { targets, force: options.force });
  return formatApplyResult("VibeDoctor Agent Pack synced ✅", result);
}

export async function runAgentDoctorCommand(
  root: string,
  options: { target?: string; targets?: string }
): Promise<{ output: string; exitCode: number }> {
  const manifest = await loadAgentPackManifest(root);
  const targets = resolveTargets(options, manifest?.targets ?? ["codex"]);
  const result = await doctorAgentPack(root, targets);
  const lines = result.items.map((item) => `${item.status === "ok" ? "✅" : "⚠️"} ${item.message}`);
  return {
    output: `${lines.join("\n")}\n`,
    exitCode: result.ok ? 0 : 1
  };
}
