import { getAgentPlanPayload, type McpToolDefinition } from "./shared";

function parseTarget(value: unknown): "generic" | "codex" | "copilot" | "claude" | "cursor" {
  if (value === "codex" || value === "copilot" || value === "claude" || value === "cursor") {
    return value;
  }

  return "generic";
}

export const getAgentPlanTool: McpToolDefinition = {
  name: "vibedoctor_get_agent_plan",
  description: "Return the current VibeDoctor agent plan in JSON or markdown.",
  inputSchema: {
    type: "object",
    properties: {
      format: {
        type: "string",
        enum: ["json", "markdown"]
      },
      target: {
        type: "string",
        enum: ["generic", "codex", "copilot", "claude", "cursor"]
      }
    }
  },
  async call(root, args) {
    const format = args.format === "markdown" ? "markdown" : "json";
    return getAgentPlanPayload(root, format, parseTarget(args.target));
  }
};
