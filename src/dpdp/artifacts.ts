import { promises as fs } from "node:fs";
import path from "node:path";
import type { Finding } from "../core/finding";
import { ensureDir } from "../core/paths";
import type {
  ControlMatrix,
  DpdpContext,
  DpdpScanMode,
  DpdpScanResult,
  DpdpScores,
  EvidenceLedger,
  PersonalDataMap,
  ReviewQueueItem
} from "./types";
import { renderReviewQueueMarkdown } from "./reviewQueue";
import { renderAgentHandoff, renderDpdpHtmlReport, renderDpdpMarkdownReport } from "./report";

export const DPDP_ARTIFACT_DIR = ".vibedoctor/dpdp";
export const DPDP_READINESS_REPORT = "readiness-report.json";

export async function writeDpdpArtifacts(root: string, result: DpdpScanResult): Promise<string[]> {
  const dir = path.join(root, DPDP_ARTIFACT_DIR);
  await ensureDir(dir);

  const files: Array<{ name: string; content: string }> = [
    { name: "data-map.json", content: `${JSON.stringify(result.dataMap, null, 2)}\n` },
    { name: "control-matrix.json", content: `${JSON.stringify(result.controlMatrix, null, 2)}\n` },
    { name: "evidence-ledger.json", content: `${JSON.stringify(result.evidenceLedger, null, 2)}\n` },
    { name: "review-queue.md", content: renderReviewQueueMarkdown(result.reviewQueue) },
    { name: "agent-handoff.md", content: renderAgentHandoff(result) },
    { name: "readiness-report.json", content: `${JSON.stringify(serializeDpdpReport(result), null, 2)}\n` },
    { name: "readiness-report.md", content: renderDpdpMarkdownReport(result) },
    { name: "readiness-report.html", content: renderDpdpHtmlReport(result) }
  ];

  const written: string[] = [];
  for (const file of files) {
    const absolute = path.join(dir, file.name);
    await fs.writeFile(absolute, file.content, "utf8");
    written.push(path.join(DPDP_ARTIFACT_DIR, file.name).replaceAll("\\", "/"));
  }
  return written;
}

export function serializeDpdpReport(result: DpdpScanResult): Record<string, unknown> {
  return {
    version: result.version,
    generatedAt: result.generatedAt,
    disclaimer: result.disclaimer,
    mode: result.mode,
    legalSourceVersion: result.legalSourceVersion,
    scores: result.scores,
    summary: result.scores.statusCounts,
    dataMap: result.dataMap,
    controlMatrix: result.controlMatrix,
    reviewQueue: result.reviewQueue,
    fixNext: result.fixNext,
    capabilities: result.capabilities,
    findings: result.findings,
    context: result.context,
    baselineApplied: result.baselineApplied
  };
}

export async function readDpdpArtifact<T>(root: string, name: string): Promise<T | undefined> {
  const absolute = path.join(root, DPDP_ARTIFACT_DIR, name);
  try {
    return JSON.parse(await fs.readFile(absolute, "utf8")) as T;
  } catch {
    return undefined;
  }
}

/**
 * Load a previously written DPDP scan result from artifacts without re-scanning.
 * Requires readiness-report.json (and preferably evidence-ledger.json).
 */
export async function loadCachedDpdpScanResult(root: string): Promise<DpdpScanResult | undefined> {
  const report = await readDpdpArtifact<Record<string, unknown>>(root, DPDP_READINESS_REPORT);
  if (!report?.scores || !report?.controlMatrix) {
    return undefined;
  }

  const evidenceLedger =
    (await readDpdpArtifact<EvidenceLedger>(root, "evidence-ledger.json")) ??
    ({
      version: 1,
      generatedAt: String(report.generatedAt ?? ""),
      disclaimer: String(report.disclaimer ?? ""),
      evidence: [],
      declared: []
    } satisfies EvidenceLedger);

  const dataMapRaw =
    (await readDpdpArtifact<PersonalDataMap>(root, "data-map.json")) ??
    (report.dataMap as PersonalDataMap | undefined);
  if (!dataMapRaw) {
    return undefined;
  }
  const dataMap: PersonalDataMap = {
    ...dataMapRaw,
    graph: dataMapRaw.graph ?? { nodes: [], edges: [] }
  };

  return {
    version: 1,
    generatedAt: String(report.generatedAt ?? ""),
    root,
    mode: (report.mode as DpdpScanMode) ?? "full",
    disclaimer: String(report.disclaimer ?? ""),
    scores: report.scores as DpdpScores,
    dataMap,
    controlMatrix: report.controlMatrix as ControlMatrix,
    evidenceLedger,
    reviewQueue: (report.reviewQueue as ReviewQueueItem[]) ?? [],
    fixNext:
      (report.fixNext as DpdpScanResult["fixNext"]) ??
      [],
    capabilities: (report.capabilities as DpdpScanResult["capabilities"]) ?? [],
    findings: (report.findings as Finding[]) ?? [],
    legalSourceVersion: String(report.legalSourceVersion ?? ""),
    context: (report.context as DpdpContext) ?? {
      version: 1,
      organization: {
        processesPersonalData: "unknown",
        isSignificantDataFiduciary: "unknown",
        processesChildrenData: "unknown",
        hasCrossBorderTransfer: "unknown"
      }
    },
    baselineApplied: Boolean(report.baselineApplied)
  };
}
