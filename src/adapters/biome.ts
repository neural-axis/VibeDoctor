import type { Finding } from "../core/finding";
import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type BiomeDiagnostic = {
  category?: string;
  severity?: "info" | "warn" | "error";
  description?: string;
  location?: {
    path?: {
      file?: string;
    };
    span?: {
      start?: { line: number };
      end?: { line: number };
    };
  };
  tags?: string[];
};

type BiomeReport = {
  diagnostics?: BiomeDiagnostic[];
};

function parseBiomeOutput(stdout: string): BiomeDiagnostic[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as BiomeReport;
  return parsed.diagnostics ?? [];
}

function mapSeverity(level: BiomeDiagnostic["severity"]): Finding["severity"] {
  if (level === "error") {
    return "medium";
  }
  if (level === "warn") {
    return "low";
  }
  return "info";
}

export const biomeAdapter: ToolAdapter = {
  id: "biome",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("javascript") || project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "biome",
      args: ["check", ".", "--reporter=json"],
      cwd: ctx.root,
      timeoutMs: 60_000
    };
  },
  parseResult(result, ctx) {
    return parseBiomeOutput(result.stdout).map((item, index) => ({
      id: `biome:${item.location?.path?.file ?? "unknown"}:${index}`,
      source: "biome",
      category: "correctness",
      severity: mapSeverity(item.severity),
      confidence: "high",
      title: item.category ?? "biome",
      message: item.description ?? "Biome reported an issue.",
      file: normalizeFilePath(item.location?.path?.file, ctx.root),
      startLine: item.location?.span?.start?.line,
      endLine: item.location?.span?.end?.line,
      isNew: true,
      isAutofixable: true,
      safeToAutofix: true,
      fixCommand: "biome check . --write",
      agentInstruction: "Apply Biome's safe write mode for this file.",
      tags: ["javascript", "typescript", ...(item.tags ?? [])],
      scoreImpact: 0
    }));
  },
  buildFixCommand(ctx) {
    return {
      cmd: "biome",
      args: ["check", ".", "--write"],
      cwd: ctx.root,
      timeoutMs: 60_000
    };
  },
  installHint: "Install Biome with: npm install -D @biomejs/biome"
};
