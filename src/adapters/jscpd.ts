import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeFilePath, type Finding } from "../core/finding";
import { runCommand } from "../core/toolRunner";
import type { ToolAdapter } from "./shared";

type JscpdClone = {
  format?: string;
  firstFile?: { name?: string; start?: number; end?: number };
  secondFile?: { name?: string; start?: number; end?: number };
  lines?: number;
  tokens?: number;
};

type JscpdOutput = {
  duplicates?: JscpdClone[];
};

export const jscpdAdapter: ToolAdapter = {
  id: "jscpd",
  category: "maintainability",
  async detect(project) {
    return project.languages.length > 0;
  },
  async runStandalone(ctx) {
    const outputDir = path.join(os.tmpdir(), `vibedoctor-jscpd-${Date.now()}`);
    const reportPath = path.join(outputDir, "jscpd-report.json");
    const status = await runCommand(
      {
        cmd: "jscpd",
        args: [".", "--reporters", "json", "--output", outputDir],
        cwd: ctx.root,
        timeoutMs: 120_000
      },
      "Install jscpd with: npm install -D jscpd"
    );

    let findings: Finding[] = [];
    try {
      const content = await fs.readFile(reportPath, "utf8");
      const parsed = JSON.parse(content) as JscpdOutput;
      findings = (parsed.duplicates ?? []).map((clone, index) => ({
        id: `jscpd:${clone.firstFile?.name}:${clone.firstFile?.start ?? 0}:${index}`,
        source: "jscpd" as const,
        category: "maintainability" as const,
        severity: (clone.lines ?? 0) > 20 ? "medium" : "low",
        confidence: "high" as const,
        title: "Duplicated code block",
        message: `${clone.lines ?? clone.tokens ?? 0} duplicated lines between ${clone.firstFile?.name} and ${clone.secondFile?.name}.`,
        file: normalizeFilePath(clone.firstFile?.name, ctx.root),
        startLine: clone.firstFile?.start,
        endLine: clone.firstFile?.end,
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: "Extract or consolidate the duplicated logic only if behavior can stay identical.",
        tags: ["duplication", clone.format ?? "unknown"],
        scoreImpact: 0
      }));
    } catch {
      findings = [];
    } finally {
      await fs.rm(outputDir, { recursive: true, force: true }).catch(() => undefined);
    }

    return { findings, status };
  },
  installHint: "Install jscpd with: npm install -D jscpd"
};
