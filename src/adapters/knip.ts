import path from "node:path";
import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type KnipIssue = {
  file?: string;
  line?: number;
  symbol?: string;
};

type KnipOutput = {
  unusedFiles?: string[];
  unusedExports?: KnipIssue[];
  unusedDependencies?: string[];
};

function parseKnip(stdout: string): KnipOutput {
  const trimmed = stdout.trim();
  return trimmed && trimmed.startsWith("{") ? (JSON.parse(trimmed) as KnipOutput) : {};
}

function findPackageJsonPath(projectFiles: string[]): string | undefined {
  if (projectFiles.includes("package.json")) {
    return "package.json";
  }
  return projectFiles.find((f) => f.endsWith("/package.json"));
}

export const knipAdapter: ToolAdapter = {
  id: "knip",
  category: "dead_code",
  async detect(project) {
    return project.languages.includes("javascript") || project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    const packageJsonPath = findPackageJsonPath(ctx.project.projectFiles);
    const cwd = packageJsonPath && path.dirname(packageJsonPath) !== "." ? path.join(ctx.root, path.dirname(packageJsonPath)) : ctx.root;

    return {
      cmd: "knip",
      args: ["--reporter", "json"],
      cwd,
      timeoutMs: 60_000
    };
  },
  parseResult(result, ctx) {
    const output = `${result.stdout}\n${result.stderr}`;

    if (/styleText|ERR_UNKNOWN_BUILTIN_MODULE|SyntaxError.*styleText/i.test(output)) {
      result.status = "skipped";
      result.installHint = "Knip 5+ requires Node >= 20.19. Please upgrade Node.js to run Knip.";
      return [];
    }

    if (result.exitCode !== 0 && /Could not find package\.json|ENOENT.*package\.json/i.test(output)) {
      result.status = "skipped";
      return [];
    }

    const packageJsonPath = findPackageJsonPath(ctx.project.projectFiles);
    const prefix = packageJsonPath && path.dirname(packageJsonPath) !== "." ? path.dirname(packageJsonPath) : "";

    const parsed = parseKnip(result.stdout);
    const fileFindings = (parsed.unusedFiles ?? []).map((file) => ({
      id: `knip:file:${file}`,
      source: "knip" as const,
      category: "dead_code" as const,
      severity: "medium" as const,
      confidence: "high" as const,
      title: "Unused file",
      message: `${file} is not reachable from detected entrypoints.`,
      file: normalizeFilePath(prefix ? path.join(prefix, file) : file, ctx.root),
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Verify no runtime entrypoint or framework convention depends on this file before deletion.",
      tags: ["javascript", "typescript", "dead-code"],
      scoreImpact: 0
    }));

    const exportFindings = (parsed.unusedExports ?? []).map((item) => ({
      id: `knip:export:${item.file}:${item.line}:${item.symbol}`,
      source: "knip" as const,
      category: "dead_code" as const,
      severity: "low" as const,
      confidence: "high" as const,
      title: "Unused export",
      message: `${item.symbol ?? "Export"} appears unused.`,
      file: normalizeFilePath(item.file ? (prefix ? path.join(prefix, item.file) : item.file) : undefined, ctx.root),
      startLine: item.line,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Remove the export only if external consumers and dynamic imports are ruled out.",
      tags: ["javascript", "typescript", "dead-code"],
      scoreImpact: 0
    }));

    const dependencyFindings = (parsed.unusedDependencies ?? []).map((dependency) => ({
      id: `knip:dependency:${dependency}`,
      source: "knip" as const,
      category: "dependencies" as const,
      severity: "low" as const,
      confidence: "medium" as const,
      title: "Unused dependency",
      message: `${dependency} appears unused in the current JS/TS graph.`,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Remove the dependency only after checking scripts, config, and transitive runtime loading.",
      tags: ["javascript", "typescript", "dependencies"],
      scoreImpact: 0
    }));

    return [...fileFindings, ...exportFindings, ...dependencyFindings];
  },
  installHint: "Install Knip with: npm install -D knip"
};
