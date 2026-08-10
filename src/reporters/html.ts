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

function formatLocation(finding: Finding): string {
  if (!finding.file) {
    return "";
  }
  const line = finding.startLine ? `:${finding.startLine}` : "";
  const column = finding.startLine && finding.startColumn ? `:${finding.startColumn}` : "";
  return `${finding.file}${line}${column}`;
}

export function renderHtmlReport(scan: ScanOutput): string {
  const severityColor = (sev: string) => {
    if (sev === "critical") return "#b91c1c";
    if (sev === "high") return "#dc2626";
    if (sev === "medium") return "#d97706";
    return "#4b5563";
  };

  const renderFindingList = (items: typeof scan.findings, title: string) => {
    if (!items.length) return "";
    const lis = items
      .map(
        (f) =>
          `<li style="margin-bottom:8px"><strong style="color:${severityColor(f.severity)}">${escapeHtml(f.title)}</strong> <span style="color:#6b7280">(${f.severity}, ${f.confidence})</span>${f.file ? ` <code>${escapeHtml(formatLocation(f))}</code>` : ""}<br><span>${escapeHtml(f.message)}</span></li>`
      )
      .join("");
    return `<h3>${title} (${items.length})</h3><ul style="padding-left:20px">${lis}</ul>`;
  };

  const toolList = (tools: typeof scan.toolStatuses | typeof scan.skippedTools, label: string) => {
    if (!tools.length) return "";
    const lis = tools
      .map((t) => `<li><strong>${escapeHtml(t.id)}</strong> — ${escapeHtml((t as any).status || "skipped")}${ (t as any).installHint ? ` <em>(${escapeHtml((t as any).installHint)})</em>` : ""}</li>`)
      .join("");
    return `<h3>${label}</h3><ul>${lis}</ul>`;
  };

  const errored = scan.toolStatuses.filter((t) => t.status === "error" || t.status === "timeout");

  const capabilitySection = () => {
    if (!scan.capabilityMatrix.tools.length) return "";
    const rows = scan.capabilityMatrix.tools
      .map(
        (tool) =>
          `<tr><td><strong>${escapeHtml(tool.id)}</strong></td><td>${escapeHtml(capabilityStateLabel(tool.state))}</td><td>${tool.findingsSurfaced}/${tool.findingsReported}</td><td>${escapeHtml(formatDuration(tool.durationMs))}</td><td>${escapeHtml(tool.reason)}</td></tr>`
      )
      .join("");
    const remediations = scan.capabilityMatrix.tools.filter((tool) => tool.remediation && isCoverageGap(tool));
    const restore = remediations.length
      ? `<h4>To restore coverage</h4><ul>${remediations
          .map((tool) => `<li><strong>${escapeHtml(tool.id)}</strong> — ${escapeHtml(tool.remediation!)}</li>`)
          .join("")}</ul>`
      : "";
    return `<div class="section"><h3>Tool coverage</h3><table><thead><tr><th>Tool</th><th>State</th><th>Findings shown/reported</th><th>Time</th><th>Detail</th></tr></thead><tbody>${rows}</tbody></table>${restore}</div>`;
  };

  const lineSection = (title: string, sectionLines: string[]) => {
    if (!sectionLines.length) return "";
    return `<div class="section"><h3>${escapeHtml(title)}</h3><ul>${sectionLines
      .map((line) => `<li>${escapeHtml(line.replace(/^- /, ""))}</li>`)
      .join("")}</ul></div>`;
  };

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VibeDoctor Report — ${escapeHtml(scan.root)}</title>
  <style>
    body { font-family: system-ui, Arial, sans-serif; margin: 32px; color: #111; line-height: 1.5; max-width: 960px; }
    h1 { margin-bottom: 4px; }
    .score { font-size: 1.8em; font-weight: 700; }
    .summary { display: flex; gap: 16px; flex-wrap: wrap; margin: 12px 0 20px; }
    .pill { background: #f3f4f6; padding: 4px 10px; border-radius: 9999px; font-size: 0.9em; }
    code { background: #f4f4f4; padding: 1px 4px; border-radius: 3px; font-family: ui-monospace, monospace; }
    ul { margin: 8px 0; }
    .section { margin-top: 24px; }
    .meta { color: #6b7280; font-size: 0.85em; }
    table { border-collapse: collapse; width: 100%; font-size: 0.9em; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 6px 8px; text-align: left; vertical-align: top; }
    th { color: #374151; font-weight: 600; }
  </style>
</head>
<body>
  <h1>VibeDoctor Health Report</h1>
  <div class="meta">Root: <code>${escapeHtml(scan.root)}</code> &middot; Mode: ${scan.mode} &middot; Generated for agents &amp; humans</div>

  <div class="score">Health: ${scan.score.overall}/100 — ${scan.completeness.status.toUpperCase()} ${scan.score.overall >= 85 ? "✅" : "⚠️"}</div>
  <div class="meta">Scan coverage: ${scan.completeness.completed}/${scan.completeness.planned} checks completed.${scan.completeness.comparable ? "" : " This score is not comparable to a complete scan."}</div>

  <div class="summary">
    <span class="pill">Blockers: ${scan.blockers.length}</span>
    <span class="pill">Fix next: ${scan.fixNext.length}</span>
    <span class="pill">Privacy Review: ${scan.privacyFindings.length}</span>
    <span class="pill">Leftovers: ${scan.leftovers.length}</span>
    <span class="pill">Dead chains: ${scan.deadCodeCandidates.length}</span>
    <span class="pill">Refactor: ${scan.refactorCandidates.length}</span>
  </div>

  <div class="section">
    ${renderFindingList(scan.blockers, "BLOCKERS")}
    ${renderFindingList(scan.fixNext, "FIX NEXT")}
    ${renderFindingList(scan.privacyFindings.slice(0, 10), "PRIVACY REVIEW FINDINGS")}
    ${renderFindingList(scan.leftovers, "LEFTOVERS")}
    ${renderFindingList(scan.deadCodeCandidates, "DEAD CHAINS")}
    ${renderFindingList(scan.refactorCandidates, "REFACTOR CANDIDATES")}
  </div>

  ${toolList(scan.toolStatuses.filter(t => t.status !== "ok"), "Tool Statuses (non-ok)")}
  ${toolList(scan.skippedTools as any, "Skipped Tools")}
  ${errored.length ? toolList(errored as any, "Errored / Timed Out Tools") : ""}
  ${capabilitySection()}
  ${lineSection("Report filtering", renderRelevanceLines(scan.relevance))}
  ${lineSection("Acknowledged", renderSuppressionLines(scan.suppressions))}
  ${scan.recoveryActions.length ? `<h3>Recover before editing</h3><ul>${scan.recoveryActions.map(action => `<li><code>${escapeHtml(action.command)}</code> — ${escapeHtml(action.successCondition)}</li>`).join("")}</ul>` : ""}

  <p class="meta" style="margin-top:32px">Run <code>vibedoctor agent-plan</code> for guided repair. Full JSON/HTML/Markdown/SARIF available via --report.</p>
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
