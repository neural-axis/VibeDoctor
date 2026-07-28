import path from "node:path";
import { normalizeFilePath, type Finding } from "../core/finding";
import type { ToolAdapter } from "./shared";

const TSC_PATTERN =
  /^(?<file>.+?)\((?<line>\d+),(?<column>\d+)\): error (?<code>TS\d+): (?<message>.+)$/gm;

function parseTsc(stdout: string, stderr: string): Array<Record<string, string>> {
  const text = `${stdout}\n${stderr}`;
  const matches: Array<Record<string, string>> = [];

  for (const match of text.matchAll(TSC_PATTERN)) {
    if (!match.groups) {
      continue;
    }

    matches.push(match.groups);
  }

  return matches;
}

function mapSeverity(code: string): Finding["severity"] {
  if (/TS2307|TS2322|TS2554|TS7006/.test(code)) {
    return "high";
  }
  return "medium";
}

function findTsconfigPath(projectFiles: string[]): string | undefined {
  if (projectFiles.includes("tsconfig.json")) {
    return "tsconfig.json";
  }
  return projectFiles.find((f) => f.endsWith("/tsconfig.json"));
}

export const tscAdapter: ToolAdapter = {
  id: "tsc",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    const tsconfig = findTsconfigPath(ctx.project.projectFiles);
    const cwd = tsconfig && path.dirname(tsconfig) !== "." ? path.join(ctx.root, path.dirname(tsconfig)) : ctx.root;

    return {
      cmd: "tsc",
      args: ["--noEmit", "--pretty", "false"],
      cwd,
      timeoutMs: 90_000
    };
  },
  parseResult(result, ctx) {
    const output = `${result.stdout}\n${result.stderr}`;
    const parsed = parseTsc(result.stdout, result.stderr);

    // With no tsconfig, tsc prints CLI help and can exit successfully. That
    // does not represent a completed type check.
    if (/Syntax:\s*tsc|TS2304.*--help|Version \d+/i.test(output) && parsed.length === 0) {
      result.status = "skipped";
      return [];
    }

    const tsconfig = findTsconfigPath(ctx.project.projectFiles);
    const prefix = tsconfig && path.dirname(tsconfig) !== "." ? path.dirname(tsconfig) : "";

    return parsed.map((item) => {
      const fullPath = prefix ? path.join(prefix, item.file) : item.file;
      return {
        id: `tsc:${fullPath}:${item.line}:${item.code}`,
        source: "tsc",
        category: "correctness",
        severity: mapSeverity(item.code),
        confidence: "high",
        title: item.code,
        message: item.message,
        file: normalizeFilePath(fullPath, ctx.root),
        startLine: Number(item.line),
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: "Fix the type error without changing public behavior unless required.",
        tags: ["typescript", "types"],
        scoreImpact: 0
      };
    });
  },
  installHint: "Install TypeScript with: npm install -D typescript"
};
