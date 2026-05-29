import os from "node:os";
import type { ScanOutput } from "../core/engine";
import { buildSummaryLines } from "../core/engine";

export function renderTerminalReport(scan: ScanOutput): string {
  return `${buildSummaryLines(scan).join(os.EOL)}${os.EOL}\n`;
}
