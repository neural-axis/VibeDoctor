import path from "node:path";
import { existsSync, readdirSync } from "node:fs";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";

export type CommandSpec = {
  cmd: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
};

export type ToolResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  status: "ok" | "error" | "skipped" | "timeout";
  installHint?: string;
};

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

function getPathKey(env: NodeJS.ProcessEnv): string {
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
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const pathKey = getPathKey(env);
  const existingPath = env[pathKey];
  env[pathKey] = [...getLocalToolSearchPaths(cwd), ...getUserToolSearchPaths(env), existingPath].filter(Boolean).join(path.delimiter);
  return env;
}

function findWindowsCommandOnPath(command: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathValue = env[getPathKey(env)] ?? "";
  const extensions = (env.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((extension) => extension.toLowerCase());

  for (const directory of pathValue.split(path.delimiter).filter(Boolean)) {
    for (const extension of extensions) {
      const candidate = path.join(directory, `${command}${extension}`);
      if (existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function commandExistsOnWindowsPath(command: string, cwd?: string): boolean {
  return findWindowsCommandOnPath(command, buildCommandEnv(cwd, undefined)) !== undefined;
}

function resolveWindowsCommand(command: string, env: NodeJS.ProcessEnv): { command: string; useShell: boolean } {
  if (process.platform !== "win32" || path.isAbsolute(command) || path.extname(command)) {
    return { command, useShell: false };
  }

  const candidate = findWindowsCommandOnPath(command, env);
  if (candidate) {
    if (/\.(?:cmd|bat)$/i.test(candidate)) {
      // cmd.exe scripts must run through the shell; quote the resolved path so
      // directories with spaces (e.g. "Program Files") do not break parsing.
      return { command: candidate.includes(" ") ? `"${candidate}"` : candidate, useShell: true };
    }
    return { command: candidate, useShell: false };
  }

  // Not found via PATH/PATHEXT probing. Fall back to the shell so commands that
  // are only reachable through cmd.exe mechanisms (App Execution Aliases,
  // App Paths registry entries) still launch, matching the previous behavior.
  return { command, useShell: true };
}

export async function runCommand(spec: CommandSpec, installHint?: string): Promise<ToolResult> {
  const startedAt = Date.now();
  const env = buildCommandEnv(spec.cwd, spec.env);
  const resolved = resolveWindowsCommand(spec.cmd, env);

  return new Promise<ToolResult>((resolve) => {
    const child = spawn(resolved.command, spec.args, {
      cwd: spec.cwd,
      env,
      shell: resolved.useShell,
      windowsHide: true
    });

    let stdout = "";
    let stderr = "";
    let settled = false;
    let timeoutHandle: NodeJS.Timeout | undefined;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    function cleanup() {
      try {
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
          timeoutHandle = undefined;
        }
        child.stdout?.removeAllListeners("data");
        child.stderr?.removeAllListeners("data");
        child.removeAllListeners();
        // Release stdio handles so they don't keep the event loop referenced on some platforms
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {
        // best effort
      }
    }

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      resolve({
        command: [spec.cmd, ...spec.args].join(" "),
        stdout,
        stderr: error.message,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        status: /ENOENT|not recognized/i.test(error.message) ? "skipped" : "error",
        installHint
      });
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();

      resolve({
        command: [spec.cmd, ...spec.args].join(" "),
        stdout,
        stderr,
        exitCode,
        durationMs: Date.now() - startedAt,
        status:
          exitCode === 0
            ? "ok"
            : /not recognized|not found|is not installed|no such file/i.test(stderr)
              ? "skipped"
              : "error",
        installHint
      });
    });

    if (spec.timeoutMs) {
      timeoutHandle = setTimeout(() => {
        if (settled) {
          return;
        }

        settled = true;
        if (process.platform === "win32" && child.pid) {
          execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => undefined);
        } else {
          try {
            child.kill("SIGTERM");
          } catch {}
        }
        cleanup();
        resolve({
          command: [spec.cmd, ...spec.args].join(" "),
          stdout,
          stderr,
          exitCode: null,
          durationMs: Date.now() - startedAt,
          status: "timeout",
          installHint
        });
      }, spec.timeoutMs);
    }
  });
}

export async function runCommands(
  commands: Array<{ id: string; command: CommandSpec; installHint?: string }>
): Promise<Record<string, ToolResult>> {
  const pairs = await Promise.all(
    commands.map(async ({ id, command, installHint }) => [id, await runCommand(command, installHint)] as const)
  );

  return Object.fromEntries(pairs);
}
