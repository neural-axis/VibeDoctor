import { runScan } from "../../core/engine";
import { renderAgentMarkdown } from "../../reporters/agent";
import { renderHtmlReport } from "../../reporters/html";
import { renderJsonReport } from "../../reporters/json";
import { renderMarkdownReport } from "../../reporters/markdown";
import { renderSarif } from "../../reporters/sarif";

export async function runReportCommand(
  root: string,
  format: "json" | "html" | "markdown" | "agent" | "sarif" | "full" = "json"
): Promise<string> {
  const scan = await runScan(root, "full");

  switch (format) {
    case "html":
      return renderHtmlReport(scan);
    case "markdown":
    case "full":
      return renderMarkdownReport(scan);
    case "agent":
      return renderAgentMarkdown(scan);
    case "sarif":
      return renderSarif(scan);
    default:
      return renderJsonReport(scan);
  }
}
