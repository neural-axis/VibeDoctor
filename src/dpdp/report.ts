import type { DpdpScanResult } from "./types";

export function renderDpdpTerminalReport(result: DpdpScanResult): string {
  const { scores, dataMap, fixNext, capabilities } = result;
  const lines = [
    "DPDP technical readiness (not legal compliance)",
    `${scores.labels.technicalPosture}: ${scores.technicalPostureScore}/100`,
    `${scores.labels.evidenceCompleteness}: ${scores.evidenceCompletenessPercent}%`,
    "",
    `Controls — verified: ${scores.statusCounts.verified}, violated: ${scores.statusCounts.violated}, partial: ${scores.statusCounts.partial}, unresolved: ${scores.statusCounts.unresolved}, skipped: ${scores.statusCounts.skipped}, human-review: ${scores.statusCounts.humanReview}`,
    `Open risk — critical: ${scores.openRiskBySeverity.critical}, high: ${scores.openRiskBySeverity.high}, medium: ${scores.openRiskBySeverity.medium}, low: ${scores.openRiskBySeverity.low}`,
    "",
    `Personal-data categories: ${dataMap.categories.map((item) => item.category).join(", ") || "(none observed)"}`,
    `Stores: ${dataMap.stores.length}`,
    `External recipients: ${dataMap.externalRecipients.length}`,
    `Data-map graph: ${dataMap.graph?.nodes.length ?? 0} nodes, ${dataMap.graph?.edges.length ?? 0} edges`,
    `Verified technical risks (violations): ${scores.statusCounts.violated}`,
    `Partial controls: ${scores.statusCounts.partial}`,
    `Human-review items: ${result.reviewQueue.length}`,
    `Skipped capabilities: ${capabilities.filter((item) => item.status === "skipped").map((item) => item.id).join(", ") || "(none)"}`,
    ""
  ];

  if (fixNext.length > 0) {
    lines.push("FIX NEXT");
    fixNext.slice(0, 5).forEach((item, index) => {
      lines.push(`${index + 1}. [${item.severity}] ${item.controlId} — ${item.title}`);
      lines.push(`   ${item.remediation}`);
    });
    lines.push("");
  }

  lines.push("Artifacts: .vibedoctor/dpdp/");
  lines.push("Handoff: vibedoctor dpdp handoff");
  lines.push("");
  lines.push(result.disclaimer);
  return `${lines.join("\n")}\n`;
}

export function renderDpdpMarkdownReport(result: DpdpScanResult): string {
  const lines = [
    "# DPDP Technical Readiness Report",
    "",
    `> ${result.disclaimer}`,
    "",
    "## Scores (technical readiness — not legal compliance)",
    "",
    `| Metric | Value |`,
    `| --- | --- |`,
    `| ${result.scores.labels.technicalPosture} | ${result.scores.technicalPostureScore}/100 |`,
    `| ${result.scores.labels.evidenceCompleteness} | ${result.scores.evidenceCompletenessPercent}% |`,
    "",
    "## Control status counts",
    "",
    `- Verified: ${result.scores.statusCounts.verified}`,
    `- Violated: ${result.scores.statusCounts.violated}`,
    `- Partial: ${result.scores.statusCounts.partial}`,
    `- Unresolved: ${result.scores.statusCounts.unresolved}`,
    `- Needs context: ${result.scores.statusCounts.needsContext}`,
    `- Not observed: ${result.scores.statusCounts.notObserved}`,
    `- Not applicable: ${result.scores.statusCounts.notApplicable}`,
    `- Skipped: ${result.scores.statusCounts.skipped}`,
    `- Human-review: ${result.scores.statusCounts.humanReview}`,
    "",
    "## Personal-data map summary",
    "",
    `- Categories: ${result.dataMap.categories.map((item) => `${item.category} (${item.count})`).join(", ") || "none"}`,
    `- Stores: ${result.dataMap.stores.length}`,
    `- External recipients: ${result.dataMap.externalRecipients.map((item) => item.name).join(", ") || "none"}`,
    `- Graph: ${result.dataMap.graph?.nodes.length ?? 0} nodes, ${result.dataMap.graph?.edges.length ?? 0} edges`,
    "",
    "## Fix next",
    ""
  ];

  if (result.fixNext.length === 0) {
    lines.push("_No violated/partial technical controls prioritised._");
  } else {
    for (const item of result.fixNext) {
      lines.push(`### ${item.controlId} — ${item.title}`);
      lines.push("");
      lines.push(`- Severity: ${item.severity}`);
      lines.push(`- Remediation: ${item.remediation}`);
      lines.push("");
    }
  }

  lines.push("## Review queue");
  lines.push("");
  for (const item of result.reviewQueue.slice(0, 20)) {
    lines.push(`- **${item.controlId}** (${item.audience}): ${item.question}`);
  }
  lines.push("");
  lines.push(`Legal source version: ${result.legalSourceVersion}`);
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderDpdpHtmlReport(result: DpdpScanResult): string {
  const escape = (value: string) =>
    value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

  const fixRows = result.fixNext
    .map(
      (item) =>
        `<tr><td>${escape(item.controlId)}</td><td>${escape(item.severity)}</td><td>${escape(item.title)}</td><td>${escape(item.remediation)}</td></tr>`
    )
    .join("");

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>DPDP Technical Readiness</title>
  <style>
    body { font-family: ui-sans-serif, system-ui, sans-serif; margin: 2rem; color: #0f172a; background: #f8fafc; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 1.25rem; margin-bottom: 1rem; }
    h1 { margin-top: 0; }
    .muted { color: #475569; }
    .score { font-size: 2rem; font-weight: 700; }
    table { width: 100%; border-collapse: collapse; }
    th, td { text-align: left; padding: 0.5rem; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
    .badge { display: inline-block; padding: 0.15rem 0.5rem; border-radius: 999px; background: #e2e8f0; font-size: 0.85rem; }
  </style>
</head>
<body>
  <div class="card">
    <h1>DPDP Technical Readiness</h1>
    <p class="muted">${escape(result.disclaimer)}</p>
    <p><span class="score">${result.scores.technicalPostureScore}</span> / 100 technical posture</p>
    <p>Evidence completeness: <strong>${result.scores.evidenceCompletenessPercent}%</strong></p>
    <p>
      <span class="badge">violated ${result.scores.statusCounts.violated}</span>
      <span class="badge">partial ${result.scores.statusCounts.partial}</span>
      <span class="badge">verified ${result.scores.statusCounts.verified}</span>
      <span class="badge">human-review ${result.scores.statusCounts.humanReview}</span>
    </p>
  </div>
  <div class="card">
    <h2>Personal-data categories</h2>
    <p>${escape(result.dataMap.categories.map((item) => item.category).join(", ") || "none observed")}</p>
    <h2>External recipients</h2>
    <p>${escape(result.dataMap.externalRecipients.map((item) => item.name).join(", ") || "none observed")}</p>
  </div>
  <div class="card">
    <h2>Fix next</h2>
    <table>
      <thead><tr><th>Control</th><th>Severity</th><th>Title</th><th>Remediation</th></tr></thead>
      <tbody>${fixRows || "<tr><td colspan=4>None</td></tr>"}</tbody>
    </table>
  </div>
  <div class="card">
    <p class="muted">Legal source version: ${escape(result.legalSourceVersion)} · Generated ${escape(result.generatedAt)}</p>
  </div>
</body>
</html>
`;
}

export function renderAgentHandoff(result: DpdpScanResult): string {
  const lines = [
    "# DPDP Agent Handoff",
    "",
    result.disclaimer,
    "",
    "## Deterministic artifacts (source of truth)",
    "",
    "- `.vibedoctor/dpdp/data-map.json`",
    "- `.vibedoctor/dpdp/control-matrix.json`",
    "- `.vibedoctor/dpdp/evidence-ledger.json`",
    "- `.vibedoctor/dpdp/review-queue.md`",
    "",
    "## Scores",
    "",
    `- Technical posture (not legal compliance): ${result.scores.technicalPostureScore}/100`,
    `- Evidence completeness: ${result.scores.evidenceCompletenessPercent}%`,
    "",
    "## Rules for the agent",
    "",
    "1. Consume deterministic artifacts; do not re-implement a compliance engine.",
    "2. Do not mark DETERMINISTIC controls as passed without matching control-matrix status.",
    "3. Do not invent evidence.",
    "4. Do not claim legal certification.",
    "5. Do not calculate a separate compliance percentage.",
    "6. Prefer the minimum human questions from the review queue, grouped by audience.",
    "7. After code changes, re-run `vibedoctor dpdp verify`.",
    `8. Treat legal source version \`${result.legalSourceVersion}\` as an offline baseline. Before interpreting current law, use the DPDP readiness-review skill to verify the latest official primary sources.`,
    "9. If current official sources cannot be verified, report `CURRENT_LEGAL_SOURCES_NOT_VERIFIED`; if they differ, report `LEGAL_SOURCE_DRIFT`. Never silently change deterministic statuses.",
    "",
    "## Fix next (code/config first)",
    ""
  ];

  for (const item of result.fixNext.slice(0, 10)) {
    lines.push(`- **${item.controlId}** [${item.severity}]: ${item.remediation}`);
  }

  lines.push("", "## Human review by audience", "");
  const audiences = Array.from(new Set(result.reviewQueue.map((item) => item.audience)));
  for (const audience of audiences) {
    lines.push(`### ${audience}`);
    for (const item of result.reviewQueue.filter((entry) => entry.audience === audience).slice(0, 8)) {
      lines.push(`- ${item.controlId}: ${item.question}`);
    }
    lines.push("");
  }

  lines.push("## Suggested commands", "");
  lines.push("```bash");
  lines.push("vibedoctor dpdp scan --full");
  lines.push("vibedoctor dpdp review-queue");
  lines.push("vibedoctor dpdp verify");
  lines.push("```");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

export function renderDpdpJsonReport(result: DpdpScanResult): string {
  return `${JSON.stringify(
    {
      disclaimer: result.disclaimer,
      scores: result.scores,
      statusCounts: result.scores.statusCounts,
      openRiskBySeverity: result.scores.openRiskBySeverity,
      dataMap: result.dataMap,
      controlMatrix: result.controlMatrix,
      reviewQueue: result.reviewQueue,
      fixNext: result.fixNext,
      capabilities: result.capabilities,
      findings: result.findings,
      legalSourceVersion: result.legalSourceVersion,
      generatedAt: result.generatedAt
    },
    null,
    2
  )}\n`;
}
