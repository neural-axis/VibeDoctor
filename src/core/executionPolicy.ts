import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";

/**
 * Execution policy for one scan.
 *
 * The default policy reproduces VibeDoctor's long-standing behaviour exactly (project-local
 * tools first, project tests may run, the Windows shell fallback). Callers that scan code they
 * do not fully trust (CI bots, other tools, repositories downloaded from elsewhere) can opt in
 * to an explicit profile with `scan --profile`:
 *
 * - `static`: only analysers that read files and run from outside the target. No project-local
 *   executables, no project scripts/tests, no tools that load executable project configuration,
 *   no network, and a minimal environment for child processes.
 * - `trusted`: the caller explicitly accepts running the project's own tools and tests, with a
 *   minimal environment and network off unless allowed.
 *
 * Reports are still written to the usual `.vibedoctor/` folder in every profile.
 *
 * The policy travels with the async call chain (AsyncLocalStorage), so it applies only to the
 * scan that asked for it and no adapter has to thread it through.
 */
export type ExecutionProfile = "default" | "static" | "trusted";

export type ExecutionPolicy = {
  profile: ExecutionProfile;
  /** Absolute repository root being diagnosed; nothing inside it may be executed in `static`. */
  targetRoot?: string;
  /** Optional scratch directory for child-process temp files (TEMP/TMP/TMPDIR). */
  tempRoot?: string;
  allowProjectLocalTools: boolean;
  allowProjectExecution: boolean;
  allowShellFallback: boolean;
  allowNetwork: boolean;
  /** When set, child processes receive only these variables (plus PATH/TEMP handling). */
  envAllowlist?: string[];
  /** Upper bound on captured stdout/stderr per child process. */
  maxOutputBytes?: number;
};

export const DEFAULT_POLICY: ExecutionPolicy = {
  profile: "default",
  allowProjectLocalTools: true,
  allowProjectExecution: true,
  allowShellFallback: true,
  allowNetwork: true
};

const ENV_ALLOWLIST = [
  "PATH",
  "Path",
  "PATHEXT",
  "SystemRoot",
  "SYSTEMROOT",
  "windir",
  "ComSpec",
  "HOME",
  "USERPROFILE",
  "APPDATA",
  "LOCALAPPDATA",
  "HOMEDRIVE",
  "HOMEPATH",
  "LANG",
  "LC_ALL",
  "TZ",
  "NUMBER_OF_PROCESSORS",
  "PROCESSOR_ARCHITECTURE",
  "VIBEDOCTOR_TOOL_CACHE"
];

/**
 * Tools excluded from a profile, with the reason surfaced in the capability matrix.
 * Each entry was checked against the adapter: a flag named "static" is not evidence.
 */
const STATIC_EXCLUSIONS: Record<string, string> = {
  vitest: "Runs the project's tests and loads its vitest config (project code execution).",
  jest: "Runs the project's tests and loads its jest config (project code execution).",
  knip: "Loads JS/TS project config and plugin configs, which execute project code.",
  "coverage.py": "coverage.py loads .coveragerc plugins, which are Python code.",
  presidio: "Runs a Python interpreter that may resolve to the project's environment and download models.",
  semgrep: "Uses `--config auto`, which downloads rules from the network.",
  "osv-scanner": "Queries the OSV vulnerability API over the network."
};
const TRUSTED_EXCLUSIONS: Record<string, string> = {
  semgrep: STATIC_EXCLUSIONS.semgrep!,
  "osv-scanner": STATIC_EXCLUSIONS["osv-scanner"]!
};

export function profilePolicy(
  profile: ExecutionProfile,
  options: { targetRoot: string; tempRoot?: string; allowNetwork?: boolean } = { targetRoot: process.cwd() }
): ExecutionPolicy {
  if (profile === "default") return { ...DEFAULT_POLICY, targetRoot: path.resolve(options.targetRoot) };
  const base = {
    profile,
    targetRoot: path.resolve(options.targetRoot),
    tempRoot: options.tempRoot ? path.resolve(options.tempRoot) : undefined,
    allowNetwork: options.allowNetwork ?? false,
    allowShellFallback: false,
    envAllowlist: ENV_ALLOWLIST,
    maxOutputBytes: 64 * 1024 * 1024
  };
  return profile === "static"
    ? { ...base, allowProjectLocalTools: false, allowProjectExecution: false }
    : { ...base, allowProjectLocalTools: true, allowProjectExecution: true };
}

const store = new AsyncLocalStorage<ExecutionPolicy>();

export function currentPolicy(): ExecutionPolicy {
  return store.getStore() ?? DEFAULT_POLICY;
}

export function withExecutionPolicy<T>(policy: ExecutionPolicy, run: () => Promise<T>): Promise<T> {
  return store.run(policy, run);
}

/** Why a tool must not run under the current policy, or undefined when it may. */
export function policyExclusion(toolId: string, policy: ExecutionPolicy = currentPolicy()): string | undefined {
  if (policy.profile === "static") {
    const reason = STATIC_EXCLUSIONS[toolId];
    if (reason && !(policy.allowNetwork && (toolId === "semgrep" || toolId === "osv-scanner")))
      return `Excluded by the static profile: ${reason}`;
  }
  if (policy.profile === "trusted" && !policy.allowNetwork && TRUSTED_EXCLUSIONS[toolId])
    return `Excluded because network is off: ${TRUSTED_EXCLUSIONS[toolId]}`;
  return undefined;
}

export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

/**
 * PATH entries a child may search. Relative entries (such as ".") and anything inside the
 * target are removed when project-local tools are not allowed.
 */
export function allowedPathEntries(entries: string[], policy: ExecutionPolicy = currentPolicy()): string[] {
  if (policy.allowProjectLocalTools || !policy.targetRoot) return entries;
  return entries.filter((entry) => path.isAbsolute(entry) && !isInside(policy.targetRoot!, entry));
}

/** Environment passed to children under the policy (the full environment by default). */
export function policyEnv(base: NodeJS.ProcessEnv, policy: ExecutionPolicy = currentPolicy()): NodeJS.ProcessEnv {
  if (!policy.envAllowlist) return base;
  const env: NodeJS.ProcessEnv = {};
  for (const key of policy.envAllowlist) if (base[key] !== undefined) env[key] = base[key];
  if (policy.tempRoot) {
    // Tools that write scratch files (deptry, jscpd) write them where the caller chose.
    const temp = policy.tempRoot;
    env.TEMP = temp;
    env.TMP = temp;
    env.TMPDIR = temp;
  }
  if (!policy.allowNetwork) env.VIBEDOCTOR_ALLOW_NETWORK = "0";
  return env;
}

/** Git settings that could run commands from repository configuration are switched off. */
export function gitSafetyEnv(policy: ExecutionPolicy = currentPolicy()): NodeJS.ProcessEnv {
  if (policy.profile === "default") return {};
  const overrides: Array<[string, string]> = [
    ["core.fsmonitor", "false"],
    ["core.hooksPath", process.platform === "win32" ? "NUL" : "/dev/null"],
    ["diff.external", ""],
    ["core.pager", "cat"]
  ];
  const env: NodeJS.ProcessEnv = { GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0", GIT_CONFIG_COUNT: String(overrides.length) };
  overrides.forEach(([key, value], index) => {
    env[`GIT_CONFIG_KEY_${index}`] = key;
    env[`GIT_CONFIG_VALUE_${index}`] = value;
  });
  return env;
}
