import { promises as fs } from "node:fs";
import path from "node:path";
import type { ProjectLanguage } from "./projectDetector";

/**
 * The single description of every tool VibeDoctor can run.
 *
 * Setup and the scanner used to keep separate lists, which let them disagree
 * about what a tool is called, how to find it, and whether it was installed.
 * Both now read this registry, so a tool that setup claims to have installed is
 * by construction the same tool the scanner looks for.
 */

export type ToolEcosystem = "npm" | "python" | "manual" | "built-in";
export type ToolPriority = "essential" | "recommended";

export type RuntimeEngine = "node" | "python";

export type ToolRegistryEntry = {
  /** Matches the adapter id and the `source` on findings the tool produces. */
  id: string;
  ecosystem: ToolEcosystem;
  priority: ToolPriority;
  reason: string;
  /** Command name the scanner invokes. Absent for built-in checks. */
  executable?: string;
  /** Package to install, when the ecosystem has a package manager. */
  packageName?: string;
  /** Arguments that make the tool report its version and exit successfully. */
  probeArgs?: string[];
  /** Extracts a version string from probe output; defaults to the first x.y.z found. */
  versionPattern?: RegExp;
  /**
   * Runtime the tool executes on. Used to preflight compatibility before a tool
   * is installed into an interpreter that cannot run it.
   */
  runtime?: RuntimeEngine;
  languages?: ProjectLanguage[];
  requiresLockfile?: boolean;
  installHint?: string;
  /**
   * Set when the tool has no executable of its own and is exercised through
   * another runtime (Presidio runs as a Python module, not a binary).
   */
  moduleProbe?: { runtime: RuntimeEngine; module: string };
};

export const TOOL_REGISTRY: ToolRegistryEntry[] = [
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
    id: "privacy-detector",
    ecosystem: "built-in",
    priority: "essential",
    reason: "Finds personal-data and Privacy Review signals without sending data to an external service."
  },
  {
    id: "flow-doctor",
    ecosystem: "built-in",
    priority: "essential",
    reason: "High-confidence structural flow checks: route/method mismatches and swallowed error paths."
  },
  {
    id: "tsc",
    packageName: "typescript",
    executable: "tsc",
    ecosystem: "npm",
    priority: "essential",
    languages: ["typescript"],
    runtime: "node",
    probeArgs: ["--version"],
    reason: "TypeScript correctness signal."
  },
  {
    id: "biome",
    packageName: "@biomejs/biome",
    executable: "biome",
    ecosystem: "npm",
    priority: "essential",
    languages: ["javascript", "typescript"],
    runtime: "node",
    probeArgs: ["--version"],
    reason: "Fast JS/TS lint and safe formatting signal."
  },
  {
    id: "knip",
    packageName: "knip",
    executable: "knip",
    ecosystem: "npm",
    priority: "essential",
    languages: ["javascript", "typescript"],
    runtime: "node",
    probeArgs: ["--version"],
    reason: "Unused files, exports, and dependency signal for JS/TS."
  },
  {
    id: "jscpd",
    packageName: "jscpd",
    executable: "jscpd",
    ecosystem: "npm",
    priority: "recommended",
    languages: ["javascript", "typescript"],
    runtime: "node",
    probeArgs: ["--version"],
    reason: "Duplication signal for refactor planning."
  },
  {
    id: "ruff",
    packageName: "ruff",
    executable: "ruff",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python lint and safe-fix signal. VibeDoctor can provision a pinned managed copy.",
    installHint: "VibeDoctor provisions Ruff into ~/.cache/vibedoctor. To pin a project-local copy, install ruff in the environment."
  },
  {
    id: "pyright",
    packageName: "pyright",
    executable: "pyright",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python type correctness signal."
  },
  {
    id: "vulture",
    packageName: "vulture",
    executable: "vulture",
    ecosystem: "python",
    priority: "essential",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python dead-code signal."
  },
  {
    id: "coverage.py",
    packageName: "coverage",
    executable: "coverage",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python coverage signal."
  },
  {
    id: "radon",
    packageName: "radon",
    executable: "radon",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python complexity signal."
  },
  {
    id: "deptry",
    packageName: "deptry",
    executable: "deptry",
    ecosystem: "python",
    priority: "recommended",
    languages: ["python"],
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Python dependency hygiene signal."
  },
  {
    id: "gitleaks",
    executable: "gitleaks",
    ecosystem: "manual",
    priority: "essential",
    probeArgs: ["version"],
    reason: "Secret detection across every repository. VibeDoctor can provision a pinned managed copy.",
    installHint: "VibeDoctor provisions Gitleaks into ~/.cache/vibedoctor. To pin a project-local copy, install gitleaks on PATH."
  },
  {
    id: "osv-scanner",
    executable: "osv-scanner",
    ecosystem: "manual",
    priority: "essential",
    requiresLockfile: true,
    probeArgs: ["--version"],
    reason: "Known-vulnerability detection for dependency lockfiles. VibeDoctor can provision a pinned managed copy.",
    installHint: "VibeDoctor provisions OSV-Scanner into ~/.cache/vibedoctor. To pin a project-local copy, install osv-scanner on PATH."
  },
  {
    id: "lizard",
    executable: "lizard",
    ecosystem: "manual",
    priority: "recommended",
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Function-level complexity and code size hotspots (great for spotting refactor candidates).",
    installHint: "Install Lizard with: pipx install lizard, uv tool install lizard, or your OS package manager."
  },
  {
    id: "semgrep",
    executable: "semgrep",
    ecosystem: "manual",
    priority: "recommended",
    runtime: "python",
    probeArgs: ["--version"],
    reason: "Additional security and correctness rules.",
    installHint: "Install Semgrep with: pipx install semgrep, uv tool install semgrep, or your OS package manager."
  },
  {
    id: "presidio",
    ecosystem: "manual",
    priority: "recommended",
    runtime: "python",
    // Presidio ships no console script; the scanner drives it as a Python module,
    // so verification must import the module rather than look for a binary.
    moduleProbe: { runtime: "python", module: "presidio_analyzer" },
    reason:
      "External PII analyzer used by privacy + DPDP scans by default (skipped gracefully if missing). The normal privacy and DPDP opt-outs are independent.",
    installHint: "Install in the project Python environment with: python -m pip install presidio-analyzer"
  }
];

const BY_ID = new Map(TOOL_REGISTRY.map((entry) => [entry.id, entry]));

export function getToolEntry(id: string): ToolRegistryEntry | undefined {
  return BY_ID.get(id);
}

/** Command names the scanner may invoke, for availability probing. */
export function registryExecutables(): string[] {
  return Array.from(new Set(TOOL_REGISTRY.map((entry) => entry.executable).filter((name): name is string => Boolean(name))));
}

export function toolsForPriority(priority: ToolPriority | "all"): ToolRegistryEntry[] {
  if (priority === "all") {
    return TOOL_REGISTRY;
  }
  if (priority === "recommended") {
    return TOOL_REGISTRY;
  }
  return TOOL_REGISTRY.filter((entry) => entry.priority === "essential");
}

export function installHintFor(entry: ToolRegistryEntry): string {
  if (entry.installHint) {
    return entry.installHint;
  }
  if (entry.ecosystem === "npm" && entry.packageName) {
    return `Install with: npm install -D ${entry.packageName}`;
  }
  if (entry.ecosystem === "python" && entry.packageName) {
    return `Install with: python -m pip install -U ${entry.packageName}`;
  }
  return `Install ${entry.id} and make sure it is on PATH.`;
}

/**
 * Reads the runtime requirement a tool declares for itself, from the package
 * metadata of the copy that is actually installed. Hardcoding "knip needs Node
 * 20.19" would go stale on the next release; the package says so itself.
 */
export async function readDeclaredNodeRequirement(
  root: string,
  packageName: string | undefined
): Promise<{ range?: string; source?: string }> {
  if (!packageName) {
    return {};
  }

  const manifest = path.join(root, "node_modules", ...packageName.split("/"), "package.json");
  try {
    const parsed = JSON.parse(await fs.readFile(manifest, "utf8")) as { engines?: { node?: string } };
    const range = parsed.engines?.node;
    return range ? { range, source: `${packageName} engines.node` } : {};
  } catch {
    return {};
  }
}
