import { promises as fs, statSync } from "node:fs";
import path from "node:path";
import { describeSearchPaths, resolveExecutable } from "./executable";
import { formatVersion, minimumSatisfying, parseVersion, satisfiesRange } from "./semverLite";
import { installHintFor, readDeclaredNodeRequirement, type RuntimeEngine, type ToolRegistryEntry } from "./toolRegistry";
import { runCommand } from "./toolRunner";

/**
 * Proves a tool is usable rather than merely present.
 *
 * `setup --apply` used to report success when an install command exited zero.
 * That is not the same claim as "the scanner can run this", and the two came
 * apart in practice: a package installed into an interpreter that was not on
 * PATH, or under a Node version too old to run it. Verification here resolves
 * the executable through the scanner's own lookup, runs it, and records the
 * concrete path and version — so a passing verification means the next scan
 * will find the same binary.
 */

export type VerificationState =
  /** Resolved, ran, and reported a version. */
  | "verified"
  /** Nothing on PATH matches the executable. */
  | "not_found"
  /** Found on PATH but the probe failed, so the install is broken. */
  | "broken"
  /** Found, but the runtime it needs cannot run it. */
  | "incompatible_runtime"
  /** Cannot be verified from here (no probe declared); reported honestly, never as a pass. */
  | "unverifiable";

export type ToolVerification = {
  id: string;
  state: VerificationState;
  /** Absolute path of the executable that answered the probe. */
  resolvedPath?: string;
  /** Interpreter path, for tools driven as a module of another runtime. */
  interpreterPath?: string;
  version?: string;
  /** The exact command line used to verify, so a user can rerun it by hand. */
  probeCommand?: string;
  runtime?: {
    engine: RuntimeEngine;
    version?: string;
    requirement?: string;
    requirementSource?: string;
    compatible: boolean | "unknown";
  };
  reason: string;
  remediation?: string;
};

export function isVerificationBlocking(verification: ToolVerification): boolean {
  return verification.state === "not_found" || verification.state === "broken" || verification.state === "incompatible_runtime";
}

const DEFAULT_VERSION_PATTERN = /\b(\d+\.\d+(?:\.\d+)?(?:[-+][0-9A-Za-z.-]+)?)\b/;

function extractVersion(output: string, pattern: RegExp | undefined): string | undefined {
  const match = (pattern ?? DEFAULT_VERSION_PATTERN).exec(output);
  return match?.[1] ?? match?.[0];
}

// Generous, because some tools are genuinely slow to start: reporting a working
// tool as broken because it took 31 seconds to print its version would be worse
// than waiting.
const PROBE_TIMEOUT_MS = 90_000;

/** Candidate interpreter command names, in the order the scanner would find them. */
const RUNTIME_COMMANDS: Record<RuntimeEngine, string[]> = {
  node: ["node"],
  python: ["python", "python3", "py"]
};

export type RuntimeProbe = {
  engine: RuntimeEngine;
  available: boolean;
  command?: string;
  resolvedPath?: string;
  version?: string;
  detail: string;
};

/**
 * Locates a language runtime once per process. `python` being absent is the
 * reason a whole family of installs silently fails, so it is reported as a
 * first-class fact rather than inferred from a tool-level error message.
 */
export async function probeRuntime(engine: RuntimeEngine, cwd: string): Promise<RuntimeProbe> {
  if (engine === "node") {
    // We are running on Node, so the version that matters is this process's.
    const resolved = resolveExecutable("node", cwd);
    return {
      engine,
      available: true,
      command: "node",
      resolvedPath: resolved?.path ?? process.execPath,
      version: process.versions.node,
      detail: `Node ${process.versions.node} at ${resolved?.path ?? process.execPath}`
    };
  }

  for (const command of RUNTIME_COMMANDS[engine]) {
    const resolved = resolveExecutable(command, cwd);
    if (!resolved) {
      continue;
    }

    const result = await runCommand({ cmd: command, args: ["--version"], cwd, timeoutMs: PROBE_TIMEOUT_MS });
    if (result.status !== "ok") {
      continue;
    }

    const version = extractVersion(`${result.stdout}\n${result.stderr}`, undefined);
    return {
      engine,
      available: true,
      command,
      resolvedPath: resolved.path,
      version,
      detail: `${command} ${version ?? "(unknown version)"} at ${resolved.path}`
    };
  }

  return {
    engine,
    available: false,
    detail: `No ${engine} interpreter found on PATH (tried ${RUNTIME_COMMANDS[engine].join(", ")}).`
  };
}

export type RuntimeProbes = Partial<Record<RuntimeEngine, RuntimeProbe>>;

export async function probeRuntimes(cwd: string, engines: RuntimeEngine[]): Promise<RuntimeProbes> {
  const unique = Array.from(new Set(engines));
  const probes = await Promise.all(unique.map(async (engine) => [engine, await probeRuntime(engine, cwd)] as const));
  return Object.fromEntries(probes) as RuntimeProbes;
}

/**
 * Probes only the runtimes that a tool present on this machine actually needs.
 *
 * Probing every runtime a registry entry mentions meant spawning a Python
 * interpreter on repositories with no Python tooling installed, on every scan.
 */
export async function probeRuntimesFor(
  entries: ToolRegistryEntry[],
  cwd: string,
  depth: VerificationDepth = "execute"
): Promise<RuntimeProbes> {
  const engines = new Set<RuntimeEngine>();

  for (const entry of entries) {
    if (entry.moduleProbe && depth === "execute") {
      engines.add(entry.moduleProbe.runtime);
      continue;
    }

    if (!entry.runtime || !entry.executable) {
      continue;
    }

    // Node compatibility is free — this process is the runtime — so it is always
    // worth knowing. Other runtimes cost a spawn, so only ask when the tool that
    // needs one is actually installed.
    if (entry.runtime === "node" || resolveExecutable(entry.executable, cwd)) {
      engines.add(entry.runtime);
    }
  }

  return probeRuntimes(cwd, Array.from(engines));
}

async function checkRuntimeCompatibility(
  root: string,
  entry: ToolRegistryEntry,
  probes: RuntimeProbes
): Promise<ToolVerification["runtime"] | undefined> {
  if (!entry.runtime) {
    return undefined;
  }

  const probe = probes[entry.runtime];
  const { range, source } = entry.ecosystem === "npm" ? await readDeclaredNodeRequirement(root, entry.packageName) : {};

  if (!probe?.available) {
    return {
      engine: entry.runtime,
      requirement: range,
      requirementSource: source,
      compatible: false
    };
  }

  const version = parseVersion(probe.version);
  const satisfied = version ? satisfiesRange(version, range) : undefined;

  return {
    engine: entry.runtime,
    version: probe.version,
    requirement: range,
    requirementSource: source,
    compatible: satisfied ?? "unknown"
  };
}

function runtimeRemediation(entry: ToolRegistryEntry, runtime: NonNullable<ToolVerification["runtime"]>): string {
  const needed = minimumSatisfying(runtime.requirement);
  const target = needed ? `${runtime.engine} >= ${needed}` : `a newer ${runtime.engine}`;
  return [
    `${entry.id} declares ${runtime.requirement ?? "a newer runtime"}${runtime.requirementSource ? ` (${runtime.requirementSource})` : ""}`,
    `but the active runtime is ${runtime.engine} ${runtime.version ?? "unknown"}.`,
    `Either upgrade to ${target}, run VibeDoctor under a compatible runtime, or set`,
    `runtime.deferred_tools: [${entry.id}] in vibedoctor.yml to defer it deliberately.`
  ].join(" ");
}

/**
 * How hard to look.
 *
 * `execute` runs each tool's probe, which is what `setup` needs: there is no
 * later scan to fall back on, so an unproven tool must not be reported as
 * installed. `resolve` stops at locating the executable and checking runtime
 * compatibility, which is what a scan needs — the scan is about to invoke the
 * tool anyway, and paying for a second process per tool would add tens of
 * seconds to every run to learn something the run itself reveals.
 */
export type VerificationDepth = "resolve" | "execute";

export type VerifyToolOptions = {
  root: string;
  runtimes: RuntimeProbes;
  depth?: VerificationDepth;
};

export async function verifyTool(entry: ToolRegistryEntry, options: VerifyToolOptions): Promise<ToolVerification> {
  const { root, runtimes } = options;
  const depth = options.depth ?? "execute";

  if (entry.ecosystem === "built-in") {
    return {
      id: entry.id,
      state: "verified",
      reason: "Built-in check; no external executable required.",
      version: "built-in"
    };
  }

  const runtime = await checkRuntimeCompatibility(root, entry, runtimes);

  // A tool driven as a module of another runtime (Presidio) has no binary to
  // find; import the module through the interpreter the scanner would use.
  if (entry.moduleProbe) {
    const probe = runtimes[entry.moduleProbe.runtime];
    if (!probe?.available) {
      return {
        id: entry.id,
        state: depth === "resolve" ? "unverifiable" : "not_found",
        reason:
          depth === "resolve"
            ? `${entry.id} runs as a ${entry.moduleProbe.runtime} module; whether it is importable is determined when it runs.`
            : `${entry.moduleProbe.runtime} interpreter is not available, so ${entry.id} cannot run.`,
        remediation: `Install ${entry.moduleProbe.runtime} and make it available on PATH, then rerun setup.`,
        runtime
      };
    }

    if (depth === "resolve") {
      // Importing the module is expensive enough to matter on every scan, and
      // the adapter reports the same fact when it actually runs.
      return {
        id: entry.id,
        state: "unverifiable",
        interpreterPath: probe.resolvedPath,
        reason: `${entry.id} runs as a ${entry.moduleProbe.runtime} module; its availability is confirmed when the scan invokes it.`,
        runtime
      };
    }

    const args = ["-c", `import ${entry.moduleProbe.module} as m; print(getattr(m, "__version__", "installed"))`];
    const result = await runCommand({ cmd: probe.command!, args, cwd: root, timeoutMs: PROBE_TIMEOUT_MS });
    const probeCommand = [probe.command, ...args].join(" ");

    if (result.status !== "ok") {
      return {
        id: entry.id,
        state: result.status === "skipped" ? "not_found" : "broken",
        interpreterPath: probe.resolvedPath,
        probeCommand,
        reason: `${entry.moduleProbe.module} could not be imported by ${probe.resolvedPath ?? probe.command}.`,
        remediation: installHintFor(entry),
        runtime
      };
    }

    return {
      id: entry.id,
      state: "verified",
      interpreterPath: probe.resolvedPath,
      version: result.stdout.trim() || "installed",
      probeCommand,
      reason: `Imported ${entry.moduleProbe.module} using ${probe.resolvedPath ?? probe.command}.`,
      runtime
    };
  }

  if (!entry.executable) {
    return {
      id: entry.id,
      state: "unverifiable",
      reason: `${entry.id} declares no executable or module probe, so its availability cannot be confirmed.`,
      remediation: "Add a probe to the tool registry so setup can verify this tool.",
      runtime
    };
  }

  const resolved = resolveExecutable(entry.executable, root);
  if (!resolved) {
    const searched = describeSearchPaths(root);
    return {
      id: entry.id,
      state: "not_found",
      reason: `${entry.executable} was not found in any of the ${searched.length} directories on the scanner's PATH.`,
      remediation: installHintFor(entry),
      runtime
    };
  }

  // Runtime incompatibility is reported before the probe, because a tool that
  // cannot start under this runtime is not "broken" — it is mismatched, and the
  // remediation is completely different.
  if (runtime && runtime.compatible === false) {
    return {
      id: entry.id,
      state: "incompatible_runtime",
      resolvedPath: resolved.path,
      reason: runtime.requirement
        ? `${entry.id} requires ${runtime.engine} ${runtime.requirement} but ${runtime.engine} ${runtime.version ?? "unknown"} is active.`
        : `${entry.id} needs a ${runtime.engine} runtime that is not available.`,
      remediation: runtimeRemediation(entry, runtime),
      runtime
    };
  }

  if (depth === "resolve") {
    return {
      id: entry.id,
      state: "verified",
      resolvedPath: resolved.path,
      reason: `Resolved to ${resolved.path}; the scan invokes this executable directly.`,
      runtime
    };
  }

  const probeArgs = entry.probeArgs ?? ["--version"];
  const result = await runCommand({ cmd: entry.executable, args: probeArgs, cwd: root, timeoutMs: PROBE_TIMEOUT_MS });
  const probeCommand = [entry.executable, ...probeArgs].join(" ");
  const output = `${result.stdout}\n${result.stderr}`;

  if (result.status !== "ok") {
    // A tool present on PATH that cannot answer its own version probe is
    // installed-but-unusable; saying "installed" here is what misled users.
    const unsupportedRuntime = /requires node|unsupported engine|SyntaxError|Unexpected token/i.test(output);
    return {
      id: entry.id,
      state: unsupportedRuntime ? "incompatible_runtime" : "broken",
      resolvedPath: resolved.path,
      probeCommand,
      reason: unsupportedRuntime
        ? `${entry.id} is installed at ${resolved.path} but failed to start under the active runtime.`
        : `${entry.id} is installed at ${resolved.path} but \`${probeCommand}\` exited ${result.exitCode ?? "abnormally"}.`,
      remediation: unsupportedRuntime && runtime ? runtimeRemediation(entry, runtime) : installHintFor(entry),
      runtime
    };
  }

  return {
    id: entry.id,
    state: "verified",
    resolvedPath: resolved.path,
    version: extractVersion(output, entry.versionPattern),
    probeCommand,
    reason: `Ran \`${probeCommand}\` successfully at ${resolved.path}.`,
    runtime
  };
}

const VERIFICATION_CACHE_FILE = ".vibedoctor/tool-verification.json";

type CachedVerification = ToolVerification & {
  /** Identity of the binary that produced this result. */
  fingerprint: string;
  checkedAt: string;
};

/**
 * Identity of the file that answered the probe. A tool's version output cannot
 * change unless the file does, so this is safe to cache against — and some tools
 * are slow enough to matter: Semgrep takes the better part of a minute just to
 * report its own version.
 */
function fingerprintFile(filePath: string | undefined): string | undefined {
  if (!filePath) {
    return undefined;
  }
  try {
    const stats = statSync(filePath);
    return `${filePath}:${stats.size}:${Math.round(stats.mtimeMs)}`;
  } catch {
    return undefined;
  }
}

async function loadVerificationCache(root: string): Promise<Map<string, CachedVerification>> {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(root, VERIFICATION_CACHE_FILE), "utf8")) as {
      version?: number;
      entries?: CachedVerification[];
    };
    if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return new Map();
    }
    return new Map(parsed.entries.map((entry) => [entry.id, entry]));
  } catch {
    return new Map();
  }
}

async function saveVerificationCache(root: string, entries: CachedVerification[]): Promise<void> {
  try {
    const target = path.join(root, VERIFICATION_CACHE_FILE);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ version: 1, entries }, null, 2)}\n`, "utf8");
  } catch {
    // A cache that cannot be written only costs time on the next run.
  }
}

export async function verifyTools(
  entries: ToolRegistryEntry[],
  root: string,
  depth: VerificationDepth = "execute"
): Promise<ToolVerification[]> {
  const runtimes = await probeRuntimesFor(entries, root, depth);

  if (depth === "resolve") {
    // Resolution is a filesystem lookup; caching it would only add staleness.
    return Promise.all(entries.map((entry) => verifyTool(entry, { root, runtimes, depth })));
  }

  const cache = await loadVerificationCache(root);

  const results = await Promise.all(
    entries.map(async (entry) => {
      const cached = cache.get(entry.id);
      if (cached && entry.executable) {
        const current = fingerprintFile(resolveExecutable(entry.executable, root)?.path);
        if (current && current === cached.fingerprint) {
          const { fingerprint: _fingerprint, checkedAt: _checkedAt, ...verification } = cached;
          return { verification, cacheEntry: cached };
        }
      }

      const verification = await verifyTool(entry, { root, runtimes, depth });
      const fingerprint = fingerprintFile(verification.resolvedPath);
      return {
        verification,
        // Only a result tied to a specific file can be invalidated reliably, so
        // only those are cached.
        cacheEntry:
          fingerprint && verification.state === "verified"
            ? { ...verification, fingerprint, checkedAt: new Date().toISOString() }
            : undefined
      };
    })
  );

  await saveVerificationCache(
    root,
    results.map((result) => result.cacheEntry).filter((entry): entry is CachedVerification => Boolean(entry))
  );

  return results.map((result) => result.verification);
}

export function summarizeVerification(verification: ToolVerification): string {
  const where = verification.resolvedPath ?? verification.interpreterPath;
  const version = verification.version ? ` ${verification.version}` : "";
  switch (verification.state) {
    case "verified":
      return `${verification.id}${version} — verified${where ? ` at ${where}` : ""}`;
    case "not_found":
      return `${verification.id} — NOT FOUND: ${verification.reason}`;
    case "broken":
      return `${verification.id} — BROKEN: ${verification.reason}`;
    case "incompatible_runtime":
      return `${verification.id} — RUNTIME MISMATCH: ${verification.reason}`;
    case "unverifiable":
      return `${verification.id} — UNVERIFIED: ${verification.reason}`;
  }
}

export function formatVersionForDisplay(value: string | undefined): string {
  const parsed = parseVersion(value);
  return parsed ? formatVersion(parsed) : (value ?? "unknown");
}
