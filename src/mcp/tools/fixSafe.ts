import { fixSafePayload, type McpToolDefinition } from "./shared";

export const fixSafeTool: McpToolDefinition = {
  name: "vibedoctor_fix_safe",
  description: "Run VibeDoctor safe fixes and return before/after finding counts.",
  inputSchema: {
    type: "object",
    properties: {}
  },
  async call(root) {
    return fixSafePayload(root);
  }
};
