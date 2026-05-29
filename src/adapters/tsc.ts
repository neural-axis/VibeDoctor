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

export const tscAdapter: ToolAdapter = {
  id: "tsc",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "tsc",
      args: ["--noEmit", "--pretty", "false"],
      cwd: ctx.root,
      timeoutMs: 90_000
    };
  },
  parseResult(result, ctx) {
    return parseTsc(result.stdout, result.stderr).map((item) => ({
      id: `tsc:${item.file}:${item.line}:${item.code}`,
      source: "tsc",
      category: "correctness",
      severity: mapSeverity(item.code),
      confidence: "high",
      title: item.code,
      message: item.message,
      file: normalizeFilePath(item.file, ctx.root),
      startLine: Number(item.line),
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Fix the type error without changing public behavior unless required.",
      tags: ["typescript", "types"],
      scoreImpact: 0
    }));
  },
  installHint: "Install TypeScript with: npm install -D typescript"
};
