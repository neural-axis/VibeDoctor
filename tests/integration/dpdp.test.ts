import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { runScanCommand } from "../../src/cli/commands/scan";
import { runDpdpScanCommand, runDpdpHandoffCommand, runDpdpReviewQueueCommand } from "../../src/cli/commands/dpdp";
import { createTempFixtureCopy } from "../helpers";
import { initAgentPack } from "../../src/agentPack/generateAgentPack";
import { mcpTools } from "../../src/mcp/tools";

describe("DPDP integration", () => {
  it(
    "integrates DPDP findings into the normal scan report and baseline model",
    async () => {
      const root = await createTempFixtureCopy("dpdp/projects/unsafe");
      const scan = await runScan(root, "full");
      const dpdpFindings = scan.findings.filter((finding) => finding.source === "dpdp");
      expect(dpdpFindings.length).toBeGreaterThan(0);
      expect(scan.privacyFindings.some((finding) => finding.source === "dpdp")).toBe(true);

      const command = await runScanCommand(root, { full: true, category: "privacy", report: "json" });
      const json = JSON.parse(command.output) as {
        findings: Array<{ source: string }>;
        dpdpFindings?: unknown[];
        notes?: { dpdp?: string };
      };
      expect(json.findings.some((finding) => finding.source === "dpdp")).toBe(true);
      expect(json.notes?.dpdp?.toLowerCase()).toContain("not legal compliance");
    },
    60_000
  );

  it("writes agent handoff and review queue from CLI", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const handoff = await runDpdpHandoffCommand(root);
    expect(handoff.output).toContain("DPDP Agent Handoff");
    expect(handoff.output).toContain("CURRENT_LEGAL_SOURCES_NOT_VERIFIED");
    expect(handoff.output).toContain("LEGAL_SOURCE_DRIFT");
    expect(handoff.output.toLowerCase()).toContain("not");
    const queue = await runDpdpReviewQueueCommand(root);
    expect(queue.output).toContain("Review Queue");

    const handoffFile = await fs.readFile(path.join(root, ".vibedoctor", "dpdp", "agent-handoff.md"), "utf8");
    expect(handoffFile).toContain("deterministic");
  });

  it("generates the DPDP skill through agent pack pathways", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const result = await initAgentPack(root, { targets: ["codex", "claude", "copilot", "cursor"], force: true });
    expect(result.created.concat(result.updated).some((item) => item.includes("vibedoctor-dpdp-readiness-review"))).toBe(true);
    const skill = await fs.readFile(
      path.join(root, ".agents", "skills", "vibedoctor-dpdp-readiness-review", "SKILL.md"),
      "utf8"
    );
    expect(skill).toContain("vibedoctor dpdp scan");
    expect(skill.toLowerCase()).toContain("legal certification");
  });

  it("registers DPDP MCP tools", () => {
    const names = mcpTools.map((tool) => tool.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "vibedoctor_dpdp_scan",
        "vibedoctor_dpdp_scan_changed",
        "vibedoctor_dpdp_get_data_map",
        "vibedoctor_dpdp_get_control_matrix",
        "vibedoctor_dpdp_get_review_queue",
        "vibedoctor_dpdp_explain_control",
        "vibedoctor_dpdp_get_evidence",
        "vibedoctor_dpdp_verify",
        "vibedoctor_dpdp_generate_handoff"
      ])
    );
  });

  it("runs MCP DPDP scan tool against a fixture", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const tool = mcpTools.find((item) => item.name === "vibedoctor_dpdp_scan");
    expect(tool).toBeDefined();
    const result = (await tool!.call(root, { mode: "full" })) as {
      scores: { technicalPostureScore: number };
      disclaimer: string;
    };
    expect(result.scores.technicalPostureScore).toBeGreaterThanOrEqual(0);
    expect(result.disclaimer.toLowerCase()).toContain("not legal");
  });

  it("CLI terminal report remains short and labelled", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const result = await runDpdpScanCommand(root, { full: true, report: "terminal" });
    expect(result.output).toContain("technical readiness");
    expect(result.output.toLowerCase()).toContain("not legal compliance");
    expect(result.output).toContain("FIX NEXT");
  });
});
