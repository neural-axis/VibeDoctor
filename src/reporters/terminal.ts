import type { ScanOutput } from "../core/engine";
import { buildSummaryLines } from "../core/engine";

export function renderTerminalReport(scan: ScanOutput): string {
  return `${buildSummaryLines(scan).join("\n")}\n\n`;
}
