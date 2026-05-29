import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureDir, normalizeToPosix, pathExists } from "../core/paths";
import { defaultAgentPolicy, renderAgentPolicy } from "./policy";
import {
  AGENT_SKILLS,
  DEFAULT_SKILL_NAMES,
  renderAgentsMd,
  renderCopilotInstructions,
  renderCursorMcpConfig,
  renderCursorRule,
  renderGenericMcpConfig
} from "./templates";

export const AGENT_TARGETS = ["codex", "copilot", "claude", "cursor"] as const;

export type AgentTarget = (typeof AGENT_TARGETS)[number];

export type AgentPackManifest = {
  version: number;
  generatedBy: string;
  generatedAt: string;
  targets: AgentTarget[];
  skills: string[];
  files: {
    agents: string;
    canonicalSkillDir: string;
    policy: string;
    manifest: string;
    shims: Partial<Record<AgentTarget, string[]>>;
  };
};

export type AgentPackApplyResult = {
  created: string[];
  updated: string[];
  skipped: string[];
};

export type AgentPackDoctorItem = {
  status: "ok" | "warn";
  message: string;
};

export type AgentPackDoctorResult = {
  ok: boolean;
  items: AgentPackDoctorItem[];
};

type ApplyOptions = {
  force?: boolean;
};

function toAbsolutePath(root: string, relativePath: string): string {
  return path.join(root, ...relativePath.split("/"));
}

function normalizeRelativePath(relativePath: string): string {
  return normalizeToPosix(relativePath);
}

function uniqueTargets(targets: AgentTarget[]): AgentTarget[] {
  return Array.from(new Set(targets));
}

function mergeApplyResults(...results: AgentPackApplyResult[]): AgentPackApplyResult {
  return {
    created: Array.from(new Set(results.flatMap((result) => result.created))),
    updated: Array.from(new Set(results.flatMap((result) => result.updated))),
    skipped: Array.from(new Set(results.flatMap((result) => result.skipped)))
  };
}

async function writeManagedFile(root: string, relativePath: string, content: string, options: ApplyOptions = {}): Promise<AgentPackApplyResult> {
  const normalizedPath = normalizeRelativePath(relativePath);
  const absolutePath = toAbsolutePath(root, normalizedPath);
  const exists = await pathExists(absolutePath);

  if (exists && !options.force) {
    return { created: [], updated: [], skipped: [normalizedPath] };
  }

  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, content, "utf8");

  return exists ? { created: [], updated: [normalizedPath], skipped: [] } : { created: [normalizedPath], updated: [], skipped: [] };
}

async function writeManagedFiles(
  root: string,
  files: Array<{ path: string; content: string }>,
  options: ApplyOptions = {}
): Promise<AgentPackApplyResult> {
  const results = await Promise.all(files.map((file) => writeManagedFile(root, file.path, file.content, options)));
  return mergeApplyResults(...results);
}

async function listFilesRecursive(root: string, currentDir: string): Promise<string[]> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFilesRecursive(root, absolutePath)));
      continue;
    }

    files.push(normalizeToPosix(path.relative(root, absolutePath)));
  }

  return files;
}

async function copyCanonicalSkills(root: string, destinationRoot: string, options: ApplyOptions = {}): Promise<AgentPackApplyResult> {
  const results: AgentPackApplyResult[] = [];

  for (const skill of AGENT_SKILLS) {
    const sourceRoot = toAbsolutePath(root, `.agents/skills/${skill.name}`);
    const files = await listFilesRecursive(sourceRoot, sourceRoot);

    for (const file of files) {
      const sourcePath = path.join(sourceRoot, ...file.split("/"));
      const content = await fs.readFile(sourcePath, "utf8");
      results.push(await writeManagedFile(root, `${destinationRoot}/${skill.name}/${file}`, content, options));
    }
  }

  return mergeApplyResults(...results);
}

function buildManifest(targets: AgentTarget[]): AgentPackManifest {
  return {
    version: 1,
    generatedBy: "vibedoctor",
    generatedAt: new Date().toISOString(),
    targets: uniqueTargets(targets),
    skills: DEFAULT_SKILL_NAMES,
    files: {
      agents: "AGENTS.md",
      canonicalSkillDir: ".agents/skills",
      policy: ".vibedoctor/agent-policy.yml",
      manifest: ".vibedoctor/agent-pack.json",
      shims: {
        codex: ["AGENTS.md", ".agents/skills"],
        copilot: [".github/skills", ".github/copilot-instructions.md"],
        claude: [".claude/skills"],
        cursor: [".cursor/rules/vibedoctor.mdc", ".cursor/mcp.json", ".mcp/vibedoctor.json"]
      }
    }
  };
}

function renderManifest(targets: AgentTarget[]): string {
  return `${JSON.stringify(buildManifest(targets), null, 2)}\n`;
}

export async function loadAgentPackManifest(root: string): Promise<AgentPackManifest | undefined> {
  const manifestPath = toAbsolutePath(root, ".vibedoctor/agent-pack.json");
  if (!(await pathExists(manifestPath))) {
    return undefined;
  }

  const parsed = JSON.parse(await fs.readFile(manifestPath, "utf8")) as Partial<AgentPackManifest>;
  const targets: AgentTarget[] = Array.isArray(parsed.targets)
    ? parsed.targets.filter((target): target is AgentTarget => typeof target === "string" && AGENT_TARGETS.includes(target as AgentTarget))
    : ["codex"];

  return {
    version: parsed.version ?? 1,
    generatedBy: parsed.generatedBy ?? "vibedoctor",
    generatedAt: parsed.generatedAt ?? "",
    targets,
    skills: Array.isArray(parsed.skills) ? parsed.skills.map((skill) => String(skill)) : DEFAULT_SKILL_NAMES,
    files: parsed.files ?? buildManifest(targets).files
  };
}

export function parseAgentTargets(value: string | undefined, fallback: AgentTarget[] = ["codex"]): AgentTarget[] {
  if (!value) {
    return uniqueTargets(fallback);
  }

  const parts = value
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);

  if (parts.includes("all")) {
    return [...AGENT_TARGETS];
  }

  const invalid = parts.filter((target) => !AGENT_TARGETS.includes(target as AgentTarget));
  if (invalid.length > 0) {
    throw new Error(`Unsupported agent target(s): ${invalid.join(", ")}`);
  }

  return uniqueTargets(parts as AgentTarget[]);
}

export async function generateCanonicalAgentPack(
  root: string,
  options: { targets: AgentTarget[]; force?: boolean }
): Promise<AgentPackApplyResult> {
  const files = [
    { path: "AGENTS.md", content: renderAgentsMd() },
    { path: ".vibedoctor/agent-policy.yml", content: renderAgentPolicy(defaultAgentPolicy) },
    ...AGENT_SKILLS.flatMap((skill) => [
      {
        path: `.agents/skills/${skill.name}/SKILL.md`,
        content: skill.content
      },
      {
        path: `.agents/skills/${skill.name}/agents/openai.yaml`,
        content: skill.openAiMetadata
      }
    ])
  ];

  return mergeApplyResults(
    await writeManagedFiles(root, files, { force: options.force }),
    await writeManagedFile(root, ".vibedoctor/agent-pack.json", renderManifest(options.targets), { force: true })
  );
}

export async function syncAgentPack(root: string, options: { targets: AgentTarget[]; force?: boolean }): Promise<AgentPackApplyResult> {
  const canonical = await generateCanonicalAgentPack(root, { targets: options.targets, force: options.force });
  const results: AgentPackApplyResult[] = [canonical];

  if (options.targets.includes("claude")) {
    results.push(await copyCanonicalSkills(root, ".claude/skills", { force: options.force }));
  }

  if (options.targets.includes("copilot")) {
    results.push(await copyCanonicalSkills(root, ".github/skills", { force: options.force }));
    results.push(
      await writeManagedFile(root, ".github/copilot-instructions.md", renderCopilotInstructions(), {
        force: options.force
      })
    );
  }

  if (options.targets.includes("cursor")) {
    results.push(
      await writeManagedFiles(
        root,
        [
          { path: ".cursor/rules/vibedoctor.mdc", content: renderCursorRule() },
          { path: ".cursor/mcp.json", content: renderCursorMcpConfig() },
          { path: ".mcp/vibedoctor.json", content: renderGenericMcpConfig() }
        ],
        { force: options.force }
      )
    );
  }

  return mergeApplyResults(...results);
}

export async function initAgentPack(root: string, options: { targets: AgentTarget[]; force?: boolean }): Promise<AgentPackApplyResult> {
  const canonical = await generateCanonicalAgentPack(root, options);
  const shimTargets = options.targets.filter((target) => target !== "codex");

  if (shimTargets.length === 0) {
    return canonical;
  }

  const shims = await syncAgentPack(root, options);
  return mergeApplyResults(canonical, shims);
}

export async function packAgentPack(root: string, options: { targets?: AgentTarget[]; force?: boolean } = {}): Promise<AgentPackApplyResult> {
  const manifest = await loadAgentPackManifest(root);
  const targets = options.targets ?? manifest?.targets ?? ["codex"];
  return generateCanonicalAgentPack(root, { targets, force: options.force });
}

export async function doctorAgentPack(root: string, targets?: AgentTarget[]): Promise<AgentPackDoctorResult> {
  const manifest = await loadAgentPackManifest(root);
  const effectiveTargets = targets ?? manifest?.targets ?? ["codex"];
  const items: AgentPackDoctorItem[] = [];

  async function check(relativePath: string, okMessage: string, warnMessage = `${relativePath} missing`): Promise<void> {
    const exists = await pathExists(toAbsolutePath(root, relativePath));
    items.push({
      status: exists ? "ok" : "warn",
      message: exists ? okMessage : warnMessage
    });
  }

  await check("AGENTS.md", "AGENTS.md exists");
  await check(".vibedoctor/agent-pack.json", ".vibedoctor/agent-pack.json exists");
  await check(".vibedoctor/agent-policy.yml", ".vibedoctor/agent-policy.yml exists");
  await check(
    ".agents/skills/vibedoctor-health-scan/SKILL.md",
    ".agents/skills/vibedoctor-health-scan/SKILL.md exists",
    "Canonical agent skills missing"
  );

  if (effectiveTargets.includes("claude")) {
    await check(
      ".claude/skills/vibedoctor-health-scan/SKILL.md",
      "Claude skills installed",
      "Claude skills not installed"
    );
  }

  if (effectiveTargets.includes("copilot")) {
    await check(
      ".github/copilot-instructions.md",
      "Copilot instructions exist",
      "Copilot instructions missing"
    );
    await check(".github/skills/vibedoctor-health-scan/SKILL.md", "Copilot skills installed", "Copilot skills not installed");
  }

  if (effectiveTargets.includes("cursor")) {
    await check(".cursor/rules/vibedoctor.mdc", "Cursor rule exists", "Cursor rule missing");
    await check(".cursor/mcp.json", "Cursor MCP config exists", "Cursor MCP config missing");
    await check(".mcp/vibedoctor.json", "Generic MCP config exists", "Generic MCP config missing");
  }

  return {
    ok: items.every((item) => item.status === "ok"),
    items
  };
}
