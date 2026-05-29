import { promises as fs } from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { getChangedFiles, isGitRepo } from "./git";
import { listProjectFiles, pathExists } from "./paths";
import { buildCommandEnv } from "./toolRunner";

const execFileAsync = promisify(execFile);

export type ProjectLanguage = "python" | "javascript" | "typescript";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "pip" | "uv" | "poetry" | "pdm";

export type ProjectContext = {
  root: string;
  languages: ProjectLanguage[];
  packageManagers: PackageManager[];
  hasGit: boolean;
  changedFiles: string[];
  configFiles: string[];
  lockfiles: string[];
  testCommands: string[];
  toolsAvailable: Record<string, boolean>;
  frameworkHints: string[];
  entryFiles: string[];
  projectFiles: string[];
};

const KNOWN_CONFIG_FILES = [
  "package.json",
  "tsconfig.json",
  "biome.json",
  ".eslintrc",
  ".eslintrc.js",
  ".eslintrc.cjs",
  ".eslintrc.json",
  "jest.config.js",
  "jest.config.cjs",
  "jest.config.ts",
  "vitest.config.ts",
  "vitest.config.js",
  "pyproject.toml",
  "requirements.txt",
  "uv.lock",
  "poetry.lock",
  "pdm.lock",
  "pytest.ini",
  "ruff.toml",
  "mypy.ini",
  "pyrightconfig.json"
] as const;

const KNOWN_LOCKFILES = ["pnpm-lock.yaml", "package-lock.json", "yarn.lock", "bun.lockb", "uv.lock", "poetry.lock", "pdm.lock"] as const;
const KNOWN_TOOLS = ["ruff", "biome", "knip", "vulture", "gitleaks", "osv-scanner", "semgrep", "tsc", "pyright", "eslint", "jest", "vitest", "coverage"] as const;

async function commandExists(command: string, root: string): Promise<boolean> {
  const locator = process.platform === "win32" ? "where" : "which";
  try {
    await execFileAsync(locator, [command], { cwd: root, env: buildCommandEnv(root, undefined), windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

function packageScriptCommand(packageManager: PackageManager | undefined, name: string): string {
  if (packageManager === "pnpm") {
    return name === "test" ? "pnpm test" : `pnpm run ${name}`;
  }
  if (packageManager === "yarn") {
    return name === "test" ? "yarn test" : `yarn run ${name}`;
  }
  if (packageManager === "bun") {
    return `bun run ${name}`;
  }
  return name === "test" ? "npm test" : `npm run ${name}`;
}

function pythonTestCommand(packageManagers: Set<PackageManager>): string {
  if (packageManagers.has("uv")) {
    return "uv run pytest";
  }
  if (packageManagers.has("poetry")) {
    return "poetry run pytest";
  }
  if (packageManagers.has("pdm")) {
    return "pdm run pytest";
  }
  return "pytest";
}

async function readPackageMetadata(
  root: string,
  packageManager: PackageManager | undefined
): Promise<{ testCommands: string[]; frameworkHints: string[] }> {
  const packagePath = path.join(root, "package.json");
  if (!(await pathExists(packagePath))) {
    return { testCommands: [], frameworkHints: [] };
  }

  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    workspaces?: string[] | { packages?: string[] };
  };

  const testCommands: string[] = [];
  for (const [name, value] of Object.entries(pkg.scripts ?? {})) {
    if (/test|vitest|jest|pytest/i.test(name) || /vitest|jest|pytest/i.test(value)) {
      testCommands.push(packageScriptCommand(packageManager, name));
    }
  }

  const frameworkHints: string[] = [];
  const deps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
  if (deps.next) {
    frameworkHints.push("nextjs");
  }
  if (deps.react) {
    frameworkHints.push("react");
  }
  if (deps.express) {
    frameworkHints.push("express");
  }
  if (deps.vitest) {
    frameworkHints.push("vitest");
  }
  if (deps.jest) {
    frameworkHints.push("jest");
  }
  if (pkg.workspaces) {
    frameworkHints.push("monorepo");
  }

  return { testCommands, frameworkHints };
}

export async function detectProject(root: string): Promise<ProjectContext> {
  const projectFiles = await listProjectFiles(root);
  const fileSet = new Set(projectFiles);
  const languages = new Set<ProjectLanguage>();
  const frameworkHints = new Set<string>();

  for (const file of projectFiles) {
    if (file.endsWith(".py")) {
      languages.add("python");
    }
    if (file.endsWith(".ts") || file.endsWith(".tsx")) {
      languages.add("typescript");
    }
    if (file.endsWith(".js") || file.endsWith(".jsx")) {
      languages.add("javascript");
    }

    if (/manage\.py|django/i.test(file)) {
      frameworkHints.add("django");
    }
    if (/fastapi|flask/i.test(file)) {
      frameworkHints.add("python-web");
    }
  }

  const packageManagers = new Set<PackageManager>();
  if (fileSet.has("package.json")) {
    packageManagers.add(fileSet.has("pnpm-lock.yaml") ? "pnpm" : fileSet.has("yarn.lock") ? "yarn" : fileSet.has("bun.lockb") ? "bun" : "npm");
  }
  if (fileSet.has("requirements.txt") || fileSet.has("pyproject.toml")) {
    packageManagers.add(fileSet.has("uv.lock") ? "uv" : fileSet.has("poetry.lock") ? "poetry" : fileSet.has("pdm.lock") ? "pdm" : "pip");
  }

  const packageMetadata = await readPackageMetadata(
    root,
    ["npm", "pnpm", "yarn", "bun"].find((manager) => packageManagers.has(manager as PackageManager)) as PackageManager | undefined
  );
  for (const hint of packageMetadata.frameworkHints) {
    frameworkHints.add(hint);
  }

  if (fileSet.has("pytest.ini") || projectFiles.some((file) => /(^|\/)tests?\//.test(file) && file.endsWith(".py"))) {
    packageMetadata.testCommands.push(pythonTestCommand(packageManagers));
  }

  const toolPairs = await Promise.all(KNOWN_TOOLS.map(async (tool) => [tool, await commandExists(tool, root)] as const));
  const entryFiles = projectFiles.filter((file) =>
    /(^|\/)(main|index|app|server|cli)\.(ts|tsx|js|jsx|py)$/.test(file) || file === "package.json"
  );

  return {
    root,
    languages: Array.from(languages).sort(),
    packageManagers: Array.from(packageManagers).sort(),
    hasGit: await isGitRepo(root),
    changedFiles: await getChangedFiles(root),
    configFiles: KNOWN_CONFIG_FILES.filter((fileName) => fileSet.has(fileName)),
    lockfiles: KNOWN_LOCKFILES.filter((fileName) => fileSet.has(fileName)),
    testCommands: Array.from(new Set(packageMetadata.testCommands)),
    toolsAvailable: Object.fromEntries(toolPairs),
    frameworkHints: Array.from(frameworkHints).sort(),
    entryFiles,
    projectFiles
  };
}
