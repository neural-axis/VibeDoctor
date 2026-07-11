import type { VibeDoctorConfig } from "../core/config";
import type { Finding, FindingCategory } from "../core/finding";
import type { ProjectContext } from "../core/projectDetector";
import { filterPaths } from "../core/paths";
import type { CommandSpec, ToolResult } from "../core/toolRunner";

export type ToolAdapterContext = {
  root: string;
  project: ProjectContext;
  config: VibeDoctorConfig;
  scanMode: "default" | "changed" | "quick" | "full";
};

export type ToolAdapter = {
  id: string;
  category: FindingCategory;
  detect(ctx: ProjectContext, config: VibeDoctorConfig): Promise<boolean>;
  buildScanCommand?(ctx: ToolAdapterContext): CommandSpec;
  parseResult?(result: ToolResult, ctx: ToolAdapterContext): Finding[];
  buildFixCommand?(ctx: ToolAdapterContext): CommandSpec;
  runStandalone?(ctx: ToolAdapterContext): Promise<{ findings: Finding[]; status?: ToolResult }>;
  installHint: string;
};

// Windows limits a cmd.exe command line to ~8191 characters; keep a margin for
// the executable path and flags. When the explicit file list would blow past
// this, fall back to scanning "." and let the tool's own ignore handling apply.
const MAX_TARGET_ARGS_LENGTH = 6_000;

export function adapterTargets(ctx: ToolAdapterContext, extensionPattern: RegExp): string[] {
  const targets = filterPaths(ctx.project.projectFiles, ctx.config.paths.include, ctx.config.paths.exclude).filter((file) =>
    extensionPattern.test(file)
  );
  if (targets.length === 0) {
    return ["."];
  }
  const totalLength = targets.reduce((sum, target) => sum + target.length + 1, 0);
  return totalLength > MAX_TARGET_ARGS_LENGTH ? ["."] : targets;
}
