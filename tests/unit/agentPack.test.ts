import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { doctorAgentPack, initAgentPack, syncAgentPack } from "../../src/agentPack/generateAgentPack";

async function createTempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-agent-pack-"));
}

describe("agent pack generator", () => {
  it("creates canonical files for codex by default", async () => {
    const root = await createTempRepo();
    const result = await initAgentPack(root, { targets: ["codex"] });

    expect(result.created).toContain("AGENTS.md");
    expect(result.created).toContain(".agents/skills/vibedoctor-health-scan/SKILL.md");
    expect(result.created).toContain(".agents/skills/vibedoctor-health-scan/agents/openai.yaml");
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toContain("## VibeDoctor workflow");
    expect(await fs.readFile(path.join(root, ".agents", "skills", "vibedoctor-health-scan", "SKILL.md"), "utf8")).toContain(
      'description: "Run and interpret VibeDoctor health scans'
    );
  });

  it("syncs compatibility shims for claude, copilot, and cursor", async () => {
    const root = await createTempRepo();
    await initAgentPack(root, { targets: ["codex"] });

    const result = await syncAgentPack(root, { targets: ["claude", "copilot", "cursor"] });

    expect(result.created).toContain(".claude/skills/vibedoctor-health-scan/SKILL.md");
    expect(result.created).toContain(".claude/skills/vibedoctor-health-scan/agents/openai.yaml");
    expect(result.created).toContain(".github/copilot-instructions.md");
    expect(result.created).toContain(".github/skills/vibedoctor-health-scan/agents/openai.yaml");
    expect(result.created).toContain(".cursor/mcp.json");
  });

  it("does not overwrite managed files without force", async () => {
    const root = await createTempRepo();
    await fs.writeFile(path.join(root, "AGENTS.md"), "custom instructions\n", "utf8");

    const result = await initAgentPack(root, { targets: ["codex"] });

    expect(result.skipped).toContain("AGENTS.md");
    expect(await fs.readFile(path.join(root, "AGENTS.md"), "utf8")).toBe("custom instructions\n");
  });

  it("reports missing target shims in doctor output", async () => {
    const root = await createTempRepo();
    await initAgentPack(root, { targets: ["codex"] });

    const doctor = await doctorAgentPack(root, ["claude", "copilot", "cursor"]);

    expect(doctor.ok).toBe(false);
    expect(doctor.items.some((item) => item.message === "Claude skills not installed")).toBe(true);
    expect(doctor.items.some((item) => item.message === "Copilot instructions missing")).toBe(true);
    expect(doctor.items.some((item) => item.message === "Cursor MCP config missing")).toBe(true);
  });
});
