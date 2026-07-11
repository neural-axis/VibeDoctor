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
