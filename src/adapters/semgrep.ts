import { normalizeFilePath, type Finding } from "../core/finding";
import { commandExistsOnWindowsPath } from "../core/toolRunner";
import { adapterTargets, type ToolAdapter } from "./shared";

type SemgrepOutput = {
  results?: Array<{
    check_id: string;
    path: string;
    start: { line: number };
    end?: { line: number };
    extra?: {
      message?: string;
      severity?: "INFO" | "WARNING" | "ERROR";
      metadata?: {
        confidence?: "LOW" | "MEDIUM" | "HIGH";
        category?: string;
      };
      lines?: string;
    };
  }>;
};

function parseSemgrep(stdout: string): SemgrepOutput {
  return stdout.trim() ? (JSON.parse(stdout) as SemgrepOutput) : {};
}

function mapSeverity(level: string | undefined): Finding["severity"] {
  if (level === "ERROR") {
    return "high";
  }
  if (level === "WARNING") {
    return "medium";
  }
  return "low";
}

function mapConfidence(level: string | undefined): Finding["confidence"] {
  if (level === "HIGH") {
    return "high";
  }
  if (level === "MEDIUM") {
    return "medium";
  }
  return "low";
}

export const semgrepAdapter: ToolAdapter = {
  id: "semgrep",
  category: "security",
  async detect(project) {
    return project.languages.length > 0;
  },
  buildScanCommand(ctx) {
    const targets = adapterTargets(ctx, /\.(?:js|jsx|ts|tsx|py)$/i);
    // The Semgrep Windows launcher expands wildcard arguments before handing
    // them to pysemgrep. Calling pysemgrep directly preserves exclude globs,
    // but fall back to the regular launcher when only "semgrep" is installed.
    const useDirectEntryPoint = process.platform === "win32" && commandExistsOnWindowsPath("pysemgrep", ctx.root);
    return {
      cmd: useDirectEntryPoint ? "pysemgrep" : "semgrep",
      args: [
        "scan",
        "--json",
        "--no-git-ignore",
        "--config",
        "auto",
        ...targets
      ],
      cwd: ctx.root,
      timeoutMs: 300_000
    };
  },
  parseResult(result, ctx) {
    return (parseSemgrep(result.stdout).results ?? []).map((item) => ({
      id: `semgrep:${item.path}:${item.start.line}:${item.check_id}`,
      source: "semgrep",
      category: item.extra?.metadata?.category === "correctness" ? "correctness" : "security",
      severity: mapSeverity(item.extra?.severity),
      confidence: mapConfidence(item.extra?.metadata?.confidence),
      title: item.check_id,
      message: item.extra?.message ?? "Semgrep reported a potential issue.",
      file: normalizeFilePath(item.path, ctx.root),
      startLine: item.start.line,
      endLine: item.end?.line,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Review the data flow around this finding and make the smallest safe fix.",
      tags: ["security", "semgrep"],
      evidence: {
        snippet: item.extra?.lines
      },
      scoreImpact: 0
    }));
  },
  installHint: "Install Semgrep with: pipx install semgrep or your package manager."
};
