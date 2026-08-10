import type { ToolAdapter } from "../adapters/shared";
import type { CapabilityState } from "./capability";
import type { VibeDoctorConfig } from "./config";
import type { ProjectContext } from "./projectDetector";

export type ScanMode = "default" | "changed" | "quick" | "full";

/** A tool that will not run, and the reason, so the report can say so explicitly. */
export type ExcludedTool = {
  id: string;
  state: Extract<CapabilityState, "disabled" | "not_applicable" | "not_selected" | "deferred">;
  reason: string;
};

export type ScanPlan = {
  mode: ScanMode;
  adapterIds: string[];
  /**
   * Tools deliberately left out. Previously these vanished from the plan, which
   * meant a check that never ran was indistinguishable from one that passed.
   */
  excluded: ExcludedTool[];
  changedOnly: boolean;
  outputFull: boolean;
};

const QUICK_ADAPTER_IDS = new Set([
  "ruff",
  "biome",
  "tsc",
  "pyright",
  "gitleaks",
  "osv-scanner",
  "privacy-detector",
  "dpdp",
  "custom-leftovers"
]);

/** The config switch that governs each category, and the name to report. */
function disabledReason(adapter: ToolAdapter, config: VibeDoctorConfig): string | undefined {
  const { checks } = config;

  switch (adapter.category) {
    case "security":
      return checks.security.enabled ? undefined : "checks.security.enabled is false";
    case "correctness":
      return checks.correctness.enabled ? undefined : "checks.correctness.enabled is false";
    case "dead_code":
      return checks.deadCode.enabled ? undefined : "checks.deadCode.enabled is false";
    case "leftovers":
      return checks.leftovers.enabled ? undefined : "checks.leftovers.enabled is false";
    case "refactor_readiness":
      return checks.refactorReadiness.enabled ? undefined : "checks.refactorReadiness.enabled is false";
    case "dependencies":
      return checks.dependencies.enabled ? undefined : "checks.dependencies.enabled is false";
    case "privacy":
      if (adapter.id === "dpdp") {
        return checks.dpdp.enabled ? undefined : "checks.dpdp.enabled is false";
      }
      return checks.privacy.enabled ? undefined : "checks.privacy.enabled is false";
    default:
      return undefined;
  }
}

export async function createScanPlan(
  project: ProjectContext,
  config: VibeDoctorConfig,
  adapters: ToolAdapter[],
  mode: ScanMode
): Promise<ScanPlan> {
  const selected: string[] = [];
  const excluded: ExcludedTool[] = [];
  const deferred = new Set(config.runtime.deferredTools);

  for (const adapter of adapters) {
    const disabled = disabledReason(adapter, config);
    if (disabled) {
      excluded.push({ id: adapter.id, state: "disabled", reason: `Turned off in config: ${disabled}.` });
      continue;
    }

    if (deferred.has(adapter.id)) {
      excluded.push({
        id: adapter.id,
        state: "deferred",
        reason: "Listed in runtime.deferred_tools, so it was deliberately not run."
      });
      continue;
    }

    if (mode === "quick" && !QUICK_ADAPTER_IDS.has(adapter.id)) {
      excluded.push({
        id: adapter.id,
        state: "not_selected",
        reason: "Not part of the quick profile. Run `vibedoctor scan --full` to include it."
      });
      continue;
    }

    if (!(await adapter.detect(project, config))) {
      excluded.push({
        id: adapter.id,
        state: "not_applicable",
        reason: `Nothing in this repository matches what ${adapter.id} analyses (language, lockfile, or config not present).`
      });
      continue;
    }

    selected.push(adapter.id);
  }

  return {
    mode,
    adapterIds: selected,
    excluded,
    changedOnly: mode === "changed",
    outputFull: mode === "full"
  };
}
