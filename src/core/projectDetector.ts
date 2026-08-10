import { promises as fs } from "node:fs";
import path from "node:path";
import { getChangedFiles, isGitRepo } from "./git";
import { filterPaths, listProjectFiles, pathExists } from "./paths";
import { commandExists as resolveCommandExists } from "./executable";
import { registryExecutables } from "./toolRegistry";

export type ProjectLanguage = "python" | "javascript" | "typescript";
export type PackageManager = "npm" | "pnpm" | "yarn" | "bun" | "pip" | "uv" | "poetry" | "pdm";

/**
 * Dependencies the project declares, split by how they reach production.
 *
 * Vulnerability findings arrive from lockfiles, which flatten that distinction
 * away. Without it, an advisory in a build-time dev server is presented as
 * equivalent to one in a library that handles user input.
 */
export type DeclaredDependencies = {
  runtime: string[];
  dev: string[];
  optional: string[];
};

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
  declaredDependencies?: DeclaredDependencies;
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

/**
 * Availability uses the same resolution the scanner uses to launch tools.
 * Shelling out to `where`/`which` answered a subtly different question — it
 * ignored the local `node_modules/.bin` and virtualenv directories the scanner
 * adds to PATH — so a tool could be "unavailable" here and run fine in a scan.
 */
async function commandExists(command: string, root: string): Promise<boolean> {
  return resolveCommandExists(command, root);
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
): Promise<{ testCommands: string[]; frameworkHints: string[]; declaredDependencies?: DeclaredDependencies }> {
  const packagePath = path.join(root, "package.json");
  if (!(await pathExists(packagePath))) {
    return { testCommands: [], frameworkHints: [] };
  }

  const pkg = JSON.parse(await fs.readFile(packagePath, "utf8")) as {
    scripts?: Record<string, string>;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
    optionalDependencies?: Record<string, string>;
    peerDependencies?: Record<string, string>;
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

  return {
    testCommands,
    frameworkHints,
    declaredDependencies: {
      runtime: Object.keys(pkg.dependencies ?? {}),
      dev: Object.keys(pkg.devDependencies ?? {}),
      optional: Object.keys({ ...(pkg.optionalDependencies ?? {}), ...(pkg.peerDependencies ?? {}) })
    }
  };
}

/**
 * Reads Python dependency declarations. Covers the shapes projects actually use:
 * PEP 621 `project.dependencies`, PEP 735 `dependency-groups`, Poetry's groups,
 * and plain requirements files.
 */
async function readPythonDependencies(root: string, projectFiles: string[]): Promise<DeclaredDependencies | undefined> {
  const runtime = new Set<string>();
  const dev = new Set<string>();

  function addSpec(target: Set<string>, spec: string) {
    // Strip version constraints, extras, and markers to leave the package name.
    const name = spec
      .trim()
      .replace(/^-[er]\s+/, "")
      .split(/[\s;]/)[0]
      .split(/[<>=!~[]/)[0]
      .trim();
    if (name && !name.startsWith("#") && !name.startsWith("-")) {
      target.add(name.toLowerCase());
    }
  }

  const pyproject = path.join(root, "pyproject.toml");
  if (await pathExists(pyproject)) {
    const content = await fs.readFile(pyproject, "utf8");
    // A dependency-aware TOML parse is more than this needs: dependency arrays
    // are flat lists of strings, and misreading one only costs scope precision.
    for (const match of content.matchAll(/^\s*(dependencies|optional-dependencies|dev-dependencies)\s*=\s*\[([^\]]*)\]/gms)) {
      const target = match[1] === "dependencies" ? runtime : dev;
      for (const spec of match[2].split(",")) {
        const quoted = /["']([^"']+)["']/.exec(spec);
        if (quoted) {
          addSpec(target, quoted[1]);
        }
      }
    }
    for (const match of content.matchAll(/^\s*\[(?:tool\.poetry\.group\.[\w-]+\.dependencies|dependency-groups)\]/gm)) {
      // Group tables list one package per line after the header.
      const start = match.index! + match[0].length;
      const block = content.slice(start).split(/^\s*\[/m)[0];
      for (const line of block.split(/\r?\n/)) {
        const entry = /^\s*([A-Za-z0-9_.-]+)\s*=/.exec(line);
        if (entry) {
          addSpec(dev, entry[1]);
        }
      }
    }
  }

  for (const file of projectFiles.filter((candidate) => /(^|\/)requirements[\w.-]*\.txt$/i.test(candidate))) {
    const target = /dev|test|lint|ci/i.test(file) ? dev : runtime;
    try {
      const content = await fs.readFile(path.join(root, file), "utf8");
      for (const line of content.split(/\r?\n/)) {
        addSpec(target, line);
      }
    } catch {
      // Unreadable requirements file: scope stays unknown for its packages.
    }
  }

  if (runtime.size === 0 && dev.size === 0) {
    return undefined;
  }

  return { runtime: Array.from(runtime), dev: Array.from(dev), optional: [] };
}

function mergeDeclaredDependencies(
  ...sources: Array<DeclaredDependencies | undefined>
): DeclaredDependencies | undefined {
  const present = sources.filter((source): source is DeclaredDependencies => Boolean(source));
  if (present.length === 0) {
    return undefined;
  }

  return {
    runtime: Array.from(new Set(present.flatMap((source) => source.runtime))),
    dev: Array.from(new Set(present.flatMap((source) => source.dev))),
    optional: Array.from(new Set(present.flatMap((source) => source.optional)))
  };
}

function isFrameworkEntryFile(file: string): boolean {
  return (
    /^(?:src\/)?app\/(?:.+\/)?(?:page|layout|route|loading|error|global-error|not-found|default|template)\.(ts|tsx|js|jsx)$/.test(file) ||
    /^(?:src\/)?pages\/(?:.+)\.(ts|tsx|js|jsx)$/.test(file) ||
    /^(?:src\/)?(?:middleware|instrumentation)\.(ts|js)$/.test(file)
  );
}

export async function detectProject(root: string, excludePatterns?: string[]): Promise<ProjectContext> {
  const projectFiles = await listProjectFiles(root);
  const detectionFiles = excludePatterns ? filterPaths(projectFiles, ["**/*"], excludePatterns) : projectFiles;
  const languages = new Set<ProjectLanguage>();
  const frameworkHints = new Set<string>();

  for (const file of detectionFiles) {
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
  const hasPackageJson = detectionFiles.some((f) => f === "package.json" || f.endsWith("/package.json"));
  const hasPythonManifest = detectionFiles.some(
    (f) => f === "requirements.txt" || f.endsWith("/requirements.txt") || f === "pyproject.toml" || f.endsWith("/pyproject.toml")
  );

  if (hasPackageJson) {
    packageManagers.add(
      detectionFiles.some((f) => f === "pnpm-lock.yaml" || f.endsWith("/pnpm-lock.yaml"))
        ? "pnpm"
        : detectionFiles.some((f) => f === "yarn.lock" || f.endsWith("/yarn.lock"))
          ? "yarn"
          : detectionFiles.some((f) => f === "bun.lockb" || f.endsWith("/bun.lockb"))
            ? "bun"
            : "npm"
    );
  }
  if (hasPythonManifest) {
    packageManagers.add(
      detectionFiles.some((f) => f === "uv.lock" || f.endsWith("/uv.lock"))
        ? "uv"
        : detectionFiles.some((f) => f === "poetry.lock" || f.endsWith("/poetry.lock"))
          ? "poetry"
          : detectionFiles.some((f) => f === "pdm.lock" || f.endsWith("/pdm.lock"))
            ? "pdm"
            : "pip"
    );
  }

  const packageMetadata = await readPackageMetadata(
    root,
    ["npm", "pnpm", "yarn", "bun"].find((manager) => packageManagers.has(manager as PackageManager)) as PackageManager | undefined
  );
  for (const hint of packageMetadata.frameworkHints) {
    frameworkHints.add(hint);
  }

  if (
    detectionFiles.some((f) => f === "pytest.ini" || f.endsWith("/pytest.ini")) ||
    detectionFiles.some((file) => /(^|\/)tests?\//.test(file) && file.endsWith(".py"))
  ) {
    packageMetadata.testCommands.push(pythonTestCommand(packageManagers));
  }

  // Probe every executable the registry knows about, not a hand-maintained
  // subset. Tools missing from that subset always looked unavailable, so setup
  // reinstalled them on every run and the scan could never confirm them.
  const probeTargets = Array.from(new Set<string>([...KNOWN_TOOLS, ...registryExecutables()]));
  const toolPairs = await Promise.all(probeTargets.map(async (tool) => [tool, await commandExists(tool, root)] as const));
  const pythonDependencies = await readPythonDependencies(root, detectionFiles);
  const entryFiles = detectionFiles.filter((file) =>
    /(^|\/)(main|index|app|server|cli)\.(ts|tsx|js|jsx|py)$/.test(file) || isFrameworkEntryFile(file) || file.endsWith("package.json")
  );

  return {
    root,
    languages: Array.from(languages).sort(),
    packageManagers: Array.from(packageManagers).sort(),
    hasGit: await isGitRepo(root),
    changedFiles: await getChangedFiles(root),
    configFiles: KNOWN_CONFIG_FILES.filter((fileName) =>
      detectionFiles.some((f) => f === fileName || f.endsWith(`/${fileName}`))
    ),
    // Consumers pass these values directly to tools such as osv-scanner, so
    // retain the repository-relative path rather than just the basename.
    lockfiles: detectionFiles.filter((file) =>
      KNOWN_LOCKFILES.some((fileName) => file === fileName || file.endsWith(`/${fileName}`))
    ),
    testCommands: Array.from(new Set(packageMetadata.testCommands)),
    toolsAvailable: Object.fromEntries(toolPairs),
    frameworkHints: Array.from(frameworkHints).sort(),
    entryFiles,
    projectFiles,
    declaredDependencies: mergeDeclaredDependencies(packageMetadata.declaredDependencies, pythonDependencies)
  };
}
