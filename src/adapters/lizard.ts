import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type LizardFunction = {
  name?: string;
  start_line?: number;
  end_line?: number;
  cyclomatic_complexity?: number;
};

type LizardFile = {
  filename?: string;
  function_list?: LizardFunction[];
};

function parseLizard(stdout: string): LizardFile[] {
  return stdout.trim() ? (JSON.parse(stdout) as LizardFile[]) : [];
}

export const lizardAdapter: ToolAdapter = {
  id: "lizard",
  category: "maintainability",
  async detect(project) {
    return project.languages.length > 0;
  },
  buildScanCommand(ctx) {
    return {
      cmd: "lizard",
      args: ["-j", "."],
      cwd: ctx.root,
      timeoutMs: 120_000
    };
  },
  parseResult(result, ctx) {
    return parseLizard(result.stdout).flatMap((file) =>
      (file.function_list ?? [])
        .filter((item) => (item.cyclomatic_complexity ?? 0) >= ctx.config.checks.refactorReadiness.minComplexity)
        .map((item) => ({
          id: `lizard:${file.filename}:${item.start_line ?? 0}:${item.name}`,
          source: "lizard" as const,
          category: "maintainability" as const,
          severity: (item.cyclomatic_complexity ?? 0) >= ctx.config.checks.refactorReadiness.minComplexity * 2 ? "high" : "medium",
          confidence: "high" as const,
          title: "High cyclomatic complexity",
          message: `${item.name ?? "Function"} complexity is ${item.cyclomatic_complexity}.`,
          file: normalizeFilePath(file.filename, ctx.root),
          startLine: item.start_line,
          endLine: item.end_line,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: "Reduce branching with extraction or guard clauses while keeping current behavior stable.",
          tags: ["complexity"],
          scoreImpact: 0
        }))
    );
  },
  installHint: "Install lizard with: pipx install lizard or uv tool install lizard"
};
