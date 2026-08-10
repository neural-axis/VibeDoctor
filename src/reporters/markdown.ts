import { capabilityStateLabel, isCoverageGap } from "../core/capability";
import type { ScanOutput } from "../core/engine";
import type { Finding } from "../core/finding";
import { renderRelevanceLines } from "../core/relevance";
import { renderSuppressionLines } from "../core/suppressions";

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "";
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
}

/** Cell content has to be escaped or a `|` in a tool's reason breaks the table. */
function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function formatLocation(finding: Finding): string {
  if (!finding.file) {
    return "";
  }
  const line = finding.startLine ? `:${finding.startLine}` : "";
  const column = finding.startLine && finding.startColumn ? `:${finding.startColumn}` : "";
  return ` — \`${finding.file}${line}${column}\``;
}

export function renderMarkdownReport(scan: ScanOutput): string {
  const plan = scan.agentPlan;
  const lines: string[] = [
    `# VibeDoctor Report`,
    "",
    `Health: **${scan.score.overall}/100** — ${scan.completeness.status.toUpperCase()}`,
    `Scan coverage: **${scan.completeness.completed}/${scan.completeness.planned} checks completed**`,
    ...(scan.completeness.comparable ? [] : ["This score is not comparable to a complete scan."]),
    ""
  ];

  lines.push("## Summary");
  lines.push(`- Blockers: ${scan.blockers.length}`);
  lines.push(`- Fix next: ${scan.fixNext.length}`);
  lines.push(`- Privacy Review findings: ${scan.privacyFindings.length}`);
  lines.push(`- Leftovers: ${scan.leftovers.length}`);
  lines.push(`- Dead code candidates: ${scan.deadCodeCandidates.length}`);
  lines.push(`- Refactor candidates: ${scan.refactorCandidates.length}`);

  lines.push("", "## Blockers");
  if (scan.blockers.length === 0) {
    lines.push("- None");
  } else {
    scan.blockers.forEach((finding) => lines.push(`- ${finding.title}${formatLocation(finding)}: ${finding.message}`));
  }

  lines.push("", "## Fix next");
  scan.fixNext.forEach((finding) => lines.push(`- ${finding.title}${formatLocation(finding)}`));

  if (scan.privacyFindings.length > 0) {
    lines.push("", "## Privacy Review findings");
    scan.privacyFindings
      .slice(0, 10)
      .forEach((finding) =>
        lines.push(
          `- ${finding.title}${formatLocation(finding)}: ${finding.evidence?.maskedValue ?? finding.evidence?.entityType ?? finding.message}`
        )
      );
  }

  if (scan.deadCodeCandidates.length > 0) {
    lines.push("", "## Dead chains and dead code");
    scan.deadCodeCandidates.slice(0, 5).forEach((finding) => lines.push(`- ${finding.title}${formatLocation(finding)}: ${finding.message}`));
  }

  if (scan.skippedTools.length > 0) {
    lines.push("", "## Skipped tools");
    scan.skippedTools.forEach((tool) => lines.push(`- ${tool.id}${tool.installHint ? ` — ${tool.installHint}` : ""}`));
  }

  if (scan.capabilityMatrix.tools.length > 0) {
    lines.push("", "## Tool coverage");
    lines.push("| Tool | State | Findings shown/reported | Time | Detail |");
    lines.push("| --- | --- | --- | --- | --- |");
    scan.capabilityMatrix.tools.forEach((tool) =>
      lines.push(
        `| ${escapeTableCell(tool.id)} | ${capabilityStateLabel(tool.state)} | ${tool.findingsSurfaced}/${tool.findingsReported} | ${formatDuration(tool.durationMs)} | ${escapeTableCell(tool.reason)} |`
      )
    );

    const remediations = scan.capabilityMatrix.tools.filter((tool) => tool.remediation && isCoverageGap(tool));
    if (remediations.length > 0) {
      lines.push("", "### To restore coverage");
      remediations.forEach((tool) => lines.push(`- ${tool.id}: ${tool.remediation}`));
    }
  }

  const relevanceLines = renderRelevanceLines(scan.relevance);
  if (relevanceLines.length > 0) {
    lines.push("", "## Report filtering");
    relevanceLines.forEach((line) => lines.push(line));
  }

  const suppressionLines = renderSuppressionLines(scan.suppressions);
  if (suppressionLines.length > 0) {
    lines.push("", "## Acknowledged");
    suppressionLines.forEach((line) => lines.push(line));
  }

  lines.push("", "## Agent tasks");
  plan.tasks.forEach((task) => lines.push(`- ${task.title}`));
  return `${lines.join("\n")}\n`;
}
