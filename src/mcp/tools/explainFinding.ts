import { explainFindingPayload, type McpToolDefinition } from "./shared";

export const explainFindingTool: McpToolDefinition = {
  name: "vibedoctor_explain_finding",
  description: "Explain a specific VibeDoctor finding by finding ID.",
  inputSchema: {
    type: "object",
    required: ["findingId"],
    properties: {
      findingId: {
        type: "string"
      }
    }
  },
  async call(root, args) {
    if (typeof args.findingId !== "string" || args.findingId.trim() === "") {
      throw new Error("findingId is required");
    }

    return explainFindingPayload(root, args.findingId);
  }
};
