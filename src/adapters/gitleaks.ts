import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type GitleaksFinding = {
  RuleID?: string;
  Description?: string;
  File?: string;
  StartLine?: number;
  EndLine?: number;
  Match?: string;
  Secret?: string;
};

function parseGitleaks(stdout: string): GitleaksFinding[] {
  const trimmed = stdout.trim();
  return trimmed ? (JSON.parse(trimmed) as GitleaksFinding[]) : [];
}

export const gitleaksAdapter: ToolAdapter = {
  id: "gitleaks",
  category: "security",
  async detect() {
    return true;
  },
  buildScanCommand(ctx) {
    return {
      tool: "gitleaks",
      cmd: "gitleaks",
      args: ["detect", "--no-banner", "--redact", "--report-format", "json", "--report-path", "-"],
      cwd: ctx.root,
      timeoutMs: 60_000,
      runtime: ctx.toolRuntime
    };
  },
  parseResult(result, ctx) {
    return parseGitleaks(result.stdout).map((item, index) => ({
      id: `gitleaks:${item.File}:${item.StartLine}:${item.RuleID ?? index}`,
      source: "gitleaks",
      category: "security",
      severity: "critical",
      confidence: "high",
      title: item.RuleID ?? "Secret-like token",
      message: item.Description ?? "Potential secret detected.",
      file: normalizeFilePath(item.File, ctx.root),
      startLine: item.StartLine,
      endLine: item.EndLine,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Remove the secret from source, rotate the credential, and replace it with environment-based configuration.",
      tags: ["security", "secret"],
      evidence: {
        snippet: item.Match ?? item.Secret
      },
      scoreImpact: 0
    }));
  },
  installHint: "VibeDoctor provisions a pinned Gitleaks into ~/.cache/vibedoctor when needed. To use a project-local copy, put gitleaks on PATH."
};
