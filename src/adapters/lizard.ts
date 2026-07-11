import { normalizeFilePath } from "../core/finding";
import { adapterTargets, type ToolAdapter } from "./shared";

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

function parseCsvLine(line: string): string[] {
  const values: string[] = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') {
        value += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (character === "," && !quoted) {
      values.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  values.push(value);
  return values;
}

function parseLizard(stdout: string): LizardFile[] {
  const files = new Map<string, LizardFunction[]>();
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    const columns = parseCsvLine(line);
    if (columns.length < 11) {
      continue;
    }
    const filename = columns[6];
    const functions = files.get(filename) ?? [];
    functions.push({
      name: columns[7],
      start_line: Number(columns[9]),
      end_line: Number(columns[10]),
      cyclomatic_complexity: Number(columns[1])
    });
    files.set(filename, functions);
  }
  return Array.from(files, ([filename, function_list]) => ({ filename, function_list }));
}

export const lizardAdapter: ToolAdapter = {
  id: "lizard",
  category: "maintainability",
  async detect(project) {
    return project.languages.length > 0;
  },
  buildScanCommand(ctx) {
    const targets = adapterTargets(ctx, /\.(?:js|jsx|ts|tsx|py)$/i);
    return {
      cmd: "lizard",
      args: [
        "--csv",
        "--ignore_warnings",
        "-1",
        ...targets
      ],
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
