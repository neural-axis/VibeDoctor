import path from "node:path";
import { filterPaths, readTextIfExists } from "../core/paths";
import type { Finding } from "../core/finding";
import type { ProjectContext } from "../core/projectDetector";

type CodeNode = {
  id: string;
  type: "file" | "dependency" | "test";
  file?: string;
  name: string;
  language: "python" | "javascript" | "typescript";
  incoming: string[];
  outgoing: string[];
  tags: string[];
};

type DeadChainCandidate = {
  files: string[];
  confidence: "low" | "medium" | "high";
  reasons: string[];
  dependencies: string[];
};

const SOURCE_FILE_PATTERN = /\.(ts|tsx|js|jsx|py)$/;
const JS_EXTENSIONS = [".ts", ".tsx", ".js", ".jsx"];
const PY_EXTENSIONS = [".py"];

function isTestFile(file: string): boolean {
  return /(^|\/)tests?\//.test(file) || /\.test\./.test(file) || /\.spec\./.test(file);
}

function detectLanguage(file: string): CodeNode["language"] {
  if (file.endsWith(".py")) {
    return "python";
  }
  if (file.endsWith(".ts") || file.endsWith(".tsx")) {
    return "typescript";
  }
  return "javascript";
}

function parseImports(file: string, content: string): string[] {
  const imports = new Set<string>();

  if (file.endsWith(".py")) {
    for (const match of content.matchAll(/(?:from\s+([.\w]+)\s+import|import\s+([.\w]+))/g)) {
      const value = match[1] ?? match[2];
      if (value) {
        imports.add(value);
      }
    }
    return Array.from(imports);
  }

  for (const match of content.matchAll(/(?:import|export)\s+(?:[^"'`]+?\s+from\s+)?["'`]([^"'`]+)["'`]/g)) {
    if (match[1]) {
      imports.add(match[1]);
    }
  }

  for (const match of content.matchAll(/require\(\s*["'`]([^"'`]+)["'`]\s*\)/g)) {
    if (match[1]) {
      imports.add(match[1]);
    }
  }

  return Array.from(imports);
}

function resolveRelativeImport(fromFile: string, specifier: string, projectFiles: Set<string>, extensions: string[]): string | undefined {
  const baseDir = path.posix.dirname(fromFile);
  const raw = path.posix.normalize(path.posix.join(baseDir, specifier));
  const candidates = [
    raw,
    ...extensions.map((extension) => `${raw}${extension}`),
    ...extensions.map((extension) => `${raw}/index${extension}`)
  ];

  return candidates.find((candidate) => projectFiles.has(candidate));
}

function resolvePythonImport(fromFile: string, specifier: string, projectFiles: Set<string>): string | undefined {
  if (specifier.startsWith(".")) {
    const depth = specifier.match(/^\.+/)?.[0].length ?? 1;
    const remainder = specifier.slice(depth);
    let baseDir = path.posix.dirname(fromFile);
    for (let index = 1; index < depth; index += 1) {
      baseDir = path.posix.dirname(baseDir);
    }
    const relative = remainder.replaceAll(".", "/");
    const directCandidates = [
      path.posix.normalize(path.posix.join(baseDir, relative)),
      path.posix.normalize(path.posix.join(baseDir, `${relative}.py`)),
      path.posix.normalize(path.posix.join(baseDir, relative, "__init__.py"))
    ];
    return directCandidates.find((candidate) => projectFiles.has(candidate));
  }

  const dottedPath = specifier.replaceAll(".", "/");
  return [`${dottedPath}.py`, `${dottedPath}/__init__.py`].find((candidate) => projectFiles.has(candidate));
}

async function buildGraph(project: ProjectContext): Promise<Map<string, CodeNode>> {
  const sourceFiles = filterPaths(project.projectFiles, ["**/*"]).filter((file) => SOURCE_FILE_PATTERN.test(file));
  const projectFileSet = new Set(sourceFiles);
  const graph = new Map<string, CodeNode>();

  for (const file of sourceFiles) {
    graph.set(file, {
      id: file,
      type: isTestFile(file) ? "test" : "file",
      file,
      name: path.posix.basename(file),
      language: detectLanguage(file),
      incoming: [],
      outgoing: [],
      tags: []
    });
  }

  for (const file of sourceFiles) {
    const content = await readTextIfExists(path.join(project.root, file));
    if (!content) {
      continue;
    }

    const imports = parseImports(file, content);
    const extensions = file.endsWith(".py") ? PY_EXTENSIONS : JS_EXTENSIONS;

    for (const specifier of imports) {
      let resolved: string | undefined;
      if (file.endsWith(".py")) {
        resolved = resolvePythonImport(file, specifier, projectFileSet);
      } else if (specifier.startsWith(".")) {
        resolved = resolveRelativeImport(file, specifier, projectFileSet, extensions);
      }

      if (!resolved) {
        continue;
      }

      const sourceNode = graph.get(file);
      const targetNode = graph.get(resolved);
      if (!sourceNode || !targetNode) {
        continue;
      }

      sourceNode.outgoing.push(resolved);
      targetNode.incoming.push(file);
    }
  }

  return graph;
}

function collectEntrypoints(project: ProjectContext, graph: Map<string, CodeNode>): string[] {
  const explicit = new Set(
    project.entryFiles.filter((file) => graph.has(file) && !isTestFile(file))
  );

  for (const file of graph.keys()) {
    if (/^src\/(index|main|app|server)\.(ts|tsx|js|jsx|py)$/.test(file)) {
      explicit.add(file);
    }
  }

  return Array.from(explicit);
}

function markReachable(graph: Map<string, CodeNode>, entrypoints: string[]): Set<string> {
  const reachable = new Set<string>();
  const queue = [...entrypoints];

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (reachable.has(current)) {
      continue;
    }

    reachable.add(current);
    const node = graph.get(current);
    if (!node) {
      continue;
    }

    for (const target of node.outgoing) {
      if (!reachable.has(target)) {
        queue.push(target);
      }
    }
  }

  return reachable;
}

function buildComponents(graph: Map<string, CodeNode>, unreachableSeeds: Set<string>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];

  for (const seed of unreachableSeeds) {
    if (visited.has(seed)) {
      continue;
    }

    const stack = [seed];
    const component: string[] = [];

    while (stack.length > 0) {
      const current = stack.pop()!;
      if (visited.has(current) || !unreachableSeeds.has(current)) {
        continue;
      }

      visited.add(current);
      component.push(current);
      const node = graph.get(current);
      if (!node) {
        continue;
      }

      for (const edge of [...node.outgoing, ...node.incoming]) {
        if (!visited.has(edge) && unreachableSeeds.has(edge)) {
          stack.push(edge);
        }
      }
    }

    if (component.length > 0) {
      components.push(component.sort());
    }
  }

  return components;
}

function hasDynamicPattern(file: string): boolean {
  return /\.tsx?$/.test(file) ? /route|plugin|dynamic/i.test(file) : /manage|settings|celery/i.test(file);
}

function isPackageInitializer(file: string): boolean {
  return file.endsWith("/__init__.py") || file === "__init__.py";
}

export async function detectDeadChains(project: ProjectContext, findings: Finding[]): Promise<Finding[]> {
  const graph = await buildGraph(project);
  const entrypoints = collectEntrypoints(project, graph);
  const reachable = markReachable(graph, entrypoints);

  const deadCodeFiles = new Set(
    findings.filter((finding) => finding.category === "dead_code" && finding.file).map((finding) => finding.file!)
  );

  const candidates = new Set<string>();
  for (const [file, node] of graph.entries()) {
    if (node.type === "test") {
      continue;
    }
    if (!reachable.has(file) && (deadCodeFiles.has(file) || node.incoming.every((incoming) => !reachable.has(incoming)))) {
      candidates.add(file);
    }
  }

  const components = buildComponents(graph, candidates);
  const dependencyNames = findings
    .filter((finding) => finding.category === "dependencies" && /unused dependency/i.test(finding.title))
    .map((finding) => finding.message.split(" ")[0]);

  return components
    .filter((component) => component.length > 1 || deadCodeFiles.has(component[0]))
    .map((component, index) => {
      const testReferenced = component.some((file) =>
        Array.from(graph.values()).some((node) => node.type === "test" && node.outgoing.includes(file))
      );
      const dynamicRisk = component.some((file) => hasDynamicPattern(file));
      const packageInitializer = component.some((file) => isPackageInitializer(file));
      const confidence: "low" | "medium" | "high" = packageInitializer || testReferenced ? "low" : dynamicRisk ? "medium" : "high";
      const reasons = [
        "No active entrypoint reaches this cluster.",
        packageInitializer ? "One or more files are package initializers that may expose implicit package behavior." : undefined,
        testReferenced ? "One or more files are referenced by tests." : "No tests reference this cluster.",
        "The files mostly call each other inside the same isolated cluster."
      ].filter((reason): reason is string => Boolean(reason));
      const dependencies = dependencyNames.filter((dependency) => component.some((file) => file.includes(path.posix.basename(dependency))));

      return {
        id: `dead-chain:${index + 1}:${component[0]}`,
        source: "custom-dead-chain" as const,
        category: "dead_code" as const,
        severity: confidence === "high" ? "medium" : "low",
        confidence,
        title: packageInitializer ? "Review-only dead chain candidate" : "Dead chain candidate",
        message: `${component[0]}${component.length > 1 ? ` and ${component.length - 1} linked files` : ""} look isolated from active entrypoints${packageInitializer ? ", but package initializers require manual review" : ""}.`,
        file: component[0],
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: packageInitializer
          ? `Review this chain manually before any deletion because it includes a Python package initializer:\n${component.map((file) => `- ${file}`).join("\n")}`
          : `Review and, if unused at runtime, delete this chain as one unit:\n${component.map((file) => `- ${file}`).join("\n")}`,
        tags: packageInitializer ? ["dead-chain", "review-only"] : ["dead-chain"],
        evidence: {
          snippet: `${reasons.join(" ")} Files: ${component.join(", ")}${dependencies.length > 0 ? ` Dependencies: ${dependencies.join(", ")}` : ""}`
        },
        scoreImpact: 0
      };
    });
}

export type { CodeNode, DeadChainCandidate };
