import path from "node:path";
import { filterPaths, readTextIfExists } from "../core/paths";
import { safetyThresholds } from "../rules/refactorRules";
import type { Finding } from "../core/finding";
import type { ToolAdapter } from "./shared";

function countOccurrences(content: string, expression: RegExp): number {
  return (content.match(expression) ?? []).length;
}

function scoreLines(lineCount: number, minFileLines: number): number {
  if (lineCount < minFileLines) {
    return 0;
  }
  if (lineCount > minFileLines * 2) {
    return 35;
  }
  return 20;
}

function scoreComplexity(content: string, minComplexity: number): number {
  const branching = countOccurrences(content, /\b(if|else if|switch|case|catch|for|while|except)\b/g);
  if (branching < minComplexity) {
    return 0;
  }
  if (branching >= minComplexity * 2) {
    return 30;
  }
  return 18;
}

function scoreDuplication(lines: string[]): number {
  const fingerprints = new Map<string, number>();
  for (const line of lines.map((item) => item.trim()).filter((item) => item.length > 20)) {
    fingerprints.set(line, (fingerprints.get(line) ?? 0) + 1);
  }
  const duplicates = Array.from(fingerprints.values()).filter((count) => count > 1).length;
  return Math.min(20, duplicates * 2);
}

type FunctionSignal = {
  name: string;
  startLine: number;
  endLine: number;
  length: number;
  complexity: number;
};

function collectFunctionSignals(lines: string[]): FunctionSignal[] {
  const signals: FunctionSignal[] = [];
  const pattern = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)|^\s*def\s+([A-Za-z0-9_]+)|^\s*(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=\s*(?:async\s*)?\(/;
  const functionStarts = lines
    .map((line, index) => {
      const match = line.match(pattern);
      return match ? { index, name: match[1] ?? match[2] ?? match[3] ?? "anonymous" } : undefined;
    })
    .filter((item): item is { index: number; name: string } => Boolean(item));

  for (let i = 0; i < functionStarts.length; i += 1) {
    const current = functionStarts[i];
    const next = functionStarts[i + 1];
    const startLine = current.index + 1;
    const endLine = next ? next.index : lines.length;
    const block = lines.slice(current.index, endLine);
    const complexity = block.reduce((total, line) => total + (line.match(/\b(if|else if|switch|case|catch|for|while|except)\b/g)?.length ?? 0), 0);
    signals.push({
      name: current.name,
      startLine,
      endLine,
      length: endLine - current.index,
      complexity
    });
  }

  return signals;
}

function isSecuritySensitive(file: string, content: string): boolean {
  return /payment|webhook|token|secret|signature|auth|session/i.test(file) || /\b(payment|webhook|secret|token|signature|auth|session)\b/i.test(content);
}

export const customRefactorAdapter: ToolAdapter = {
  id: "custom-refactor",
  category: "refactor_readiness",
  async detect(_project, config) {
    return config.checks.refactorReadiness.enabled;
  },
  async runStandalone(ctx) {
    const candidates = filterPaths(ctx.project.projectFiles, ctx.config.paths.include, ctx.config.paths.exclude).filter((file) =>
      /\.(ts|tsx|js|jsx|py)$/.test(file)
    );

    const findings: Finding[] = [];
    const hasTests = ctx.project.projectFiles.some((file) => /(^|\/)tests?\//.test(file) || /\.test\./.test(file));

    for (const file of candidates) {
      const content = await readTextIfExists(path.join(ctx.root, file));
      if (!content) {
        continue;
      }

      if (/generated/i.test(content.slice(0, 200))) {
        continue;
      }

      const lines = content.split(/\r?\n/);
      const lineCount = lines.length;
      const importCount = countOccurrences(content, /\b(import|from)\b/g);
      const exportCount = countOccurrences(content, /\bexport\b/g) + countOccurrences(content, /\bdef\b/g);
      const functionSignals = collectFunctionSignals(lines);
      const largestFunction = functionSignals.reduce<FunctionSignal | undefined>((largest, signal) => {
        if (!largest || signal.length > largest.length) {
          return signal;
        }
        return largest;
      }, undefined);
      const highComplexFunctions = functionSignals.filter((signal) => signal.complexity >= ctx.config.checks.refactorReadiness.minComplexity);
      const securitySensitive = isSecuritySensitive(file, content);
      const pain =
        scoreLines(lineCount, ctx.config.checks.refactorReadiness.minFileLines) +
        scoreComplexity(content, ctx.config.checks.refactorReadiness.minComplexity) +
        scoreDuplication(lines) +
        Math.min(10, Math.floor(importCount / 6)) +
        Math.min(10, Math.floor(exportCount / 6)) +
        Math.min(12, highComplexFunctions.length * 3) +
        (largestFunction && largestFunction.length > 80 ? 12 : 0);

      const testSafety =
        !ctx.config.checks.refactorReadiness.requireTestsBeforeRefactor ? 25 : hasTests ? 35 : 5;
      const safety =
        testSafety +
        Math.max(0, 25 - Math.floor(exportCount / 2)) +
        Math.max(0, 20 - Math.floor(importCount / 2)) -
        (securitySensitive ? 20 : 0);
      const ready = safety >= safetyThresholds.ready;
      const nearThresholdReady =
        ready &&
        lineCount >= Math.ceil(ctx.config.checks.refactorReadiness.minFileLines * 1.75) &&
        highComplexFunctions.length > 0;

      if (pain < safetyThresholds.pain && !nearThresholdReady) {
        if (!largestFunction || largestFunction.length < 80 || largestFunction.complexity < ctx.config.checks.refactorReadiness.minComplexity) {
          continue;
        }

        findings.push({
          id: `refactor:function:${file}:${largestFunction.startLine}`,
          source: "custom-refactor",
          category: "refactor_readiness",
          severity: ready ? "low" : "medium",
          confidence: "medium",
          title: ready ? "Function ready for refactor" : "Add tests before function refactor",
          message: ready
            ? `${largestFunction.name} in ${file} is a focused extraction candidate.`
            : `${largestFunction.name} in ${file} is complex, but needs better test safety before refactoring.`,
          file,
          startLine: largestFunction.startLine,
          endLine: largestFunction.endLine,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: ready
            ? `Extract ${largestFunction.name} into a smaller helper while keeping the public API unchanged.`
            : `Add tests covering ${largestFunction.name} before attempting a refactor.`,
          tags: ["refactor", "function-level", ready ? "ready" : "tests-first"],
          evidence: {
            snippet: `function=${largestFunction.name}; lines=${largestFunction.length}; complexity=${largestFunction.complexity}; safety=${safety}`
          },
          scoreImpact: 0
        });
        continue;
      }

      findings.push({
        id: `refactor:${file}`,
        source: "custom-refactor",
        category: "refactor_readiness",
        severity: ready ? "low" : "medium",
        confidence: "medium",
        title: ready ? "Ready for refactor" : "Add tests before refactor",
        message: ready
          ? `${file} is large and tangled enough to split with moderate safety.`
          : `${file} looks painful, but test safety is too weak for a confident refactor.`,
        file,
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: ready
          ? `Keep the public entrypoint stable and extract smaller modules in small patches.${largestFunction ? ` Start with ${largestFunction.name}.` : ""}`
          : securitySensitive
            ? "Add focused tests around current behavior before changing structure, especially around the security-sensitive paths."
            : "Add focused tests around current behavior before changing structure.",
        tags: ["refactor", ready ? "ready" : "tests-first"],
        evidence: {
          snippet: `lines=${lineCount}; pain=${pain}; safety=${safety}; imports=${importCount}; exports=${exportCount}; largestFunction=${largestFunction?.name ?? "n/a"}:${largestFunction?.length ?? 0}; securitySensitive=${securitySensitive}`
        },
        scoreImpact: 0
      });
    }

    return { findings };
  },
  installHint: "Built-in detector. No external install needed."
};
