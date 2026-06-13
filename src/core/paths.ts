import { promises as fs } from "node:fs";
import path from "node:path";
import { Minimatch } from "minimatch";

export const DEFAULT_EXCLUDES = [
  "node_modules/**",
  "**/node_modules/**",
  "dist/**",
  "**/dist/**",
  "build/**",
  ".venv/**",
  "**/.venv/**",
  "coverage/**",
  ".next/**",
  "vendor/**",
  ".git/**",
  "**/__pycache__/**",
  "**/*.egg-info/**"
];

export async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(targetPath: string): Promise<void> {
  await fs.mkdir(targetPath, { recursive: true });
}

function matchesAnyPath(patterns: Minimatch[], relativePath: string): boolean {
  return patterns.some((matcher) => matcher.match(relativePath));
}

function shouldSkipDirectory(excludePatterns: Minimatch[], relativePath: string): boolean {
  return matchesAnyPath(excludePatterns, relativePath) || matchesAnyPath(excludePatterns, `${relativePath}/__vibedoctor_probe__`);
}

async function walkDirectory(root: string, currentDir: string, files: string[], excludePatterns: Minimatch[]): Promise<void> {
  const entries = await fs.readdir(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const absolutePath = path.join(currentDir, entry.name);
    const relativePath = path.relative(root, absolutePath).split(path.sep).join("/");

    if (entry.isDirectory()) {
      if (!shouldSkipDirectory(excludePatterns, relativePath)) {
        await walkDirectory(root, absolutePath, files, excludePatterns);
      }
      continue;
    }

    files.push(relativePath);
  }
}

async function readGitignoreExcludes(root: string): Promise<string[]> {
  const gitignorePath = path.join(root, '.gitignore');
  if (!(await pathExists(gitignorePath))) return [];
  try {
    const content = await fs.readFile(gitignorePath, 'utf8');
    return content
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith('#') && !line.startsWith('!'))
      .map((line) => {
        let p = line.replace(/^\//, '');
        if (p.endsWith('/')) p += '**';
        return p;
      });
  } catch {
    return [];
  }
}

export async function listProjectFiles(root: string, excludePatterns: string[] = DEFAULT_EXCLUDES): Promise<string[]> {
  const gitExcludes = await readGitignoreExcludes(root);
  const combined = [...excludePatterns, ...gitExcludes];
  const items: string[] = [];
  await walkDirectory(root, root, items, combined.map((pattern) => new Minimatch(pattern, { dot: true })));
  return items;
}

export function filterPaths(
  items: string[],
  includePatterns: string[] = ["**/*"],
  excludePatterns: string[] = DEFAULT_EXCLUDES
): string[] {
  const includes = includePatterns.map((pattern) => new Minimatch(pattern, { dot: true }));
  const excludes = excludePatterns.map((pattern) => new Minimatch(pattern, { dot: true }));

  return items.filter((item) => matchesAnyPath(includes, item) && !matchesAnyPath(excludes, item));
}

export async function readTextIfExists(filePath: string): Promise<string | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }

  return fs.readFile(filePath, "utf8");
}

export function normalizeToPosix(value: string): string {
  return value.split(path.sep).join("/");
}
