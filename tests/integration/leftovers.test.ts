import { describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { createTempFixtureCopy } from "../helpers";

describe("leftover detection", () => {
  it("reports comments, commented code, and legacy flags", async () => {
    const root = await createTempFixtureCopy("stale-comments");
    const scan = await runScan(root, "quick");

    expect(scan.leftovers.some((finding) => finding.title === "Commented-out code")).toBe(true);
    expect(scan.leftovers.some((finding) => finding.title === "Legacy flag or env toggle")).toBe(true);
  });
});
