import { promises as fs } from "node:fs";
import path from "node:path";
import type { ScanOutput } from "../../core/engine";
import { loadConfig, type VibeDoctorConfig } from "../../core/config";
import { ensureDir } from "../../core/paths";
import { renderAgentMarkdown } from "../../reporters/agent";
import { renderHtmlReport } from "../../reporters/html";
import { renderJsonReport } from "../../reporters/json";

export async function ensureOutputArtifacts(root: string, config: VibeDoctorConfig, scan: ScanOutput): Promise<void> {
  await ensureDir(path.join(root, ".vibedoctor"));
  await writeOutput(root, config.output.json, renderJsonReport(scan));
  await writeOutput(root, config.output.html, renderHtmlReport(scan));
  await writeOutput(root, config.output.agent, renderAgentMarkdown(scan));
}

export async function getConfig(root: string) {
  return loadConfig(root);
}

export async function writeOutput(root: string, file: string, content: string): Promise<void> {
  const absolutePath = path.join(root, file);
  await ensureDir(path.dirname(absolutePath));
  await fs.writeFile(absolutePath, content, "utf8");
}
