import { readReportJson, type McpToolDefinition } from "./shared";

export const getReportTool: McpToolDefinition = {
  name: "vibedoctor_get_report",
  description: "Read the current VibeDoctor JSON report, optionally refreshing it first.",
  inputSchema: {
    type: "object",
    properties: {
      refresh: {
        type: "boolean"
      },
      mode: {
        type: "string",
        enum: ["changed", "full"]
      }
    }
  },
  async call(root, args) {
    const mode = args.mode === "full" ? "full" : "changed";
    return {
      report: await readReportJson(root, args.refresh === true, mode)
    };
  }
};
