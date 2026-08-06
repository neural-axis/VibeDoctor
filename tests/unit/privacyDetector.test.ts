import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScanCommand } from "../../src/cli/commands/scan";
import {
  clearPrivacyFindingsCache,
  detectPiiFindings,
  getPrivacyFindingsCacheStats,
  isValidAadhaar,
  maskPiiValue,
  passesLuhn
} from "../../src/adapters/privacyDetector";
import { runScan } from "../../src/core/engine";
import { loadConfig, defaultConfig } from "../../src/core/config";
import { detectProject } from "../../src/core/projectDetector";
import type { ToolAdapterContext } from "../../src/adapters/shared";
import { createTempFixtureCopy } from "../helpers";

describe("privacy detector", () => {
  afterEach(() => {
    clearPrivacyFindingsCache();
  });
  it("validates and masks common identifier formats", () => {
    expect(passesLuhn("4111 1111 1111 1111")).toBe(true);
    expect(passesLuhn("4111 1111 1111 1112")).toBe(false);
    expect(isValidAadhaar("2345 6789 0124")).toBe(true);
    expect(isValidAadhaar("2345 6789 0123")).toBe(false);
    expect(maskPiiValue("rohit.sharma@example.com", "email")).toBe("ro***@example.com");
    expect(maskPiiValue("ABCDE1234F", "pan")).toBe("A****1234*");
    expect(maskPiiValue("2345 6789 0124", "aadhaar")).toBe("********0124");
  });

  it("detects Privacy Review findings and stores masked evidence", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const scan = await runScan(root, "full");

    expect(scan.privacyFindings.length).toBeGreaterThan(0);
    expect(scan.privacyFindings.some((finding) => finding.source === "privacy-detector")).toBe(true);
    expect(scan.privacyFindings.every((finding) => finding.source === "privacy-detector" || finding.source === "dpdp")).toBe(true);
    expect(scan.privacyFindings.some((finding) => finding.evidence?.entityType === "pan")).toBe(true);
    expect(scan.privacyFindings.some((finding) => finding.evidence?.entityType === "combination_risk")).toBe(true);

    const serialized = JSON.stringify(scan.privacyFindings);
    expect(serialized).not.toContain("ABCDE1234F");
    expect(serialized).not.toContain("rohit.sharma@example.com");
    expect(serialized).toContain("A****1234*");
  });

  it("supports privacy category filtering from the scan command", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const result = await runScanCommand(root, { full: true, category: "privacy", report: "json" });
    const json = JSON.parse(result.output) as { findings: Array<{ category: string }>; privacyFindings: unknown[] };

    expect(result.exitCode).toBe(0);
    expect(json.findings.length).toBeGreaterThan(0);
    expect(json.findings.every((finding) => finding.category === "privacy")).toBe(true);
    expect(json.privacyFindings.length).toBe(json.findings.length);
  });

  it("does not treat programming metadata as PAN or combination-risk PII", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-privacy-code-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "adapter.ts"),
      `type Result = {
  span?: { start: number; end: number };
  message: string;
  agentInstruction: string;
  location: string;
  title: string;
  language: string;
  JS_EXTENSIONS: string[];
};
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
paths:
  include:
    - src/**
baseline:
  enabled: false
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: false
  leftovers:
    enabled: false
  refactorReadiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: true
    presidio:
      enabled: false
  dpdp:
    enabled: false
`,
      "utf8"
    );

    const scan = await runScan(root, "full");

    expect(scan.privacyFindings).toHaveLength(0);
  });

  it("respects the configured file-size cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-pii-size-"));
    await fs.mkdir(path.join(root, "data"), { recursive: true });
    await fs.writeFile(path.join(root, "data", "large.txt"), `email: rohit.sharma@example.com\n${"x".repeat(200)}`, "utf8");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
paths:
  include:
    - data/**
baseline:
  enabled: false
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: false
  leftovers:
    enabled: false
  refactorReadiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: true
    max_file_bytes: 10
    presidio:
      enabled: false
  dpdp:
    enabled: false
`,
      "utf8"
    );

    const scan = await runScan(root, "full");
    expect(scan.privacyFindings).toHaveLength(0);
  });

  it("reuses detectPiiFindings work for identical inputs in the same process", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const { config } = await loadConfig(root);
    const project = await detectProject(root, config.paths.exclude);
    const ctx: ToolAdapterContext = {
      root,
      project,
      config,
      scanMode: "full"
    };

    clearPrivacyFindingsCache();
    const first = await detectPiiFindings(ctx);
    const afterMiss = getPrivacyFindingsCacheStats();
    expect(afterMiss.misses).toBe(1);
    expect(afterMiss.hits).toBe(0);

    const second = await detectPiiFindings(ctx);
    const afterHit = getPrivacyFindingsCacheStats();
    expect(afterHit.misses).toBe(1);
    expect(afterHit.hits).toBe(1);
    expect(second).toEqual(first);
    // Callers get clones — mutating one result must not poison the cache
    if (second[0]) {
      second[0].title = "mutated";
    }
    const third = await detectPiiFindings(ctx);
    expect(third[0]?.title).not.toBe("mutated");
    expect(third[0]?.title).toBe(first[0]?.title);
  });

  it("dedupes concurrent detectPiiFindings calls with the same key", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const { config } = await loadConfig(root);
    const project = await detectProject(root, config.paths.exclude);
    const ctx: ToolAdapterContext = { root, project, config, scanMode: "full" };

    clearPrivacyFindingsCache();
    const [a, b] = await Promise.all([detectPiiFindings(ctx), detectPiiFindings(ctx)]);
    const stats = getPrivacyFindingsCacheStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(a).toEqual(b);
  });

  it("skipCache forces a fresh walk", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const { config } = await loadConfig(root);
    const project = await detectProject(root, config.paths.exclude);
    const ctx: ToolAdapterContext = { root, project, config, scanMode: "full" };

    clearPrivacyFindingsCache();
    await detectPiiFindings(ctx);
    await detectPiiFindings(ctx, { skipCache: true });
    // skipCache does not record hits; still only one miss from the first call
    const stats = getPrivacyFindingsCacheStats();
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(1);
  });

  it("does not share cache entries when privacy confidence threshold differs", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const project = await detectProject(root, defaultConfig.paths.exclude);
    const lowCfg = structuredClone(defaultConfig);
    lowCfg.checks.privacy.enabled = true;
    lowCfg.checks.privacy.minConfidenceToReport = "low";
    const highCfg = structuredClone(defaultConfig);
    highCfg.checks.privacy.enabled = true;
    highCfg.checks.privacy.minConfidenceToReport = "high";

    clearPrivacyFindingsCache();
    await detectPiiFindings({ root, project, config: lowCfg, scanMode: "full" });
    await detectPiiFindings({ root, project, config: highCfg, scanMode: "full" });
    const stats = getPrivacyFindingsCacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);
    expect(stats.size).toBe(2);
  });

  it("invalidates cached findings when a candidate file changes", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const { config } = await loadConfig(root);
    const project = await detectProject(root, config.paths.exclude);
    const ctx: ToolAdapterContext = { root, project, config, scanMode: "full" };

    clearPrivacyFindingsCache();
    await detectPiiFindings(ctx);
    await fs.appendFile(path.join(root, "src", "schema.ts"), "\n// cache invalidation marker\n", "utf8");
    await detectPiiFindings(ctx);

    const stats = getPrivacyFindingsCacheStats();
    expect(stats.misses).toBe(2);
    expect(stats.hits).toBe(0);
  });
});
