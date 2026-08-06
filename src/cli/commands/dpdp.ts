import { promises as fs } from "node:fs";
import path from "node:path";
import { getConfig } from "./shared";
import {
  determineDpdpExitCode,
  explainDpdpTarget,
  initDpdpWorkspace,
  loadOrScanDpdp,
  runDpdpScan
} from "../../dpdp/scan";
import {
  renderDpdpHtmlReport,
  renderDpdpJsonReport,
  renderDpdpMarkdownReport,
  renderDpdpTerminalReport,
  renderAgentHandoff
} from "../../dpdp/report";
import { renderReviewQueueMarkdown } from "../../dpdp/reviewQueue";
import { DPDP_ARTIFACT_DIR, readDpdpArtifact } from "../../dpdp/artifacts";
import type { ControlMatrix, DpdpScanMode, DpdpScanResult, PersonalDataMap } from "../../dpdp/types";
import { pathExists } from "../../core/paths";

export type DpdpCommandResult = {
  output: string;
  exitCode: number;
};

export async function runDpdpInitCommand(root: string): Promise<DpdpCommandResult> {
  const written = await initDpdpWorkspace(root);
  return {
    output: `DPDP workspace ready.\n${written.map((item) => `- ${item}`).join("\n")}\n\nThis module provides DPDP technical readiness assessment, not legal certification.\n`,
    exitCode: 0
  };
}

export async function runDpdpScanCommand(
  root: string,
  options: { full?: boolean; changed?: boolean; report?: "terminal" | "json" | "html" | "markdown" } = {}
): Promise<DpdpCommandResult> {
  const mode: DpdpScanMode = options.changed ? "changed" : options.full ? "full" : "full";
  const result = await runDpdpScan(root, mode);
  const { config } = await getConfig(root);
  const exitCode = determineDpdpExitCode(result, config);

  switch (options.report) {
    case "json":
      return { output: renderDpdpJsonReport(result), exitCode };
    case "html":
      return { output: renderDpdpHtmlReport(result), exitCode };
    case "markdown":
      return { output: renderDpdpMarkdownReport(result), exitCode };
    default:
      return { output: renderDpdpTerminalReport(result), exitCode };
  }
}

export async function runDpdpMapCommand(
  root: string,
  options: { refresh?: boolean } = {}
): Promise<DpdpCommandResult> {
  const result = await loadOrScanDpdp(root, "full", options.refresh === true);
  return {
    output: `${JSON.stringify(result.dataMap, null, 2)}\n`,
    exitCode: 0
  };
}

export async function runDpdpReviewQueueCommand(
  root: string,
  options: { refresh?: boolean } = {}
): Promise<DpdpCommandResult> {
  const result = await loadOrScanDpdp(root, "full", options.refresh === true);
  return {
    output: renderReviewQueueMarkdown(result.reviewQueue),
    exitCode: 0
  };
}

export async function runDpdpReportCommand(
  root: string,
  options: { json?: boolean; html?: boolean; markdown?: boolean; refresh?: boolean } = {}
): Promise<DpdpCommandResult> {
  const result = await loadOrScanDpdp(root, "full", options.refresh === true);
  if (options.html) {
    return { output: renderDpdpHtmlReport(result), exitCode: 0 };
  }
  if (options.markdown) {
    return { output: renderDpdpMarkdownReport(result), exitCode: 0 };
  }
  return { output: renderDpdpJsonReport(result), exitCode: 0 };
}

export async function runDpdpHandoffCommand(
  root: string,
  options: { refresh?: boolean } = {}
): Promise<DpdpCommandResult> {
  const result = await loadOrScanDpdp(root, "full", options.refresh === true);
  const handoffPath = path.join(root, DPDP_ARTIFACT_DIR, "agent-handoff.md");
  const content = renderAgentHandoff(result);
  await fs.mkdir(path.dirname(handoffPath), { recursive: true });
  await fs.writeFile(handoffPath, content, "utf8");
  return { output: content, exitCode: 0 };
}

export async function runDpdpVerifyCommand(root: string): Promise<DpdpCommandResult> {
  return runDpdpScanCommand(root, { changed: true, report: "terminal" });
}

export async function runDpdpExplainCommand(
  root: string,
  id: string,
  options: { refresh?: boolean } = {}
): Promise<DpdpCommandResult> {
  const explained = await explainDpdpTarget(root, id, { refresh: options.refresh === true });
  return {
    output: `${JSON.stringify(explained, null, 2)}\n`,
    exitCode: explained.type === "unknown" ? 1 : 0
  };
}

export async function readCachedDataMap(root: string): Promise<PersonalDataMap | undefined> {
  return readDpdpArtifact<PersonalDataMap>(root, "data-map.json");
}

export async function readCachedControlMatrix(root: string): Promise<ControlMatrix | undefined> {
  return readDpdpArtifact<ControlMatrix>(root, "control-matrix.json");
}

export async function ensureDpdpArtifactsExist(root: string): Promise<boolean> {
  return pathExists(path.join(root, DPDP_ARTIFACT_DIR, "control-matrix.json"));
}

/** @deprecated Prefer loadOrScanDpdp from dpdp/scan — kept for internal callers. */
export async function loadOrScan(root: string, mode: DpdpScanMode, refresh = false): Promise<DpdpScanResult> {
  return loadOrScanDpdp(root, mode, refresh);
}
