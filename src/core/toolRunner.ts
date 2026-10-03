import path from "node:path";
import { spawn } from "node:child_process";
import { execFile } from "node:child_process";
import { buildCommandEnv, getLocalToolSearchPaths, resolveExecutable } from "./executable";
import { createToolRuntime, type ToolRuntime } from "./toolRuntime";
import { currentPolicy } from "./executionPolicy";

export { buildCommandEnv, getLocalToolSearchPaths };

export type CommandSpec = {
  cmd: string;
  /** Request a named engine; ToolRuntime resolves the executable. */
  tool?: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
  env?: NodeJS.ProcessEnv;
  runtime?: ToolRuntime;
};

export type ToolResult = {
  command: string;
  stdout: string;
  stderr: string;
  exitCode: number | null;
  durationMs: number;
  status: "ok" | "error" | "skipped" | "timeout";
  installHint?: string;
  /** Absolute path of the executable that ran, so reports can prove what was invoked. */
  resolvedPath?: string;
  /** Set when the run covered less than the requested scope (scoped timeout fallback). */
  coverage?: ToolCoverage;
};

export type ToolCoverage = {
  scope: "full" | "scoped" | "none";
  detail: string;
  targetsRequested?: number;
  targetsScanned?: number;
};

export function commandExistsOnWindowsPath(command: string, cwd?: string): boolean {
  return resolveExecutable(command, cwd) !== undefined;
}

function resolveLaunchTarget(
  command: string,
  cwd: string | undefined,
  env: NodeJS.ProcessEnv
): { command: string; useShell: boolean; resolvedPath?: string } {
  const resolved = resolveExecutable(command, cwd, env);

  if (resolved) {
    if (resolved.requiresShell) {
      // cmd.exe scripts must run through the shell; quote the resolved path so
      // directories with spaces (e.g. "Program Files") do not break parsing.
      return {
        command: resolved.path.includes(" ") ? `"${resolved.path}"` : resolved.path,
        useShell: true,
        resolvedPath: resolved.path
      };
    }
    return { command: resolved.path, useShell: false, resolvedPath: resolved.path };
  }

  // Integration profiles never fall back to cmd.exe: its lookup searches the working directory,
  // which is the target repository.
  if (process.platform === "win32" && !path.isAbsolute(command) && currentPolicy().allowShellFallback) {
    // Not found via PATH/PATHEXT probing. Fall back to the shell so commands that
    // are only reachable through cmd.exe mechanisms (App Execution Aliases,
    // App Paths registry entries) still launch, matching the previous behavior.
    return { command, useShell: true };
  }

  return { command, useShell: false };
}

/**
 * Quotes one argument for a cmd.exe command line.
 *
 * Node's `shell: true` joins the command and arguments with spaces and hands the
 * result to cmd.exe verbatim (the behaviour deprecated as DEP0190), so an
 * argument containing a space, a quote, or a shell metacharacter — a repository
 * path under "Program Files", a glob, a rule id with a pipe — arrives split or
 * partly interpreted by the shell. Arguments with nothing special in them are
 * left exactly as they were, so this only changes the cases that were broken.
 */
export function quoteForWindowsShell(argument: string): string {
  if (argument === "") {
    return '""';
  }
  if (!/[\s"&|<>^()%!]/.test(argument)) {
    return argument;
  }

  // Double any backslashes that precede a quote or end the argument, so the
  // receiving program's argv parser sees them as literal backslashes.
  const escaped = argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1");
  // Quoting stops cmd.exe interpreting &, |, <, >, ^ and parentheses, but %VAR%
  // still expands inside quotes and has no in-quote escape, so each % is moved
  // outside the quoted run where a caret does escape it.
  return `"${escaped}"`.split("%").join('"^%"');
}

export async function runCommand(spec: CommandSpec, installHint?: string): Promise<ToolResult> {
  const startedAt = Date.now();
  if (spec.tool) {
    const runtime = spec.runtime ?? createToolRuntime({ projectRoot: spec.cwd });
    const resolvedTool = await runtime.resolve(spec.tool, { projectRoot: spec.cwd });
    if (!resolvedTool.executablePath) {
      const failedHard = resolvedTool.status === "checksum_mismatch" || resolvedTool.status === "failed";
      return {
        command: [spec.tool, ...spec.args].join(" "),
        stdout: "",
        stderr: resolvedTool.reason,
        exitCode: null,
        durationMs: Date.now() - startedAt,
        status: failedHard ? "error" : "skipped",
        installHint: resolvedTool.remediation ?? installHint
      };
    }
    spec = { ...spec, cmd: resolvedTool.executablePath };
  }
  const env = buildCommandEnv(spec.cwd, spec.env);
  const resolved = resolveLaunchTarget(spec.cmd, spec.cwd, env);
  // Build the shell command line here instead of letting spawn concatenate the
  // arguments for us, which it does without any escaping.
  const launch = resolved.useShell
    ? { command: [resolved.command, ...spec.args.map(quoteForWindowsShell)].join(" "), args: [] as string[] }
    : { command: resolved.command, args: spec.args };

  // Integration profiles bound captured output so a runaway tool cannot exhaust memory.
  const maxBytes = currentPolicy().maxOutputBytes ?? Number.POSITIVE_INFINITY;

  return new Promise<ToolResult>((resolve) => {
    const child = spawn(launch.command, launch.args, {
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
      if (stdout.length < maxBytes) stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      if (stderr.length < maxBytes) stderr += chunk.toString();
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
        installHint,
        resolvedPath: resolved.resolvedPath
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
        installHint,
        resolvedPath: resolved.resolvedPath
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
          installHint,
          resolvedPath: resolved.resolvedPath
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
