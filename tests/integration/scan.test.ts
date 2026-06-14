import { describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { renderAgentJson } from "../../src/reporters/agent";
import { renderTerminalReport } from "../../src/reporters/terminal";
import { createTempFixtureCopy } from "../helpers";

describe("scan pipeline", () => {
  it("finds leftover markers and produces a short terminal report", async () => {
    const root = await createTempFixtureCopy("leftovers");
    const scan = await runScan(root, "quick");

    expect(scan.leftovers.length).toBeGreaterThan(0);
    expect(renderTerminalReport(scan)).toContain("LEFTOVERS");
  });

  it("marks large tested files as refactor candidates in the agent plan", async () => {
    const root = await createTempFixtureCopy("refactor-ready");
    const scan = await runScan(root, "default");
    const agentPlan = renderAgentJson(scan);

    expect(scan.refactorCandidates.length).toBeGreaterThan(0);
    expect(agentPlan).toContain("Do not delete low-confidence dead code.");
  });

  it("reports isolated legacy chains as one dead-chain candidate", async () => {
    const root = await createTempFixtureCopy("dead-code-chain");
    const scan = await runScan(root, "default");

    expect(scan.deadCodeCandidates.some((finding) => finding.source === "custom-dead-chain")).toBe(true);
    expect(renderTerminalReport(scan)).toContain("DEAD CHAINS");
  });

  it("produces deterministic agent JSON for the same scan", async () => {
    const root = await createTempFixtureCopy("leftovers");
    const scan = await runScan(root, "default");

    expect(renderAgentJson(scan)).toBe(renderAgentJson(scan));
  });
});
