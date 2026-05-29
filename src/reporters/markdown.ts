import type { ScanOutput } from "../core/engine";

export function renderMarkdownReport(scan: ScanOutput): string {
  const plan = scan.agentPlan;
  const lines: string[] = [`# VibeDoctor Report`, "", `Health: **${scan.score.overall}/100**`, ""];

  lines.push("## Summary");
  lines.push(`- Blockers: ${scan.blockers.length}`);
  lines.push(`- Fix next: ${scan.fixNext.length}`);
  lines.push(`- Leftovers: ${scan.leftovers.length}`);
  lines.push(`- Dead code candidates: ${scan.deadCodeCandidates.length}`);
  lines.push(`- Refactor candidates: ${scan.refactorCandidates.length}`);

  lines.push("", "## Blockers");
  if (scan.blockers.length === 0) {
    lines.push("- None");
  } else {
    scan.blockers.forEach((finding) => lines.push(`- ${finding.title}${finding.file ? ` — \`${finding.file}\`` : ""}: ${finding.message}`));
  }

  lines.push("", "## Fix next");
  scan.fixNext.forEach((finding) => lines.push(`- ${finding.title}${finding.file ? ` — \`${finding.file}\`` : ""}`));

  if (scan.deadCodeCandidates.length > 0) {
    lines.push("", "## Dead chains and dead code");
    scan.deadCodeCandidates.slice(0, 5).forEach((finding) => lines.push(`- ${finding.title}${finding.file ? ` — \`${finding.file}\`` : ""}: ${finding.message}`));
  }

  if (scan.skippedTools.length > 0) {
    lines.push("", "## Skipped tools");
    scan.skippedTools.forEach((tool) => lines.push(`- ${tool.id}${tool.installHint ? ` — ${tool.installHint}` : ""}`));
  }

  lines.push("", "## Agent tasks");
  plan.tasks.forEach((task) => lines.push(`- ${task.title}`));
  return `${lines.join("\n")}\n`;
}
