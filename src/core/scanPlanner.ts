import type { ToolAdapter } from "../adapters/shared";
import type { VibeDoctorConfig } from "./config";
import type { ProjectContext } from "./projectDetector";

export type ScanMode = "default" | "changed" | "quick" | "full";

export type ScanPlan = {
  mode: ScanMode;
  adapterIds: string[];
  changedOnly: boolean;
  outputFull: boolean;
};

export async function createScanPlan(
  project: ProjectContext,
  config: VibeDoctorConfig,
  adapters: ToolAdapter[],
  mode: ScanMode
): Promise<ScanPlan> {
  const selected: string[] = [];
  const quickAdapterIds = new Set([
    "ruff",
    "biome",
    "tsc",
    "pyright",
    "gitleaks",
    "osv-scanner",
    "custom-leftovers"
  ]);

  for (const adapter of adapters) {
    if (adapter.category === "security" && !config.checks.security.enabled) {
      continue;
    }
    if (adapter.category === "correctness" && !config.checks.correctness.enabled) {
      continue;
    }
    if (adapter.category === "dead_code" && !config.checks.deadCode.enabled) {
      continue;
    }
    if (adapter.category === "leftovers" && !config.checks.leftovers.enabled) {
      continue;
    }
    if (adapter.category === "refactor_readiness" && !config.checks.refactorReadiness.enabled) {
      continue;
    }
    if (adapter.category === "dependencies" && !config.checks.dependencies.enabled) {
      continue;
    }

    if (mode === "quick" && !quickAdapterIds.has(adapter.id)) {
      continue;
    }

    if (await adapter.detect(project, config)) {
      selected.push(adapter.id);
    }
  }

  return {
    mode,
    adapterIds: selected,
    changedOnly: mode === "changed",
    outputFull: mode === "full"
  };
}
