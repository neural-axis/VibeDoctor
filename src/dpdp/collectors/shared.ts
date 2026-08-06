import { promises as fs } from "node:fs";
import path from "node:path";
import { stableEvidenceId } from "../evidence";
import type { TechnicalSignalBag } from "../types";

export function pushSignal(
  signals: TechnicalSignalBag[],
  partial: Omit<TechnicalSignalBag, "id"> & { id?: string }
): void {
  const id =
    partial.id ??
    stableEvidenceId([partial.kind, partial.file, partial.line, partial.summary, partial.detectionMethod]);
  signals.push({ ...partial, id });
}

export async function readFileSafe(root: string, file: string, maxBytes: number): Promise<string | undefined> {
  const absolute = path.join(root, file);
  const stat = await fs.stat(absolute).catch(() => undefined);
  if (!stat || stat.size > maxBytes) {
    return undefined;
  }
  const content = await fs.readFile(absolute, "utf8").catch(() => undefined);
  if (!content || content.includes("\0")) {
    return undefined;
  }
  return content;
}

export function lineHasAuth(line: string, nearby: string): boolean {
  // Avoid bare "middleware" — comments and non-auth middleware caused false negatives.
  return /\b(authenticate|requireAuth|isAuthenticated|passport\.authenticate|jwt|authorize|permission|guard|Depends\(|HTTPBearer|login_required|require_auth)\b/i.test(
    `${line}\n${nearby}`
  ) || /\b(auth|session)\b/i.test(`${line}\n${nearby}`) && /\b(middleware|handler|guard|check)\b/i.test(`${line}\n${nearby}`);
}

/** Wider multi-line window for depth-sensitive detectors. */
export function windowAround(lines: string[], index: number, before = 5, after = 8): string {
  return lines.slice(Math.max(0, index - before), Math.min(lines.length, index + after + 1)).join("\n");
}

export function fileHasGlobalAuth(content: string): boolean {
  return /\b(app\.use\s*\(\s*requireAuth|app\.use\s*\(\s*auth|router\.use\s*\(\s*requireAuth|authenticate\s*\(|passport\.authenticate)\b/i.test(
    content
  );
}

export const PII_KEYWORD =
  /\b(email|phone|aadhaar|pan|password|address|dob|date_of_birth|passport|user|customer|profile|patient|member)\b/i;
