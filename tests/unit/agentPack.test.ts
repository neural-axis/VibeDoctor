import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { AGENT_SKILLS } from "../../src";
import {
  doctorAgentPack,
  generateAgentPluginBundle,
  initAgentPack,
  syncAgentPack
} from "../../src/agentPack/generateAgentPack";
import { runAgentPluginCommand } from "../../src/cli/commands/agent";

async function createTempRepo(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-agent-pack-"));
}

describe("agent pack generator", () => {
  it("creates canonical files for codex by default", async () => {
    const root = await createTempRepo();
    const result = await initAgentPack(root, { targets: ["codex"] });

    expect(result.created).toContain("AGENTS.md");
    expect(result.created).toContain(".agents/skills/vibedoctor-health-scan/SKILL.md");
    expect(result.created).toContain(".agents/skills/vibedoctor-privacy-review/SKILL.md");
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
    expect(result.created).toContain(".claude/skills/vibedoctor-privacy-review/SKILL.md");
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

  it("generates Codex and Claude plugin manifests plus skill files", async () => {
    const root = await createTempRepo();
    const result = await generateAgentPluginBundle(root, { targets: ["codex", "claude"] });

    expect(result.created).toContain("plugins/vibedoctor/.codex-plugin/plugin.json");
    expect(result.created).toContain("plugins/vibedoctor/.claude-plugin/plugin.json");
    expect(result.created).toContain("plugins/vibedoctor/skills/vibedoctor-health-scan/SKILL.md");
    expect(result.created).toContain("plugins/vibedoctor/skills/vibedoctor-privacy-review/SKILL.md");

    const codexManifest = JSON.parse(await fs.readFile(path.join(root, "plugins", "vibedoctor", ".codex-plugin", "plugin.json"), "utf8"));
    const claudeManifest = JSON.parse(await fs.readFile(path.join(root, "plugins", "vibedoctor", ".claude-plugin", "plugin.json"), "utf8"));

    expect(codexManifest.name).toBe("vibedoctor");
    expect(codexManifest.skills).toBe("./skills/");
    expect(codexManifest.interface.displayName).toBe("VibeDoctor");
    expect(claudeManifest.name).toBe("vibedoctor");
    expect(claudeManifest.version).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("keeps generated plugin skills in sync with canonical skill templates and .agents skills", async () => {
    const root = await createTempRepo();
    await initAgentPack(root, { targets: ["codex"] });
    await generateAgentPluginBundle(root, { targets: ["codex", "claude"] });

    for (const skill of AGENT_SKILLS) {
      const canonicalContent = await fs.readFile(path.join(root, ".agents", "skills", skill.name, "SKILL.md"), "utf8");
      const pluginContent = await fs.readFile(path.join(root, "plugins", "vibedoctor", "skills", skill.name, "SKILL.md"), "utf8");

      expect(pluginContent).toBe(skill.content);
      expect(pluginContent).toBe(canonicalContent);
    }
  });

  it("does not overwrite plugin files without force", async () => {
    const root = await createTempRepo();
    const manifestPath = path.join(root, "plugins", "vibedoctor", ".codex-plugin", "plugin.json");
    await fs.mkdir(path.dirname(manifestPath), { recursive: true });
    await fs.writeFile(manifestPath, "{\"name\":\"custom\"}\n", "utf8");

    const result = await generateAgentPluginBundle(root, { targets: ["codex"] });

    expect(result.skipped).toContain("plugins/vibedoctor/.codex-plugin/plugin.json");
    expect(await fs.readFile(manifestPath, "utf8")).toBe("{\"name\":\"custom\"}\n");

    await generateAgentPluginBundle(root, { targets: ["codex"], force: true });
    expect(await fs.readFile(manifestPath, "utf8")).toContain('"name": "vibedoctor"');
  });

  it("runs the agent plugin CLI command with default, target, and targets options", async () => {
    const defaultRoot = await createTempRepo();
    const defaultOutput = await runAgentPluginCommand(defaultRoot, {});

    expect(defaultOutput).toContain("VibeDoctor Agent Plugin bundle generated");
    expect(await fs.readFile(path.join(defaultRoot, "plugins", "vibedoctor", ".codex-plugin", "plugin.json"), "utf8")).toContain(
      '"name": "vibedoctor"'
    );
    expect(await fs.readFile(path.join(defaultRoot, "plugins", "vibedoctor", ".claude-plugin", "plugin.json"), "utf8")).toContain(
      '"name": "vibedoctor"'
    );

    const codexRoot = await createTempRepo();
    const codexOutput = await runAgentPluginCommand(codexRoot, { target: "codex" });
    expect(codexOutput).toContain("plugins/vibedoctor/.codex-plugin/plugin.json");
    await expect(fs.access(path.join(codexRoot, "plugins", "vibedoctor", ".claude-plugin", "plugin.json"))).rejects.toThrow();

    const allRoot = await createTempRepo();
    const allOutput = await runAgentPluginCommand(allRoot, { targets: "all" });
    expect(allOutput).toContain("plugins/vibedoctor/.codex-plugin/plugin.json");
    expect(allOutput).toContain("plugins/vibedoctor/.claude-plugin/plugin.json");

    const noOverwriteRoot = await createTempRepo();
    await runAgentPluginCommand(noOverwriteRoot, { target: "codex" });
    const skillPath = path.join(noOverwriteRoot, "plugins", "vibedoctor", "skills", "vibedoctor-health-scan", "SKILL.md");
    await fs.writeFile(skillPath, "custom skill\n", "utf8");

    const skippedOutput = await runAgentPluginCommand(noOverwriteRoot, { target: "codex" });
    expect(skippedOutput).toContain("Skipped:");
    expect(await fs.readFile(skillPath, "utf8")).toBe("custom skill\n");

    await runAgentPluginCommand(noOverwriteRoot, { target: "codex", force: true });
    expect(await fs.readFile(skillPath, "utf8")).toContain("# VibeDoctor Health Scan");
  });
});
