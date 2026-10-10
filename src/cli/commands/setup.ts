import path from "node:path";
import type { CommandSpec, ToolResult } from "../../core/toolRunner";
import { runCommand } from "../../core/toolRunner";
import { detectProject, type PackageManager, type ProjectContext, type ProjectLanguage } from "../../core/projectDetector";
import { loadConfig } from "../../core/config";
import { pathExists } from "../../core/paths";
import { TOOL_REGISTRY, installHintFor, type ToolEcosystem, type ToolRegistryEntry } from "../../core/toolRegistry";
import {
  isVerificationBlocking,
  probeRuntimesFor,
  summarizeVerification,
  verifyTools,
  type RuntimeProbes,
  type ToolVerification
} from "../../core/toolVerification";

export type SetupPriority = "essential" | "recommended";
export type SetupInclude = "essential" | "recommended" | "all" | "npm" | "python" | "manual" | "built-in";

export type SetupOptions = {
  apply?: boolean;
  include?: SetupInclude;
};

export type SetupPlan = {
  project: ProjectContext;
  builtIn: ToolRegistryEntry[];
  available: ToolRegistryEntry[];
  npmPackages: string[];
  pythonPackages: string[];
  manual: ToolRegistryEntry[];
  skipped: Array<ToolRegistryEntry & { installHint: string }>;
  commands: CommandSpec[];
  /** Runtimes the selected tools need, probed once up front. */
  runtimes: RuntimeProbes;
  /** Verification of every relevant tool as the scanner would resolve it. */
  verifications: ToolVerification[];
};

const VALID_SETUP_INCLUDES = new Set<SetupInclude>([
  "essential",
  "recommended",
  "all",
  "npm",
  "python",
  "manual",
  "built-in"
]);

function hasActiveLanguage(project: ProjectContext, language: ProjectLanguage): boolean {
  if (!project.languages.includes(language)) {
    return false;
  }

  if (language === "python" && project.packageManagers.some((manager) => ["pip", "uv", "poetry", "pdm"].includes(manager))) {
    return true;
  }

  if (
    (language === "javascript" || language === "typescript") &&
    project.packageManagers.some((manager) => ["npm", "pnpm", "yarn", "bun"].includes(manager))
  ) {
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

function appliesToProject(tool: ToolRegistryEntry, project: ProjectContext): boolean {
  if (!includesAnyLanguage(project, tool.languages)) {
    return false;
  }

  if (tool.requiresLockfile && project.lockfiles.length === 0) {
    return false;
  }

  return true;
}

function jsPackageManager(project: ProjectContext): PackageManager | undefined {
  return ["pnpm", "yarn", "bun", "npm"].find((manager) =>
    project.packageManagers.includes(manager as PackageManager)
  ) as PackageManager | undefined;
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

/**
 * Chooses how to install Python packages. Returns undefined when there is no
 * interpreter or environment to install into — previously this produced an
 * install command that failed at spawn time and was reported as a skip, which
 * read like success.
 */
async function pythonInstallCommand(
  root: string,
  project: ProjectContext,
  packages: string[],
  runtimes: RuntimeProbes
): Promise<CommandSpec | undefined> {
  if (project.packageManagers.includes("uv")) {
    return { cmd: "uv", args: ["add", "--dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (project.packageManagers.includes("poetry")) {
    return { cmd: "poetry", args: ["add", "--group", "dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }
  if (project.packageManagers.includes("pdm")) {
    return { cmd: "pdm", args: ["add", "-dG", "dev", ...packages], cwd: root, timeoutMs: 180_000 };
  }

  const python = runtimes.python;
  if (!python?.available || !python.command) {
    return undefined;
  }

  const hasLocalVenv =
    Boolean(process.env.VIRTUAL_ENV) ||
    (await pathExists(path.join(root, ".venv"))) ||
    (await pathExists(path.join(root, "venv")));
  if (!hasLocalVenv) {
    return undefined;
  }

  return { cmd: python.command, args: ["-m", "pip", "install", "-U", ...packages], cwd: root, timeoutMs: 180_000 };
}

function commandText(command: CommandSpec): string {
  return [command.cmd, ...command.args].join(" ");
}

function resolveTools(include: SetupInclude): ToolRegistryEntry[] {
  if (include === "essential") {
    return TOOL_REGISTRY.filter((tool) => tool.priority === "essential");
  }
  if (include === "recommended" || include === "all") {
    // "recommended" is the sensible default experience (essential + high-value extras).
    // "all" currently resolves to the same set (add future extended tools here if needed).
    return TOOL_REGISTRY;
  }
  return TOOL_REGISTRY.filter((tool) => tool.ecosystem === (include as ToolEcosystem));
}

export async function createSetupPlan(root: string, include: SetupInclude = "recommended"): Promise<SetupPlan> {
  const { config } = await loadConfig(root);
  const project = await detectProject(root, config.paths.exclude);
  const relevantTools = resolveTools(include).filter((tool) => appliesToProject(tool, project));

  const runtimes = await probeRuntimesFor(relevantTools, root);
  // Verification, not a name lookup, decides what counts as installed. This runs
  // each tool the way the scanner will, so the two cannot disagree.
  const verifications = await verifyTools(relevantTools, root);
  const verificationById = new Map(verifications.map((verification) => [verification.id, verification]));

  const builtIn = relevantTools.filter((tool) => tool.ecosystem === "built-in");
  const externalTools = relevantTools.filter((tool) => tool.ecosystem !== "built-in");
  const available = externalTools.filter((tool) => verificationById.get(tool.id)?.state === "verified");
  const missing = externalTools.filter((tool) => verificationById.get(tool.id)?.state !== "verified");

  const npmMissing = missing.filter((tool) => tool.ecosystem === "npm" && tool.packageName);
  const pythonMissing = missing.filter((tool) => tool.ecosystem === "python" && tool.packageName);
  const npmPackages = npmMissing.map((tool) => tool.packageName!);
  const pythonPackages = pythonMissing.map((tool) => tool.packageName!);
  const manual = missing.filter((tool) => tool.ecosystem === "manual");
  const skipped: Array<ToolRegistryEntry & { installHint: string }> = [];
  const commands: CommandSpec[] = [];

  if (npmPackages.length > 0) {
    const manager = jsPackageManager(project);
    if (manager) {
      commands.push(jsInstallCommand(root, manager, npmPackages));
    } else {
      skipped.push(
        ...npmMissing.map((tool) => ({
          ...tool,
          installHint: "Add a package.json first, then install this as a dev dependency."
        }))
      );
    }
  }

  if (pythonPackages.length > 0) {
    const command = await pythonInstallCommand(root, project, pythonPackages, runtimes);
    if (command) {
      commands.push(command);
    } else {
      // Naming the actual obstacle matters: "no interpreter" and "no virtualenv"
      // have different fixes, and reporting the wrong one wastes the user's time.
      const obstacle = runtimes.python?.available
        ? "Create or activate a Python virtualenv (.venv), then run"
        : `No Python interpreter was found on PATH. Install Python, then run`;
      skipped.push(
        ...pythonMissing.map((tool) => ({
          ...tool,
          installHint: `${obstacle}: python -m pip install -U ${pythonPackages.join(" ")}`
        }))
      );
    }
  }

  return { project, builtIn, available, npmPackages, pythonPackages, manual, skipped, commands, runtimes, verifications };
}

function renderToolList(prefix: string, tools: ToolRegistryEntry[]): string[] {
  if (tools.length === 0) {
    return [];
  }

  return [
    prefix,
    ...tools.map((tool) => `- ${tool.id}: ${tool.reason}${tool.installHint ? ` ${tool.installHint}` : ""}`),
    ""
  ];
}

function renderRuntimeLines(runtimes: RuntimeProbes): string[] {
  const entries = Object.values(runtimes).filter(Boolean);
  if (entries.length === 0) {
    return [];
  }

  return [
    "Runtimes",
    ...entries.map((probe) => `- ${probe!.engine}: ${probe!.available ? probe!.detail : `NOT AVAILABLE — ${probe!.detail}`}`),
    ""
  ];
}

/**
 * Renders verification results. Each line names the resolved path, because
 * "installed" without a path is the claim that turned out to be unreliable.
 */
function renderVerificationLines(verifications: ToolVerification[]): string[] {
  if (verifications.length === 0) {
    return [];
  }

  const lines = ["Verification (each tool resolved and run the way the scanner will run it)"];

  for (const verification of [...verifications].sort((left, right) => left.id.localeCompare(right.id))) {
    lines.push(`- ${summarizeVerification(verification)}`);
    if (verification.probeCommand && verification.state === "verified") {
      lines.push(`  probe: ${verification.probeCommand}`);
    }
    if (verification.remediation && isVerificationBlocking(verification)) {
      lines.push(`  fix: ${verification.remediation}`);
    }
  }

  lines.push("");
  return lines;
}

type SetupRender = {
  plan: SetupPlan;
  include: SetupInclude;
  installResults?: ToolResult[];
  /** Verification performed after installing, which decides the exit code. */
  postInstall?: ToolVerification[];
};

function renderPlan({ plan, include, installResults = [], postInstall }: SetupRender): string {
  const languages = activeLanguages(plan.project);
  const lines = [
    "VibeDoctor setup",
    "",
    `Detected languages: ${languages.length > 0 ? languages.join(", ") : "none"}`,
    `Package managers: ${plan.project.packageManagers.length > 0 ? plan.project.packageManagers.join(", ") : "none"}`,
    `Install set: ${include}`,
    ""
  ];

  lines.push(...renderRuntimeLines(plan.runtimes));
  lines.push(...renderToolList("Already built in", plan.builtIn));
  lines.push(...renderToolList("Already available", plan.available));

  if (plan.commands.length > 0) {
    lines.push("Automatable installs", ...plan.commands.map((command) => `- ${commandText(command)}`), "");
  }

  lines.push(...renderToolList("Manual installs", plan.manual));
  lines.push(...renderToolList("Skipped until project setup exists", plan.skipped));

  if (installResults.length > 0) {
    lines.push("Install results");
    for (const result of installResults) {
      lines.push(`- ${result.command}: ${result.status}${result.exitCode === null ? "" : ` (${result.exitCode})`}`);
      if (result.stderr.trim()) {
        lines.push(`  ${result.stderr.trim().split(/\r?\n/)[0]}`);
      }
    }
    lines.push("");
  }

  // After applying, the verification pass is the authoritative result: an install
  // command exiting zero is not evidence the scanner can run the tool.
  const verifications = postInstall ?? plan.verifications;
  lines.push(...renderVerificationLines(verifications));

  const blocking = verifications.filter(isVerificationBlocking);
  const runtimeMismatches = blocking.filter((verification) => verification.state === "incompatible_runtime");

  if (postInstall) {
    if (blocking.length === 0) {
      lines.push("All selected tools verified. The next scan will use exactly these executables.");
    } else {
      lines.push(
        `Setup did not complete: ${blocking.length} tool(s) could not be verified — ${blocking
          .map((verification) => verification.id)
          .join(", ")}.`,
        "The scan will report these as missing coverage rather than treating their silence as a pass."
      );
      if (runtimeMismatches.length > 0) {
        lines.push(
          "",
          "Runtime mismatches are installed but unusable here. To keep them out of the way deliberately, add to vibedoctor.yml:",
          "  runtime:",
          "    deferred_tools:",
          ...runtimeMismatches.map((verification) => `      - ${verification.id}`)
        );
      }
    }
    lines.push("");
  } else if (plan.commands.length > 0) {
    lines.push("Run `vibedoctor setup --apply` to install the automatable tools and verify each one.");
  } else if (plan.commands.length === 0 && plan.manual.length === 0 && plan.skipped.length === 0) {
    lines.push(`All relevant ${include} tools are already available.`);
  }

  // Always surface guidance + suggestions for users who may not know what else exists
  if (include !== "all") {
    lines.push("");
    lines.push("Want richer analysis or not sure what else to add?");
    if (include === "essential") {
      lines.push(
        "  The default `vibedoctor setup` (recommended) already adds jscpd, coverage, radon, deptry, lizard, and semgrep on top of the core essentials."
      );
      lines.push("  Try `vibedoctor setup --include all` (or just `setup --apply` with no flag) for the full curated set.");
    } else {
      lines.push("  `vibedoctor setup` / `--include recommended` (the default) already includes the best balance for most projects.");
      lines.push("  `vibedoctor setup --include all` currently matches recommended (more extended tools may be added here in the future).");
    }
    lines.push("");
    lines.push("Still want more? Common high-value additions and next steps:");
    lines.push(
      "  - Configure coverage reporting in your test framework (Jest/Vitest/Coverage.py) — VibeDoctor reads the reports automatically"
    );
    lines.push("  - Manually install lizard or semgrep (shown above with one-line hints) for deeper complexity + rule-based checks");
    lines.push("  - Add jscpd (npm) if you want duplication heatmaps for large refactors");
    lines.push("");
    lines.push("Tip: Re-run `vibedoctor scan --full` (or `scan --quick` for a narrower pass) after changes to see updated health + findings.");
  }

  return `${lines.join("\n")}\n`;
}

export async function runSetupCommand(root: string, options: SetupOptions = {}): Promise<{ output: string; exitCode: number }> {
  const include = VALID_SETUP_INCLUDES.has(options.include ?? "recommended") ? (options.include ?? "recommended") : "recommended";
  const plan = await createSetupPlan(root, include);

  if (!options.apply) {
    return { output: renderPlan({ plan, include }), exitCode: 0 };
  }

  const installResults: ToolResult[] = [];
  for (const command of plan.commands) {
    installResults.push(await runCommand(command));
  }

  // Re-probe runtimes as well: an install can add the interpreter or venv that
  // was missing when the plan was built.
  const relevantTools = resolveTools(include).filter((tool) => appliesToProject(tool, plan.project));
  const postInstall = await verifyTools(relevantTools, root);

  const installFailed = installResults.some(
    (result) => result.status === "error" || result.status === "timeout" || result.status === "skipped"
  );
  const verificationFailed = postInstall.some(isVerificationBlocking);

  return {
    output: renderPlan({ plan, include, installResults, postInstall }),
    // Setup fails when a tool cannot be verified, even if every install command
    // succeeded. Reporting success for an unusable tool is the failure mode this
    // exit code exists to prevent.
    exitCode: installFailed || verificationFailed ? 1 : 0
  };
}
