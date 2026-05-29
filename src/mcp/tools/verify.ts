import { buildScanResult, prepareScan, type McpToolDefinition } from "./shared";

export const verifyTool: McpToolDefinition = {
  name: "vibedoctor_verify",
  description: "Run the standard changed-file verification pass and return the result.",
  inputSchema: {
    type: "object",
    properties: {
      failOnBlockers: {
        type: "boolean"
      }
    }
  },
  async call(root, args) {
    const failOnBlockers = args.failOnBlockers === true;
    const { scan, reportPath, agentPlanPath, exitCode } = await prepareScan(root, "changed");
    return buildScanResult(scan, reportPath, agentPlanPath, exitCode, failOnBlockers);
  }
};
