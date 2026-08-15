import { describe, expect, it } from "vitest";
import { getScanAdapters } from "../../src/core/engine";
import { loadConfig } from "../../src/core/config";
import { detectProject } from "../../src/core/projectDetector";
import { createScanPlan, QUICK_ADAPTER_IDS } from "../../src/core/scanPlanner";
import path from "node:path";
import { resolveScanMode } from "../../src/cli/commands/scan";

describe("default scan profile", () => {
  it("selects the full applicable profile by default and a narrower one for --quick", async () => {
    const root = path.join(process.cwd(), "fixtures", "mixed-monorepo");
    const { config } = await loadConfig(root);
    const project = await detectProject(root, config.paths.exclude);
    const adapters = [...getScanAdapters()];

    const full = await createScanPlan(project, config, adapters, "full");
    const def = await createScanPlan(project, config, adapters, "default");
    const quick = await createScanPlan(project, config, adapters, "quick");

    expect(def.adapterIds.sort()).toEqual(full.adapterIds.sort());
    expect(full.adapterIds).toContain("ruff");
    expect(full.adapterIds).toContain("knip");
    expect(full.adapterIds).toContain("flow-doctor");
    expect(quick.adapterIds.length).toBeLessThan(full.adapterIds.length);
    expect(quick.adapterIds).toContain("ruff");
    expect(quick.adapterIds).not.toContain("knip");
    expect(quick.adapterIds).not.toContain("flow-doctor");
    expect(quick.adapterIds.every((id) => QUICK_ADAPTER_IDS.has(id))).toBe(true);
  });

  it("maps vibedoctor scan with no flags to the full applicable mode", () => {
    expect(resolveScanMode({})).toBe("full");
    expect(resolveScanMode({ full: true })).toBe("full");
    expect(resolveScanMode({ quick: true })).toBe("quick");
    expect(resolveScanMode({ changed: true })).toBe("changed");
    expect(resolveScanMode({ quick: true, full: true })).toBe("quick");
  });
});
