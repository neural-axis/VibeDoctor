import path from "node:path";
import { spawn } from "node:child_process";

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

export function buildCommandEnv(cwd: string | undefined, overrides: NodeJS.ProcessEnv | undefined): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const pathKey = getPathKey(env);
  const existingPath = env[pathKey];
  env[pathKey] = [...getLocalToolSearchPaths(cwd), existingPath].filter(Boolean).join(path.delimiter);
  return env;
}

export async function runCommand(spec: CommandSpec, installHint?: string): Promise<ToolResult> {
  const startedAt = Date.now();
  const useShell =
    process.platform === "win32" &&
    !path.isAbsolute(spec.cmd) &&
    path.extname(spec.cmd).length === 0;

  return new Promise<ToolResult>((resolve) => {
    const child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: buildCommandEnv(spec.cwd, spec.env),
      shell: useShell,
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

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
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
      if (timeoutHandle) {
        clearTimeout(timeoutHandle);
      }

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
        child.kill("SIGTERM");
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
