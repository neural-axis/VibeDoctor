import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { buildCommandEnv, resolveExecutable } from "./executable";
import { currentPolicy, gitSafetyEnv } from "./executionPolicy";

const execFileAsync = promisify(execFile);

async function runGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  const policy = currentPolicy();
  if (policy.profile === "default") return execFileAsync("git", args, { cwd: root, windowsHide: true });
  // Integration profiles launch git by absolute path from outside the target, with repository
  // settings that could run commands (fsmonitor, hooks, external diff) switched off.
  const env = { ...buildCommandEnv(undefined, undefined), ...gitSafetyEnv(policy) };
  const git = resolveExecutable("git", undefined, env);
  if (!git) throw new Error("git is not available outside the target repository");
  return execFileAsync(git.path, args, { cwd: root, windowsHide: true, env });
}

export async function isGitRepo(root: string): Promise<boolean> {
  try {
    const { stdout } = await runGit(root, ["rev-parse", "--is-inside-work-tree"]);
    return stdout.trim() === "true";
  } catch {
    return false;
  }
}

export async function getChangedFiles(root: string): Promise<string[]> {
  if (!(await isGitRepo(root))) {
    return [];
  }

  const candidates = [
    ["merge-base", "HEAD", "origin/main"],
    ["merge-base", "HEAD", "main"],
    ["merge-base", "HEAD", "origin/master"],
    ["merge-base", "HEAD", "master"]
  ];

  let baseSha = "";

  for (const args of candidates) {
    try {
      const { stdout } = await runGit(root, args);
      if (stdout.trim()) {
        baseSha = stdout.trim();
        break;
      }
    } catch {
      continue;
    }
  }

  const diffArgs = baseSha ? ["diff", "--name-only", `${baseSha}...HEAD`] : ["diff", "--name-only", "HEAD"];

  try {
    const { stdout } = await runGit(root, diffArgs);
    return stdout
      .split(/\r?\n/)
      .map((item) => item.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** HEAD commit of the repository, or null when the root is not a git work tree. */
export async function getHeadCommit(root: string): Promise<string | null> {
  if (!(await isGitRepo(root))) {
    return null;
  }

  try {
    const { stdout } = await runGit(root, ["rev-parse", "HEAD"]);
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function isWorkingTreeDirty(root: string): Promise<boolean> {
  if (!(await isGitRepo(root))) {
    return false;
  }

  try {
    const { stdout } = await runGit(root, ["status", "--porcelain"]);
    return stdout.trim().length > 0;
  } catch {
    return false;
  }
}
