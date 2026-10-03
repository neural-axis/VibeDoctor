import path from "node:path";
import { accessSync, constants, existsSync, readdirSync, statSync } from "node:fs";
import { allowedPathEntries, currentPolicy, isInside, policyEnv } from "./executionPolicy";

/**
 * Executable discovery, shared by every code path that needs to know whether a
 * tool is usable.
 *
 * Setup used to answer "is this installed?" with one mechanism (`where`/`which`
 * against a bare name) while the scanner answered it with another (PATH probing
 * plus a shell fallback). When the two disagreed, setup reported success for a
 * tool the scanner could not run. Everything now resolves through
 * `resolveExecutable` against the same augmented environment, so "setup found
 * it" and "the scanner can run it" are the same claim.
 */

const LOCAL_TOOL_PATHS = [
  ["node_modules", ".bin"],
  [".venv", "Scripts"],
  [".venv", "bin"],
  ["venv", "Scripts"],
  ["venv", "bin"]
];

function ancestorDirs(startDir: string | undefined): string[] {
  if (!startDir) {
    return [];
  }

  const dirs: string[] = [];
  let current = path.resolve(startDir);

  while (true) {
    dirs.push(current);
    const parent = path.dirname(current);
    if (parent === current) {
      return dirs;
    }
    current = parent;
  }
}

export function getPathKey(env: NodeJS.ProcessEnv): string {
  return Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "PATH";
}

export function getLocalToolSearchPaths(cwd: string | undefined): string[] {
  const paths = ancestorDirs(cwd).flatMap((dir) => LOCAL_TOOL_PATHS.map((segments) => path.join(dir, ...segments)));
  return Array.from(new Set(paths));
}

function getUserToolSearchPaths(env: NodeJS.ProcessEnv): string[] {
  const paths: string[] = [];

  if (process.platform === "win32" && env.APPDATA) {
    const pythonRoot = path.join(env.APPDATA, "Python");
    try {
      for (const entry of readdirSync(pythonRoot, { withFileTypes: true })) {
        if (entry.isDirectory() && /^Python\d+$/i.test(entry.name)) {
          paths.push(path.join(pythonRoot, entry.name, "Scripts"));
        }
      }
    } catch {
      // Python user packages have not been installed for this account.
    }
  } else if (env.HOME) {
    paths.push(path.join(env.HOME, ".local", "bin"));
  }

  return paths;
}

export function buildCommandEnv(cwd: string | undefined, overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const policy = currentPolicy();
  // Integration profiles pass a minimal environment instead of inheriting every variable.
  const env: NodeJS.ProcessEnv = { ...policyEnv(process.env, policy), ...overrides };
  const pathKey = getPathKey(env);
  const existingPath = env[pathKey];
  const local = policy.allowProjectLocalTools ? getLocalToolSearchPaths(cwd) : [];
  const entries = [...local, ...getUserToolSearchPaths(env), ...(existingPath ?? "").split(path.delimiter)].filter(Boolean);
  env[pathKey] = allowedPathEntries(entries, policy).join(path.delimiter);
  return env;
}

function isExecutableFile(candidate: string): boolean {
  try {
    if (!statSync(candidate).isFile()) {
      return false;
    }
  } catch {
    return false;
  }

  if (process.platform === "win32") {
    return true;
  }

  try {
    accessSync(candidate, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export type ResolvedExecutable = {
  /** Absolute path to the file that will actually be launched. */
  path: string;
  /** True when the resolved file must be launched through a shell (.cmd/.bat). */
  requiresShell: boolean;
};

/**
 * Resolves a command name to a concrete file, searching the same augmented PATH
 * the scanner uses. Returns undefined when nothing on PATH matches — callers
 * should treat that as "not installed" and report the searched locations.
 */
export function resolveExecutable(
  command: string,
  cwd?: string,
  env: NodeJS.ProcessEnv = buildCommandEnv(cwd, undefined)
): ResolvedExecutable | undefined {
  const policy = currentPolicy();
  // Nothing inside the target may be launched when project-local tools are not allowed.
  const permitted = (candidate: string) =>
    policy.allowProjectLocalTools || !policy.targetRoot || !isInside(policy.targetRoot, candidate);
  if (path.isAbsolute(command)) {
    return isExecutableFile(command) && permitted(command)
      ? { path: command, requiresShell: /\.(?:cmd|bat)$/i.test(command) }
      : undefined;
  }

  const pathValue = env[getPathKey(env)] ?? "";
  const directories = pathValue.split(path.delimiter).filter(Boolean);
  const extensions =
    process.platform === "win32"
      ? // An explicit extension on the command wins; otherwise try each PATHEXT entry.
        path.extname(command)
        ? [""]
        : (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD").split(";").map((extension) => extension.toLowerCase())
      : [""];

  for (const directory of directories) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate) && isExecutableFile(candidate) && permitted(candidate)) {
        return { path: candidate, requiresShell: /\.(?:cmd|bat)$/i.test(candidate) };
      }
    }
  }

  return undefined;
}

export function commandExists(command: string, cwd?: string): boolean {
  return resolveExecutable(command, cwd) !== undefined;
}

/** The directories searched, so a "not found" report can say where we looked. */
export function describeSearchPaths(cwd?: string): string[] {
  const env = buildCommandEnv(cwd, undefined);
  return (env[getPathKey(env)] ?? "").split(path.delimiter).filter(Boolean);
}
