import path from "node:path";
import type { CommandSpec, ToolResult } from "../../core/toolRunner";
import { runCommand } from "../../core/toolRunner";
import { detectProject, type PackageManager, type ProjectContext, type ProjectLanguage } from "../../core/projectDetector";
import { pathExists } from "../../core/paths";

export type SetupPriority = "essential" | "recommended";
export type SetupInclude = "essential" | "recommended" | "all" | "npm" | "python" | "manual" | "built-in";

export type SetupOptions = {
  apply?: boolean;
  include?: SetupInclude;
};

type SetupTool = {
  id: string;
  packageName?: string;
  executable?: string;
  ecosystem: "npm" | "python" | "manual" | "built-in";
  priority: SetupPriority;
  languages?: ProjectLanguage[];
  requiresLockfile?: boolean;
  reason: string;
  installHint?: string;
};

export type SetupPlan = {
  project: ProjectContext;
  builtIn: SetupTool[];
  available: SetupTool[];
  npmPackages: string[];
  pythonPackages: string[];
  manual: SetupTool[];
  skipped: SetupTool[];
  commands: CommandSpec[];
};

const VALID_SETUP_INCLUDES = new Set<SetupInclude>(["essential", "recommended", "all", "npm", "python", "manual", "built-in"]);

const essentialTools: SetupTool[] = [
  {
    id: "custom-leftovers",
    ecosystem: "built-in",
    priority: "essential",
    reason: "Finds stale TODOs, commented-out code, legacy fallback paths, and AI leftovers without any external install."
  },
  {
    id: "custom-dead-chain",
    ecosystem: "built-in",
    priority: "essential",
    reason: "Finds isolated file clusters after external dead-code tools report candidates."
  },
  {
    id: "custom-refactor",
    ecosystem: "built-in",
    priority: "essential",
    reason: "Finds large or complex files that need tests before refactor work."
  },
  {
    id: "tsc",
    packageName: "typescript",
    executable: "tsc",
    ecosystem: "npm",
    priority: "essential",
    languages: ["typescript"],
    reason: "TypeScript correctness signal."
  },
  {
    id: "biome",
    packageName: "@biomejs/biome",
    executable: "biome",
    ecosystem: "npm",
    priority: "essential",
    languages: ["javascript", "typescript"],
    reason: "Fast JS/TS lint and safe formatting signal."
  },
  {
    id: "knip",
    packageName: "knip",
    executable: "knip",
    ecosystem: "npm",
    priority: "essential",
    languages: ["javascript", "typescript"],
    reason: "Unused files, exports, and dependency signal for JS/TS."
  },
  {
    id: "ruff",
    packageName: "ruff",
    executable: "ruff",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    reason: "Python lint and safe-fix signal."
  },
  {
    id: "pyright",
    packageName: "pyright",
    executable: "pyright",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    reason: "Python type correctness signal."
  },
  {
    id: "vulture",
    packageName: "vulture",
    executable: "vulture",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    reason: "Python dead-code signal."
  },
  {
    id: "gitleaks",
    executable: "gitleaks",
    ecosystem: "manual",
    priority: "essential",
    reason: "Secret detection across every repository.",
    installHint: "Install Gitleaks from https://gitleaks.io/ or your OS package manager."
  },
  {
    id: "osv-scanner",
    executable: "osv-scanner",
    ecosystem: "manual",
    priority: "essential",
    requiresLockfile: true,
    reason: "Known-vulnerability detection for dependency lockfiles.",
    installHint: "Install OSV-Scanner from https://google.github.io/osv-scanner/ or your OS package manager."
  }
];

const recommendedTools: SetupTool[] = [
  {
    id: "jscpd",
    packageName: "jscpd",
    executable: "jscpd",
    ecosystem: "npm",
    priority: "recommended",
    languages: ["javascript", "typescript"],
    reason: "Duplication signal for refactor planning."
  },
  {
    id: "coverage.py",
    packageName: "coverage",
    executable: "coverage",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    reason: "Python coverage signal."
  },
  {
    id: "radon",
    packageName: "radon",
    executable: "radon",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    reason: "Python complexity signal."
  },
  {
    id: "deptry",
    packageName: "deptry",
    executable: "deptry",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    reason: "Python dependency hygiene signal."
  },
  {
    id: "lizard",
    executable: "lizard",
    ecosystem: "manual",
    priority: "recommended",
    reason: "Function-level complexity and code size hotspots (great for spotting refactor candidates).",
    installHint: "Install Lizard with: pipx install lizard, uv tool install lizard, or your OS package manager."
  },
  {
    id: "semgrep",
    executable: "semgrep",
    ecosystem: "manual",
    priority: "recommended",
    reason: "Additional security and correctness rules.",
    installHint: "Install Semgrep with: pipx install semgrep, uv tool install semgrep, or your OS package manager."
  }
];

function hasActiveLanguage(project: ProjectContext, language: ProjectLanguage): boolean {
  if (!project.languages.includes(language)) {
    return false;
  }

  if (language === "python" && project.packageManagers.some((manager) => ["pip", "uv", "poetry", "pdm"].includes(manager))) {
    return true;
  }

  if ((language === "javascript" || language === "typescript") && project.packageManagers.some((manager) => ["npm", "pnpm", "yarn", "bun"].includes(manager))) {
    return true;
  }

  const sourcePattern =
    language === "python"
      ? /^(src|app|packages|services)\/.*\.py$/
      : language === "typescript"
        ? /^(src|app|packages|services)\/.*\.tsx?$/
        : /^(src|app|packages|services)\/.*\.jsx?$/;

  return project.projectFiles.some((file) => sourcePattern.test(file));
}

function includesAnyLanguage(project: ProjectContext, languages: ProjectLanguage[] | undefined): boolean {
  return !languages || languages.some((language) => hasActiveLanguage(project, language));
}

function activeLanguages(project: ProjectContext): ProjectLanguage[] {
  return project.languages.filter((language) => hasActiveLanguage(project, language));
}

function appliesToProject(tool: SetupTool, project: ProjectContext): boolean {
  if (!includesAnyLanguage(project, tool.languages)) {
    return false;
  }

  if (tool.requiresLockfile && project.lockfiles.length === 0) {
    return false;
  }

  return true;
}

function isToolAvailable(tool: SetupTool, project: ProjectContext): boolean {
  if (!tool.executable) {
    return false;
  }
  return Boolean(project.toolsAvailable[tool.executable] ?? project.toolsAvailable[tool.id]);
}

function jsPackageManager(project: ProjectContext): PackageManager | undefined {
  return ["pnpm", "yarn", "bun", "npm"].find((manager) => project.packageManagers.includes(manager as PackageManager)) as PackageManager | undefined;
}

function jsInstallCommand(root: string, manager: PackageManager, packages: string[]): CommandSpec {
  if (manager === "pnpm") {
    return { cmd: "pnpm", args: ["add", "-D", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (manager === "yarn") {
    return { cmd: "yarn", args: ["add", "-D", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (manager === "bun") {
    return { cmd: "bun", args: ["add", "-d", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  return { cmd: "npm", args: ["install", "-D", ...packages], cwd: root, timeoutMs: 180_000 };
}

async function pythonInstallCommand(root: string, project: ProjectContext, packages: string[]): Promise<CommandSpec | undefined> {
  if (project.packageManagers.includes("uv")) {
    return { cmd: "uv", args: ["add", "--dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (project.packageManagers.includes("poetry")) {
    return { cmd: "poetry", args: ["add", "--group", "dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (project.packageManagers.includes("pdm")) {
    return { cmd: "pdm", args: ["add", "-dG", "dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }

  const hasLocalVenv = Boolean(process.env.VIRTUAL_ENV) || (await pathExists(path.join(root, ".venv"))) || (await pathExists(path.join(root, "venv")));
  if (!hasLocalVenv) {
    return undefined;
  }

  return { cmd: "python", args: ["-m", "pip", "install", "-U", ...packages], cwd: root, timeoutMs: 180_000 };
}

function commandText(command: CommandSpec): string {
  return [command.cmd, ...command.args].join(" ");
}

function resolveTools(include: SetupInclude): SetupTool[] {
  if (include === "essential") {
    return essentialTools;
  }

  const combined = [...essentialTools, ...recommendedTools];
  if (include === "recommended" || include === "all") {
    // "recommended" is the sensible default experience (essential + high-value extras).
    // "all" currently resolves to the same set (add future extended tools here if needed).
    return combined;
  }

  return combined.filter((tool) => tool.ecosystem === include);
}

export async function createSetupPlan(root: string, include: SetupInclude = "recommended"): Promise<SetupPlan> {
  const project = await detectProject(root);
  const tools = resolveTools(include);
  const relevantTools = tools.filter((tool) => appliesToProject(tool, project));
  const builtIn = relevantTools.filter((tool) => tool.ecosystem === "built-in");
  const externalTools = relevantTools.filter((tool) => tool.ecosystem !== "built-in");
  const available = externalTools.filter((tool) => isToolAvailable(tool, project));
  const missing = externalTools.filter((tool) => !isToolAvailable(tool, project));

  const npmPackages = missing
    .filter((tool) => tool.ecosystem === "npm" && tool.packageName)
    .map((tool) => tool.packageName!);
  const pythonPackages = missing
    .filter((tool) => tool.ecosystem === "python" && tool.packageName)
    .map((tool) => tool.packageName!);
  const manual = missing.filter((tool) => tool.ecosystem === "manual");
  const skipped: SetupTool[] = [];
  const commands: CommandSpec[] = [];

  if (npmPackages.length > 0) {
    const manager = jsPackageManager(project);
    if (manager) {
      commands.push(jsInstallCommand(root, manager, npmPackages));
    } else {
      skipped.push(
        ...missing.filter((tool) => tool.ecosystem === "npm").map((tool) => ({
          ...tool,
          installHint: "Add a package.json first, then install this as a dev dependency."
        }))
      );
    }
  }

  if (pythonPackages.length > 0) {
    const command = await pythonInstallCommand(root, project, pythonPackages);
    if (command) {
      commands.push(command);
    } else {
      skipped.push(
        ...missing.filter((tool) => tool.ecosystem === "python").map((tool) => ({
          ...tool,
          installHint: "Create or activate a Python virtualenv, then run: python -m pip install -U " + pythonPackages.join(" ")
        }))
      );
    }
  }

  return { project, builtIn, available, npmPackages, pythonPackages, manual, skipped, commands };
}

function renderToolList(prefix: string, tools: SetupTool[]): string[] {
  if (tools.length === 0) {
    return [];
  }

  return [prefix, ...tools.map((tool) => `- ${tool.id}: ${tool.reason}${tool.installHint ? ` ${tool.installHint}` : ""}`), ""];
}

function renderPlan(plan: SetupPlan, include: SetupInclude, results: ToolResult[] = []): string {
  const languages = activeLanguages(plan.project);
  const lines = ["VibeDoctor setup", "", `Detected languages: ${languages.length > 0 ? languages.join(", ") : "none"}`, `Package managers: ${plan.project.packageManagers.length > 0 ? plan.project.packageManagers.join(", ") : "none"}`, `Install set: ${include}`, ""];

  lines.push(...renderToolList("Already built in", plan.builtIn));
  lines.push(...renderToolList("Already available", plan.available));

  if (plan.commands.length > 0) {
    lines.push("Automatable installs", ...plan.commands.map((command) => `- ${commandText(command)}`), "");
  }

  lines.push(...renderToolList("Manual installs", plan.manual));
  lines.push(...renderToolList("Skipped until project setup exists", plan.skipped));

  if (results.length > 0) {
    lines.push("Install results");
    for (const result of results) {
      lines.push(`- ${result.command}: ${result.status}${result.exitCode === null ? "" : ` (${result.exitCode})`}`);
      if (result.stderr.trim()) {
        lines.push(`  ${result.stderr.trim().split(/\r?\n/)[0]}`);
      }
    }
    lines.push("");
  }

  if (plan.commands.length > 0 && results.length === 0) {
    lines.push("Run `vibedoctor setup --apply` to install the automatable tools.");
  } else if (plan.commands.length === 0 && plan.manual.length === 0 && plan.skipped.length === 0) {
    lines.push(`All relevant ${include} tools are already available.`);
  }

  // Always surface guidance + suggestions for users who may not know what else exists
  if (include !== "all") {
    lines.push("");
    lines.push("Want richer analysis or not sure what else to add?");
    if (include === "essential") {
      lines.push("  The default `vibedoctor setup` (recommended) already adds jscpd, coverage, radon, deptry, lizard, and semgrep on top of the core essentials.");
      lines.push("  Try `vibedoctor setup --include all` (or just `setup --apply` with no flag) for the full curated set.");
    } else {
      lines.push("  `vibedoctor setup` / `--include recommended` (the default) already includes the best balance for most projects.");
      lines.push("  `vibedoctor setup --include all` currently matches recommended (more extended tools may be added here in the future).");
    }
    lines.push("");
    lines.push("Still want more? Common high-value additions and next steps:");
    lines.push("  - Configure coverage reporting in your test framework (Jest/Vitest/Coverage.py) — VibeDoctor reads the reports automatically");
    lines.push("  - Manually install lizard or semgrep (shown above with one-line hints) for deeper complexity + rule-based checks");
    lines.push("  - Add jscpd (npm) if you want duplication heatmaps for large refactors");
    lines.push("");
    lines.push("Tip: Re-run `vibedoctor scan --quick` (or `scan --full`) after changes to see updated health + findings.");
  }

  return `${lines.join("\n")}\n`;
}

export async function runSetupCommand(root: string, options: SetupOptions = {}): Promise<{ output: string; exitCode: number }> {
  const include = VALID_SETUP_INCLUDES.has(options.include ?? "recommended") ? (options.include ?? "recommended") : "recommended";
  const plan = await createSetupPlan(root, include);

  if (!options.apply) {
    return { output: renderPlan(plan, include), exitCode: 0 };
  }

  const results: ToolResult[] = [];
  for (const command of plan.commands) {
    results.push(await runCommand(command));
  }

  return {
    output: renderPlan(plan, include, results),
    exitCode: results.some((result) => result.status === "error" || result.status === "timeout" || result.status === "skipped") ? 1 : 0
  };
}
