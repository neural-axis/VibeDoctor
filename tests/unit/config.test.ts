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
});
