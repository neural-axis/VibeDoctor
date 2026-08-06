import { promises as fs } from "node:fs";
import path from "node:path";
import type { McpToolDefinition } from "./shared";
import {
  determineDpdpExitCode,
  explainDpdpTarget,
  loadOrScanDpdp,
  runDpdpScan
} from "../../dpdp/scan";
import { DPDP_ARTIFACT_DIR, readDpdpArtifact } from "../../dpdp/artifacts";
import { renderAgentHandoff } from "../../dpdp/report";
import { getConfig } from "../../cli/commands/shared";
import type { ControlMatrix, EvidenceLedger, PersonalDataMap } from "../../dpdp/types";
import { renderReviewQueueMarkdown as renderQueue } from "../../dpdp/reviewQueue";

export const dpdpScanTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_scan",
  description:
    "Run deterministic DPDP technical readiness scan (not legal certification). Returns posture score, control summary, and artifact paths.",
  inputSchema: {
    type: "object",
    properties: {
      mode: { type: "string", enum: ["full", "changed", "default"] }
    }
  },
  async call(root, args) {
    const mode = args.mode === "changed" ? "changed" : args.mode === "default" ? "default" : "full";
    const result = await runDpdpScan(root, mode);
    const { config } = await getConfig(root);
    return {
      disclaimer: result.disclaimer,
      mode: result.mode,
      scores: result.scores,
      statusCounts: result.scores.statusCounts,
      fixNext: result.fixNext,
      capabilities: result.capabilities,
      exitCode: determineDpdpExitCode(result, config),
      artifactDir: DPDP_ARTIFACT_DIR,
      findingCount: result.findings.length
    };
  }
};

export const dpdpScanChangedTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_scan_changed",
  description:
    "Run DPDP technical readiness with collection scoped to git changed files. Falls back to full scope if no delta. Control matrix remains full catalogue.",
  inputSchema: { type: "object", properties: {} },
  async call(root) {
    return dpdpScanTool.call(root, { mode: "changed" });
  }
};

export const dpdpGetDataMapTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_get_data_map",
  description: "Get the personal-data processing map. Uses cached artifacts unless refresh=true; scans if missing.",
  inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
  async call(root, args) {
    if (args.refresh !== true) {
      const cached = await readDpdpArtifact<PersonalDataMap>(root, "data-map.json");
      if (cached) {
        return cached;
      }
    }
    const result = await runDpdpScan(root, "full");
    return result.dataMap;
  }
};

export const dpdpGetControlMatrixTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_get_control_matrix",
  description: "Get the DPDP control matrix. Uses cached artifacts unless refresh=true; scans if missing.",
  inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
  async call(root, args) {
    if (args.refresh !== true) {
      const cached = await readDpdpArtifact<ControlMatrix>(root, "control-matrix.json");
      if (cached) {
        return cached;
      }
    }
    const result = await runDpdpScan(root, "full");
    return result.controlMatrix;
  }
};

export const dpdpGetReviewQueueTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_get_review_queue",
  description: "Get DPDP human-review questions grouped by audience. Uses cache unless refresh=true.",
  inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
  async call(root, args) {
    const result = await loadOrScanDpdp(root, "full", args.refresh === true);
    return { markdown: renderQueue(result.reviewQueue), items: result.reviewQueue };
  }
};

export const dpdpExplainControlTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_explain_control",
  description: "Explain a DPDP control or finding id using cached artifacts unless refresh=true.",
  inputSchema: {
    type: "object",
    properties: {
      id: { type: "string" },
      refresh: { type: "boolean" }
    },
    required: ["id"]
  },
  async call(root, args) {
    if (typeof args.id !== "string" || !args.id.trim()) {
      throw new Error("id is required");
    }
    return explainDpdpTarget(root, args.id.trim(), { refresh: args.refresh === true });
  }
};

export const dpdpGetEvidenceTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_get_evidence",
  description: "Get the DPDP evidence ledger (masked/classified; no raw PII). Uses cache unless refresh=true.",
  inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
  async call(root, args) {
    if (args.refresh !== true) {
      const cached = await readDpdpArtifact<EvidenceLedger>(root, "evidence-ledger.json");
      if (cached) {
        return cached;
      }
    }
    const result = await runDpdpScan(root, "full");
    return result.evidenceLedger;
  }
};

export const dpdpVerifyTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_verify",
  description: "Re-run DPDP technical readiness scan for post-change verification (changed-file scope).",
  inputSchema: { type: "object", properties: {} },
  async call(root) {
    return dpdpScanTool.call(root, { mode: "changed" });
  }
};

export const dpdpHandoffTool: McpToolDefinition = {
  name: "vibedoctor_dpdp_generate_handoff",
  description: "Generate agent handoff markdown from DPDP artifacts. Uses cache unless refresh=true.",
  inputSchema: { type: "object", properties: { refresh: { type: "boolean" } } },
  async call(root, args) {
    const result = await loadOrScanDpdp(root, "full", args.refresh === true);
    const content = renderAgentHandoff(result);
    const handoffPath = path.join(root, DPDP_ARTIFACT_DIR, "agent-handoff.md");
    await fs.mkdir(path.dirname(handoffPath), { recursive: true });
    await fs.writeFile(handoffPath, content, "utf8");
    return { path: path.join(DPDP_ARTIFACT_DIR, "agent-handoff.md").replaceAll("\\", "/"), content };
  }
};

export const dpdpMcpTools: McpToolDefinition[] = [
  dpdpScanTool,
  dpdpScanChangedTool,
  dpdpGetDataMapTool,
  dpdpGetControlMatrixTool,
  dpdpGetReviewQueueTool,
  dpdpExplainControlTool,
  dpdpGetEvidenceTool,
  dpdpVerifyTool,
  dpdpHandoffTool
];
