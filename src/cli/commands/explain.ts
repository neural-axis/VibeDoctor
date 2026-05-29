import { buildExplainPayload, runScan } from "../../core/engine";

export async function runExplainCommand(root: string, findingId: string, format: "text" | "json" = "text"): Promise<string> {
  const scan = await runScan(root, "default");
  const payload = buildExplainPayload(scan, findingId);

  if (format === "json") {
    return `${JSON.stringify(payload, null, 2)}\n`;
  }

  if (!payload.finding) {
    return `Finding not found.\nSuggestions:\n- ${payload.suggestions.join("\n- ")}\n`;
  }

  const finding = payload.finding;
  const lines = [
    `Finding: ${finding.id}`,
    `Title: ${finding.title}`,
    `Severity: ${finding.severity}`,
    `Category: ${finding.category}`,
    `File: ${finding.file ?? "n/a"}`,
    `Message: ${finding.message}`,
    "",
    "Suggestions:"
  ];
  payload.suggestions.forEach((suggestion) => lines.push(`- ${suggestion}`));
  if (payload.relatedFindings.length > 0) {
    lines.push("", "Related findings:");
    payload.relatedFindings.slice(0, 5).forEach((related) => lines.push(`- ${related.title}: ${related.message}`));
  }
  if (payload.skippedTools.length > 0) {
    lines.push("", "Skipped tools:");
    payload.skippedTools.forEach((tool) => lines.push(`- ${tool.id}${tool.installHint ? ` — ${tool.installHint}` : ""}`));
  }
  return `${lines.join("\n")}\n`;
}
