import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { runScan } from "../../src/core/engine";
import { createTempFixtureCopy } from "../helpers";

describe("custom detectors (leftovers config gates + min confidence)", () => {
  it("respects scanCommentedCode: false by suppressing 'Commented-out code' while keeping legacy flags", async () => {
    const root = await createTempFixtureCopy("stale-comments");

    // Overwrite with config that disables commented code scanning (but keeps other leftovers)
    const yml = `version: 1
checks:
  leftovers:
    enabled: true
    scan_comments: true
    scan_commented_code: false
    scan_legacy_fallbacks: true
  refactor_readiness:
    enabled: false
`;
    await fs.writeFile(path.join(root, "vibedoctor.yml"), yml, "utf8");

    const scan = await runScan(root, "default");

    const hasCommented = scan.leftovers.some((f) => f.title === "Commented-out code");
    const hasLegacyFlag = scan.leftovers.some((f) => f.title === "Legacy flag or env toggle");

    expect(hasCommented).toBe(false);
    expect(hasLegacyFlag).toBe(true);
  });

  it("minConfidenceToReport filters low-confidence dead chains when set high", async () => {
    const root = await createTempFixtureCopy("dead-code-chain");

    // Config requesting only high confidence dead code
    const yml = `version: 1
checks:
  deadCode:
    enabled: true
    minConfidenceToReport: high
  leftovers:
    enabled: false
  refactor_readiness:
    enabled: false
`;
    await fs.writeFile(path.join(root, "vibedoctor.yml"), yml, "utf8");

    const scan = await runScan(root, "default");

    // The fixture produces a dead-chain candidate; with high filter it may be dropped or kept depending on computed conf.
    // We assert the mechanism works without crashing and that any returned have >= high.
    const deadOnes = scan.deadCodeCandidates.filter((f) => f.source === "custom-dead-chain");
    for (const d of deadOnes) {
      expect(["high"]).toContain(d.confidence); // if any survive, must be high
    }
    // At minimum, scan succeeds and deadCodeCandidates array is present (may be 0 or 1)
    expect(Array.isArray(scan.deadCodeCandidates)).toBe(true);
  });
});
