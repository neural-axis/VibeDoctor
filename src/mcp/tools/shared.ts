import { promises as fs } from "node:fs";
import path from "node:path";
import { loadAgentPolicy } from "../../agentPack/policy";
import { determineExitCode } from "../../cli/commands/scan";
import { ensureOutputArtifacts, getConfig } from "../../cli/commands/shared";
import { buildExplainPayload, createAgentPlan, filterScanByCategories, runScan, safeFix, type AgentPlan, type ScanOutput } from "../../core/engine";
import { FINDING_CATEGORIES, type Finding, type FindingCategory } from "../../core/finding";
import { pathExists } from "../../core/paths";
import { renderAgentMarkdown } from "../../reporters/agent";

export type McpToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  call: (root: string, args: Record<string, unknown>) => Promise<unknown>;
};

export type ScanToolResult = {
  score: number;
  status: "ok" | "warning" | "blocked";
  exitCode: number;
  blockers: Array<{ id: string; title: string; file?: string; severity: Finding["severity"] }>;
  topFindings: Array<{ id: string; title: string; category: Finding["category"]; severity: Finding["severity"]; file?: string }>;
  reportPath: string;
  agentPlanPath: string;
};

export const categorySchema = {
  type: "array",
  items: {
    type: "string",
    enum: [...FINDING_CATEGORIES]
  }
} as const;

function isFindingCategory(value: unknown): value is FindingCategory {
  return typeof value === "string" && FINDING_CATEGORIES.includes(value as FindingCategory);
}

export function parseCategories(value: unknown): FindingCategory[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error("categories must be an array");
  }

  const invalid = value.filter((item) => !isFindingCategory(item));
  if (invalid.length > 0) {
    throw new Error(`Unsupported categories: ${invalid.join(", ")}`);
  }

  return value as FindingCategory[];
}

export async function prepareScan(
  root: string,
  mode: "changed" | "full" | "default",
  categories?: FindingCategory[],
  target: AgentPlan["target"] = "generic"
): Promise<{ scan: ScanOutput; reportPath: string; agentPlanPath: string; exitCode: number }> {
  const scan = await runScan(root, mode);
  const { config } = await getConfig(root);
  const { policy } = await loadAgentPolicy(root);
  const filtered = categories && categories.length > 0 ? filterScanByCategories(scan, categories, { policy, target }) : scan;
  const withPlan: ScanOutput = {
    ...filtered,
    agentPlan: createAgentPlan(
      { findings: filtered.findings, score: filtered.score, skippedTools: filtered.skippedTools },
      { policy, target }
    )
  };

  await ensureOutputArtifacts(root, config, withPlan);
  return {
    scan: withPlan,
    reportPath: config.output.json,
    agentPlanPath: config.output.agent,
    exitCode: determineExitCode(withPlan, config)
  };
}

export function buildScanResult(
  scan: ScanOutput,
  reportPath: string,
  agentPlanPath: string,
  exitCode: number,
  failOnBlockers = false
): ScanToolResult {
  const blockers = scan.blockers.map((finding) => ({
    id: finding.id,
    title: finding.title,
    file: finding.file,
    severity: finding.severity
  }));

  return {
    score: scan.score.overall,
    status: failOnBlockers && blockers.length > 0 ? "blocked" : exitCode === 0 ? "ok" : "warning",
    exitCode,
    blockers,
    topFindings: scan.topFindings.slice(0, 5).map((finding) => ({
      id: finding.id,
      title: finding.title,
      category: finding.category,
      severity: finding.severity,
      file: finding.file
    })),
    reportPath,
    agentPlanPath
  };
}

export async function readReportJson(root: string, refresh = false, mode: "changed" | "full" = "changed"): Promise<unknown> {
  const { config } = await getConfig(root);
  const reportPath = path.join(root, config.output.json);

  if (refresh || !(await pathExists(reportPath))) {
    await prepareScan(root, mode);
  }

  return JSON.parse(await fs.readFile(reportPath, "utf8")) as unknown;
}

export async function getAgentPlanPayload(
  root: string,
  format: "json" | "markdown" = "json",
  target: AgentPlan["target"] = "generic"
): Promise<{ format: "json" | "markdown"; target: AgentPlan["target"]; plan: unknown }> {
  const { scan } = await prepareScan(root, "default", undefined, target);
  return {
    format,
    target,
    plan: format === "markdown" ? renderAgentMarkdown(scan.agentPlan) : scan.agentPlan
  };
}

export async function explainFindingPayload(root: string, findingId: string): Promise<unknown> {
  const scan = await runScan(root, "default");
  return buildExplainPayload(scan, findingId);
}

export async function fixSafePayload(root: string): Promise<unknown> {
  const { policy } = await loadAgentPolicy(root);
  if (!policy.agentPolicy.allowSafeFix) {
    throw new Error("Safe fixes are disabled by .vibedoctor/agent-policy.yml");
  }

  const result = await safeFix(root);
  const { config } = await getConfig(root);
  await ensureOutputArtifacts(root, config, result.after);

  return {
    beforeFindings: result.before.findings.length,
    afterFindings: result.after.findings.length,
    issuesFixed: Math.max(0, result.before.findings.length - result.after.findings.length),
    toolResults: result.results.map((item) => ({
      id: item.id,
      status: item.status,
      command: item.command
    })),
    reportPath: config.output.json,
    agentPlanPath: config.output.agent
  };
}
