import type { ToolAdapter } from "./shared";
import { runDpdpScan } from "../dpdp/scan";

/**
 * DPDP technical readiness adapter.
 * Produces findings from the deterministic DPDP package and writes DPDP artifacts.
 */
export const dpdpAdapter: ToolAdapter = {
  id: "dpdp",
  category: "privacy",
  async detect(_project, config) {
    return config.checks.dpdp.enabled;
  },
  async runStandalone(ctx) {
    const mode = ctx.scanMode === "changed" ? "changed" : ctx.scanMode === "quick" ? "default" : "full";
    const result = await runDpdpScan(ctx.root, mode, {
      context: ctx,
      optionalScannersEnabled: ctx.scanMode !== "quick"
    });
    return {
      findings: result.findings,
      status: {
        command: "dpdp",
        stdout: `DPDP technical posture ${result.scores.technicalPostureScore}/100`,
        stderr: "",
        exitCode: 0,
        durationMs: 0,
        status: "ok"
      }
    };
  },
  installHint: "Built-in DPDP technical readiness module. No external install needed."
};
