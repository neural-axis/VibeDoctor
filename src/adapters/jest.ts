import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Finding } from "../core/finding";
import { pathExists } from "../core/paths";
import { runCommand } from "../core/toolRunner";
import type { ToolAdapter } from "./shared";

type CoverageSummary = {
  total?: {
    lines?: { pct?: number };
  };
};

async function readCoverageSummary(filePath: string): Promise<number | undefined> {
  if (!(await pathExists(filePath))) {
    return undefined;
  }

  const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as CoverageSummary;
  return parsed.total?.lines?.pct;
}

export const jestAdapter: ToolAdapter = {
  id: "jest",
  category: "tests",
  async detect(project) {
    return project.frameworkHints.includes("jest") || project.testCommands.some((command) => /jest/i.test(command));
  },
  async runStandalone(ctx) {
    const existingSummary = path.join(ctx.root, "coverage", "coverage-summary.json");
    let percent = await readCoverageSummary(existingSummary);
    let status;

    if (percent === undefined) {
      const outputDir = path.join(os.tmpdir(), `vibedoctor-jest-${Date.now()}`);
      status = await runCommand(
        {
          cmd: "jest",
          args: ["--coverage", "--coverageReporters=json-summary", `--coverageDirectory=${outputDir}`],
          cwd: ctx.root,
          timeoutMs: 180_000
        },
        "Install Jest with: npm install -D jest"
      );
      percent = await readCoverageSummary(path.join(outputDir, "coverage-summary.json"));
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }

    const findings: Finding[] =
      typeof percent === "number" && percent < ctx.config.checks.tests.minCoverage
        ? [
            {
              id: "jest:coverage",
              source: "jest" as const,
              category: "tests" as const,
              severity: percent < ctx.config.checks.tests.minCoverage / 2 ? "high" : "medium",
              confidence: "high" as const,
              title: "JS coverage below target",
              message: `Coverage is ${percent}% which is below the configured minimum of ${ctx.config.checks.tests.minCoverage}%.`,
              isNew: true,
              isAutofixable: false,
              safeToAutofix: false,
              agentInstruction: "Add or expand Jest coverage before larger refactors.",
              tags: ["javascript", "coverage"],
              scoreImpact: 0
            }
          ]
        : [];

    return { findings, status };
  },
  installHint: "Install Jest with: npm install -D jest"
};
