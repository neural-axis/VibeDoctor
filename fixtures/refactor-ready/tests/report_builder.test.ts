import { describe, expect, it } from "vitest";
import { buildReport } from "../src/report_builder";

describe("buildReport", () => {
  it("builds a report string", () => {
    expect(buildReport({ a: "a", b: "b" })).toBe("ab");
  });
});
