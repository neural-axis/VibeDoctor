import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSetupPlan, runSetupCommand } from "../../src/cli/commands/setup";

describe("setup command", () => {
  it("renders an essential setup plan without installing tools", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-setup-ts-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }), "utf8");
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const result = await runSetupCommand(root);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("VibeDoctor setup");
    expect(result.output).toContain("Detected languages: typescript");
    expect(result.output).toContain("Already built in");
    expect(result.output).toContain("custom-leftovers");
    expect(result.output).toContain("gitleaks");
  });

  it("adds recommended tools when requested", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-setup-recommended-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), "{}", "utf8");
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");

    const plan = await createSetupPlan(root, "recommended");
    const knownRecommended = new Set([
      ...plan.available.map((tool) => tool.id),
      ...plan.npmPackages,
      ...plan.pythonPackages,
      ...plan.manual.map((tool) => tool.id),
      ...plan.skipped.map((tool) => tool.id)
    ]);

    expect(knownRecommended.has("jscpd")).toBe(true);
  });
});