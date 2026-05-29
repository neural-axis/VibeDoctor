import type { VibeDoctorConfig } from "../core/config";
import type { Finding, FindingCategory } from "../core/finding";
import type { ProjectContext } from "../core/projectDetector";
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
