import type { ScanOutput } from "../core/engine";

export function renderHtmlReport(scan: ScanOutput): string {
  const findings = scan.findings
    .map(
      (finding) =>
        `<li><strong>${escapeHtml(finding.title)}</strong>${finding.file ? ` <code>${escapeHtml(finding.file)}</code>` : ""}<br>${escapeHtml(finding.message)}</li>`
    )
    .join("");
  const skippedTools = scan.skippedTools
    .map((tool) => `<li><strong>${escapeHtml(tool.id)}</strong>${tool.installHint ? ` — ${escapeHtml(tool.installHint)}` : ""}</li>`)
    .join("");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>VibeDoctor Report</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111; }
    code { background: #f4f4f4; padding: 2px 6px; }
  </style>
</head>
<body>
  <h1>VibeDoctor Health: ${scan.score.overall}/100</h1>
  <p>Blockers: ${scan.blockers.length} &middot; Fix next: ${scan.fixNext.length} &middot; Leftovers: ${scan.leftovers.length} &middot; Dead code candidates: ${scan.deadCodeCandidates.length}</p>
  <h2>Findings</h2>
  <ol>${findings}</ol>
  ${skippedTools ? `<h2>Skipped tools</h2><ul>${skippedTools}</ul>` : ""}
</body>
</html>
`;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
