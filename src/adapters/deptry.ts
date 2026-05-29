import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { normalizeFilePath, type Finding } from "../core/finding";
import { runCommand } from "../core/toolRunner";
import type { ToolAdapter } from "./shared";

type DeptryOutput = Array<{
  error: { code: string; message: string };
  module?: string;
  location?: { file: string; line: number };
}>;

function parseDeptry(text: string): DeptryOutput {
  return text.trim() ? (JSON.parse(text) as DeptryOutput) : [];
}

export const deptryAdapter: ToolAdapter = {
  id: "deptry",
  category: "dependencies",
  async detect(project) {
    return project.languages.includes("python");
  },
  async runStandalone(ctx) {
    const tempPath = path.join(os.tmpdir(), `vibedoctor-deptry-${Date.now()}.json`);
    const status = await runCommand(
      {
        cmd: "deptry",
        args: [".", "--json-output", tempPath],
        cwd: ctx.root,
        timeoutMs: 90_000
      },
      "Install deptry with: pipx install deptry or uv tool install deptry"
    );

    let findings: Finding[] = [];
    try {
      const content = await fs.readFile(tempPath, "utf8");
      findings = parseDeptry(content).map((item, index) => ({
        id: `deptry:${item.location?.file}:${item.location?.line ?? 0}:${item.error.code}:${index}`,
        source: "deptry" as const,
        category: "dependencies" as const,
        severity: item.error.code === "DEP002" ? "medium" : "low",
        confidence: "high" as const,
        title: item.error.code,
        message: item.error.message,
        file: normalizeFilePath(item.location?.file, ctx.root),
        startLine: item.location?.line,
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: "Fix the Python dependency declaration without removing packages that may be imported dynamically.",
        tags: ["python", "dependencies"],
        scoreImpact: 0
      }));
    } catch {
      findings = [];
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }

    return { findings, status };
  },
  installHint: "Install deptry with: pipx install deptry or uv tool install deptry"
};
