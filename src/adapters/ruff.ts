import type { Finding } from "../core/finding";
import { normalizeFilePath } from "../core/finding";
import { adapterTargets, type ToolAdapter } from "./shared";
import { currentPolicy } from "../core/executionPolicy";

type RuffItem = {
  filename: string;
  code: string;
  message: string;
  location: { row: number };
  end_location?: { row: number };
  fix?: unknown;
};

function parseRuffOutput(stdout: string): RuffItem[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  return JSON.parse(trimmed) as RuffItem[];
}

function mapSeverity(code: string): Finding["severity"] {
  if (/^F|^E9|^B/.test(code)) {
    return "medium";
  }
  if (/^S/.test(code)) {
    return "high";
  }
  return "low";
}

export const ruffAdapter: ToolAdapter = {
  id: "ruff",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("python");
  },
  buildScanCommand(ctx) {
    const targets = adapterTargets(ctx, /\.py$/i);
    const excludePatterns = ctx.config.paths.exclude.length > 0 ? ["--exclude", ctx.config.paths.exclude.join(",")] : [];
    return {
      tool: "ruff",
      cmd: "ruff",
      // Explicit profiles leave the scanned repository unchanged: no .ruff_cache is written.
      args: [
        "check",
        ...targets,
        "--output-format",
        "json",
        ...excludePatterns,
        ...(currentPolicy().profile === "default" ? [] : ["--no-cache"])
      ],
      cwd: ctx.root,
      timeoutMs: 60_000,
      runtime: ctx.toolRuntime
    };
  },
  parseResult(result, ctx) {
    if (!result.stdout.trim()) {
      return [];
    }

    return parseRuffOutput(result.stdout).map((item) => ({
      id: `ruff:${item.filename}:${item.location.row}:${item.code}`,
      source: "ruff",
      category: "correctness",
      severity: mapSeverity(item.code),
      confidence: "high",
      title: item.code,
      message: item.message,
      file: normalizeFilePath(item.filename, ctx.root),
      startLine: item.location.row,
      endLine: item.end_location?.row,
      isNew: true,
      isAutofixable: Boolean(item.fix),
      safeToAutofix: Boolean(item.fix),
      fixCommand: "ruff check . --fix && ruff format .",
      agentInstruction: "Apply the Ruff fix if safe, then rerun the affected Python tests.",
      tags: ["python", "lint"],
      evidence: {
        toolRawId: item.code
      },
      scoreImpact: 0
    }));
  },
  buildFixCommand(ctx) {
    return {
      tool: "ruff",
      cmd: "ruff",
      args: ["check", ".", "--fix"],
      cwd: ctx.root,
      timeoutMs: 60_000,
      runtime: ctx.toolRuntime
    };
  },
  installHint: "VibeDoctor provisions a pinned Ruff into ~/.cache/vibedoctor when needed. To use a project-local copy, install it in the environment."
};
