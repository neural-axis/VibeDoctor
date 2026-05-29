import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type RadonBlock = {
  name?: string;
  lineno?: number;
  endline?: number;
  complexity?: number;
  rank?: string;
};

type RadonOutput = Record<string, RadonBlock[]>;

function parseRadon(stdout: string): RadonOutput {
  return stdout.trim() ? (JSON.parse(stdout) as RadonOutput) : {};
}

export const radonAdapter: ToolAdapter = {
  id: "radon",
  category: "maintainability",
  async detect(project) {
    return project.languages.includes("python");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "radon",
      args: ["cc", "-j", "."],
      cwd: ctx.root,
      timeoutMs: 120_000
    };
  },
  parseResult(result, ctx) {
    return Object.entries(parseRadon(result.stdout)).flatMap(([file, blocks]) =>
      blocks
        .filter((block) => (block.complexity ?? 0) >= ctx.config.checks.refactorReadiness.minComplexity)
        .map((block) => ({
          id: `radon:${file}:${block.lineno ?? 0}:${block.name}`,
          source: "radon" as const,
          category: "maintainability" as const,
          severity: (block.complexity ?? 0) >= ctx.config.checks.refactorReadiness.minComplexity * 2 ? "high" : "medium",
          confidence: "high" as const,
          title: `Complex Python block (${block.rank ?? "?"})`,
          message: `${block.name ?? "Block"} complexity is ${block.complexity}.`,
          file: normalizeFilePath(file, ctx.root),
          startLine: block.lineno,
          endLine: block.endline,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: "Split or simplify the complex Python logic after protecting behavior with tests.",
          tags: ["python", "complexity"],
          scoreImpact: 0
        }))
    );
  },
  installHint: "Install radon with: pipx install radon or uv tool install radon"
};
