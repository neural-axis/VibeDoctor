import path from "node:path";
import type { ToolAdapterContext } from "../adapters/shared";
import { filterPaths, normalizeToPosix } from "../core/paths";
import type { DpdpCapabilityStatus } from "./types";

const TEXT_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".py",
  ".json",
  ".yml",
  ".yaml",
  ".toml",
  ".env",
  ".sql",
  ".prisma",
  ".graphql",
  ".gql",
  ".md",
  ".txt",
  ".log",
  ".csv"
]);

export type DpdpScanScope = "full" | "changed" | "changed-fallback-full";

export type DpdpCandidateResolution = {
  /** Files to scan after include/exclude + text filters. */
  files: string[];
  /** How the candidate set was chosen. */
  scope: DpdpScanScope;
  /** Raw base set size before include/exclude (project or changed). */
  baseFileCount: number;
  /** Git changed file count from project context. */
  changedFileCount: number;
  /** Capability status for reports (changed scope / fallback). */
  capability?: DpdpCapabilityStatus;
};

export function isDpdpTextCandidate(file: string): boolean {
  const extension = path.extname(file).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || /(^|\/)(\.env|Dockerfile|openapi)/i.test(normalizeToPosix(file));
}

export function normalizeDpdpPath(file: string): string {
  return normalizeToPosix(file.trim());
}

/**
 * Resolve which repository files DPDP collectors should read.
 *
 * Changed mode scopes collection to `project.changedFiles` when non-empty.
 * Empty changed set falls back to full project scope (never empty matrix).
 * Control matrix evaluation always remains full-catalogue; only evidence collection is scoped.
 */
export function resolveDpdpCandidateFiles(ctx: ToolAdapterContext): DpdpCandidateResolution {
  const dpdpCfg = ctx.config.checks.dpdp;
  const include = dpdpCfg.include.length > 0 ? dpdpCfg.include : ctx.config.paths.include;
  const exclude = [...ctx.config.paths.exclude, ...dpdpCfg.exclude];

  const projectFiles = ctx.project.projectFiles.map(normalizeDpdpPath);
  const changedFiles = (ctx.project.changedFiles ?? []).map(normalizeDpdpPath).filter(Boolean);
  const isChangedMode = ctx.scanMode === "changed";

  let base = projectFiles;
  let scope: DpdpScanScope = "full";
  let capability: DpdpCapabilityStatus | undefined;

  if (isChangedMode) {
    if (changedFiles.length > 0) {
      // Prefer intersection with known project files when available; keep git paths that may be new.
      const projectSet = new Set(projectFiles);
      const intersected = changedFiles.filter((file) => projectSet.has(file));
      base = intersected.length > 0 ? intersected : changedFiles;
      scope = "changed";
      capability = {
        id: "changed-scope",
        status: "available",
        message: `Scoped DPDP collection to ${base.length} changed file(s)`
      };
    } else {
      scope = "changed-fallback-full";
      capability = {
        id: "changed-scope",
        status: "skipped",
        message: "No git changed files detected; ran full repository scope for DPDP collection"
      };
    }
  }

  const files = filterPaths(base, include, exclude).filter(isDpdpTextCandidate).map(normalizeDpdpPath);

  return {
    files,
    scope,
    baseFileCount: base.length,
    changedFileCount: changedFiles.length,
    capability
  };
}
