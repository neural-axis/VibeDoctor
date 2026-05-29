import { buildScanResult, categorySchema, parseCategories, prepareScan, type McpToolDefinition } from "./shared";

export const scanChangedTool: McpToolDefinition = {
  name: "vibedoctor_scan_changed",
  description: "Run VibeDoctor on changed files and return normalized health findings.",
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
    const { scan, reportPath, agentPlanPath, exitCode } = await prepareScan(root, "changed", categories);
    return buildScanResult(scan, reportPath, agentPlanPath, exitCode, failOnBlockers);
  }
};
