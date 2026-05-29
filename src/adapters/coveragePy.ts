import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../core/toolRunner";
import type { Finding } from "../core/finding";
import type { ToolAdapter } from "./shared";

type CoverageOutput = {
  totals?: {
    percent_covered?: number;
  };
};

export const coveragePyAdapter: ToolAdapter = {
  id: "coverage.py",
  category: "tests",
  async detect(project) {
    return project.languages.includes("python");
  },
  async runStandalone(ctx) {
    const reportFile = path.join(os.tmpdir(), `vibedoctor-coverage-py-${Date.now()}.json`);
    const status = await runCommand(
      {
        cmd: "coverage",
        args: ["json", "-q", "-o", reportFile],
        cwd: ctx.root,
        timeoutMs: 60_000
      },
      "Install coverage.py with: pipx install coverage or add coverage to your project."
    );

    let findings: Finding[] = [];
    try {
      const parsed = JSON.parse(await fs.readFile(reportFile, "utf8")) as CoverageOutput;
      const percent = parsed.totals?.percent_covered;
      if (typeof percent === "number" && percent < ctx.config.checks.tests.minCoverage) {
        findings.push({
          id: "coverage.py:overall",
          source: "coverage.py" as const,
          category: "tests" as const,
          severity: percent < ctx.config.checks.tests.minCoverage / 2 ? "high" : "medium",
          confidence: "high" as const,
          title: "Python coverage below target",
          message: `Coverage is ${percent}% which is below the configured minimum of ${ctx.config.checks.tests.minCoverage}%.`,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: "Add or strengthen Python tests before making broader refactors.",
          tags: ["python", "coverage"],
          scoreImpact: 0
        });
      }
    } catch {
      findings = [];
    } finally {
      await fs.rm(reportFile, { force: true }).catch(() => undefined);
    }

    return { findings, status };
  },
  installHint: "Install coverage.py with: pipx install coverage or add coverage to your project."
};
