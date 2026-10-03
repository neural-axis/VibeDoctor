import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * `sha256-tree-v1`: identifies the exact file contents a scan saw, including uncommitted edits
 * (a commit hash alone does not). Documented in docs/machine-envelope.md so other tools can
 * recompute it independently:
 *
 *   for every regular file under the root, skipping the directories in SKIPPED_DIRECTORIES and
 *   symbolic links, take the POSIX path relative to the root and sha256(content) in hex;
 *   sort by path (code-unit order); hash the concatenation of `${path}\0${hash}\n`.
 *
 * At most MAX_FILES files are hashed; beyond that `truncated` is true and the value covers
 * only the first MAX_FILES paths in sorted order.
 */
export const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".vibedoctor",
  "node_modules",
  ".venv",
  "venv",
  "__pycache__",
  ".world"
]);
export const MAX_FILES = 50_000;

export type SourceFingerprint = {
  algorithm: "sha256-tree-v1";
  value: string;
  files: number;
  truncated: boolean;
};

export async function sourceFingerprint(root: string): Promise<SourceFingerprint> {
  const files: string[] = [];
  let truncated = false;
  async function walk(dir: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIPPED_DIRECTORIES.has(entry.name)) await walk(absolute);
      } else if (entry.isFile()) {
        files.push(path.relative(root, absolute).split(path.sep).join("/"));
      }
    }
  }
  await walk(root);
  files.sort();
  if (files.length > MAX_FILES) {
    truncated = true;
    files.length = MAX_FILES;
  }
  const tree = createHash("sha256");
  for (const file of files) {
    const content = await fs.readFile(path.join(root, file));
    tree.update(`${file}\0${createHash("sha256").update(content).digest("hex")}\n`);
  }
  return { algorithm: "sha256-tree-v1", value: tree.digest("hex"), files: files.length, truncated };
}
