import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

async function runGit(root: string, args: string[]): Promise<{ stdout: string; stderr: string }> {
  return execFileAsync("git", args, { cwd: root, windowsHide: true });
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
