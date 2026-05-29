import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/commands/init";
import { createTempFixtureCopy } from "../helpers";

describe("runInit", () => {
  it("writes a config seeded with detected languages", async () => {
    const root = await createTempFixtureCopy("mixed-monorepo");
    await runInit(root);

    const config = await fs.readFile(path.join(root, "vibedoctor.yml"), "utf8");
    expect(config).toContain("- python");
    expect(config).toContain("- typescript");
  });
});
