import { normalizeFilePath, type Finding } from "../core/finding";
import type { ToolAdapter } from "./shared";

type PyrightOutput = {
  generalDiagnostics?: Array<{
    file?: string;
    message: string;
    severity: "error" | "warning" | "information";
    rule?: string;
    range?: {
      start: { line: number };
      end: { line: number };
    };
  }>;
};

function parsePyright(stdout: string): PyrightOutput {
  return stdout.trim() ? (JSON.parse(stdout) as PyrightOutput) : {};
}

function mapSeverity(level: "error" | "warning" | "information"): Finding["severity"] {
  if (level === "error") {
    return "high";
  }
  if (level === "warning") {
    return "medium";
  }
  return "low";
}

export const pyrightAdapter: ToolAdapter = {
  id: "pyright",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("python");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "pyright",
      args: ["--outputjson"],
      cwd: ctx.root,
      timeoutMs: 90_000
    };
  },
  parseResult(result, ctx) {
    return (parsePyright(result.stdout).generalDiagnostics ?? []).map((item, index) => ({
      id: `pyright:${item.file}:${item.range?.start.line ?? 0}:${item.rule ?? index}`,
      source: "pyright",
      category: "correctness",
      severity: mapSeverity(item.severity),
      confidence: "high",
      title: item.rule ?? "pyright",
      message: item.message,
      file: normalizeFilePath(item.file, ctx.root),
      startLine: item.range ? item.range.start.line + 1 : undefined,
      endLine: item.range ? item.range.end.line + 1 : undefined,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Address the Python type issue and rerun the affected tests.",
      tags: ["python", "types"],
      scoreImpact: 0
    }));
  },
  installHint: "Install Pyright with: npm install -D pyright"
};
