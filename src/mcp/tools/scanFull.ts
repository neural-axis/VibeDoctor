import { buildScanResult, categorySchema, parseCategories, prepareScan, type McpToolDefinition } from "./shared";

export const scanFullTool: McpToolDefinition = {
  name: "vibedoctor_scan_full",
  description: "Run VibeDoctor on the full repository and return normalized health findings.",
  inputSchema: {
    type: "object",
    properties: {
      categories: categorySchema,
      failOnBlockers: {
        type: "boolean"
      }
    }
  },
  async call(root, args) {
    const categories = parseCategories(args.categories);
    const failOnBlockers = args.failOnBlockers === true;
    const { scan, reportPath, agentPlanPath, exitCode } = await prepareScan(root, "full", categories);
    return buildScanResult(scan, reportPath, agentPlanPath, exitCode, failOnBlockers);
  }
};
