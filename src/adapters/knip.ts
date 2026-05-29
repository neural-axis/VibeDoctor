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
  return stdout.trim() ? (JSON.parse(stdout) as KnipOutput) : {};
}

export const knipAdapter: ToolAdapter = {
  id: "knip",
  category: "dead_code",
  async detect(project) {
    return project.languages.includes("javascript") || project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "knip",
      args: ["--reporter", "json"],
      cwd: ctx.root,
      timeoutMs: 60_000
    };
  },
  parseResult(result, ctx) {
    const parsed = parseKnip(result.stdout);
    const fileFindings = (parsed.unusedFiles ?? []).map((file) => ({
      id: `knip:file:${file}`,
      source: "knip" as const,
      category: "dead_code" as const,
      severity: "medium" as const,
      confidence: "high" as const,
      title: "Unused file",
      message: `${file} is not reachable from detected entrypoints.`,
      file: normalizeFilePath(file, ctx.root),
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
      file: normalizeFilePath(item.file, ctx.root),
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
