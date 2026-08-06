import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/config";

describe("loadConfig", () => {
  it("uses safe defaults when no config exists", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-no-config-"));
    const { config } = await loadConfig(root);

    expect(config.baseline.enabled).toBe(true);
    expect(config.checks.leftovers.enabled).toBe(true);
    expect(config.checks.dpdp.enabled).toBe(true);
    expect(config.checks.dpdp.usePresidio).toBe(true);
    expect(config.checks.dpdp.useSemgrep).toBe(true);
    expect(config.checks.privacy.presidio.enabled).toBe(true);
  });

  it("returns isolated defaults and sanitizes malformed DPDP array settings", async () => {
    const firstRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-default-copy-"));
    const first = (await loadConfig(firstRoot)).config;
    first.checks.dpdp.failOnSeverity.push("high");

    const secondRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-default-copy-"));
    const second = (await loadConfig(secondRoot)).config;
    expect(second.checks.dpdp.failOnSeverity).toEqual([]);

    await fs.writeFile(
      path.join(secondRoot, "vibedoctor.yml"),
      "version: 1\nchecks:\n  dpdp:\n    include: src/**\n    fail_on_severity: [high, invalid]\n    fail_on_violated_controls: DPDP-SEC-001\n",
      "utf8"
    );
    const sanitized = (await loadConfig(secondRoot)).config.checks.dpdp;
    expect(sanitized.include).toEqual([]);
    expect(sanitized.failOnSeverity).toEqual(["high"]);
    expect(sanitized.failOnViolatedControls).toEqual([]);
  });

  it("supports disabling leftovers in yaml", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-config-"));
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      "version: 1\nchecks:\n  leftovers:\n    enabled: false\n",
      "utf8"
    );

    const { config } = await loadConfig(root);
    expect(config.checks.leftovers.enabled).toBe(false);
  });

  it("normalizes privacy settings from yaml", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-privacy-config-"));
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      "version: 1\nchecks:\n  privacy:\n    min_confidence_to_report: high\n    fail_on_regulated_identifiers: true\n    ai:\n      enabled: true\n      model_env: CUSTOM_MODEL_ENV\n",
      "utf8"
    );

    const { config } = await loadConfig(root);
    expect(config.checks.privacy.minConfidenceToReport).toBe("high");
    expect(config.checks.privacy.failOnRegulatedIdentifiers).toBe(true);
    expect(config.checks.privacy.ai.enabled).toBe(true);
    expect(config.checks.privacy.ai.modelEnv).toBe("CUSTOM_MODEL_ENV");
  });

  it("normalizes DPDP settings from yaml with unknown organisation defaults", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-dpdp-config-"));
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      "version: 1\nchecks:\n  dpdp:\n    enabled: true\n    min_confidence_to_report: high\n    mask_examples: true\n    legal_source_version: \"2025.1\"\n    fail_on_violated_controls:\n      - DPDP-SEC-001\n    organization:\n      processes_personal_data: unknown\n      is_significant_data_fiduciary: false\n",
      "utf8"
    );

    const { config } = await loadConfig(root);
    expect(config.checks.dpdp.enabled).toBe(true);
    expect(config.checks.dpdp.minConfidenceToReport).toBe("high");
    expect(config.checks.dpdp.maskExamples).toBe(true);
    expect(config.checks.dpdp.legalSourceVersion).toBe("2025.1");
    expect(config.checks.dpdp.failOnViolatedControls).toEqual(["DPDP-SEC-001"]);
    expect(config.checks.dpdp.organization.processesPersonalData).toBe("unknown");
    expect(config.checks.dpdp.organization.isSignificantDataFiduciary).toBe("false");
    expect(config.checks.dpdp.contextFile).toBe(".vibedoctor/dpdp/context.yml");
  });

  it("normalizes runtime timeout and incomplete-scan settings", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-runtime-config-"));
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      "version: 1\nruntime:\n  default_timeout_seconds: 150\n  tool_timeouts:\n    semgrep: 600\n  required_tools:\n    - semgrep\n  fail_on_incomplete_scan: true\n",
      "utf8"
    );

    const { config } = await loadConfig(root);
    expect(config.runtime.defaultTimeoutSeconds).toBe(150);
    expect(config.runtime.toolTimeouts.semgrep).toBe(600);
    expect(config.runtime.requiredTools).toEqual(["semgrep"]);
    expect(config.runtime.failOnIncompleteScan).toBe(true);
  });
});
