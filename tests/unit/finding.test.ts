import { describe, expect, it } from "vitest";
import { applyBaseline, dedupeFindings, fingerprintFinding, type Finding } from "../../src/core/finding";

const baseFinding: Finding = {
  id: "a",
  source: "ruff",
  category: "correctness",
  severity: "low",
  confidence: "high",
  title: "F401",
  message: "unused import",
  file: "src/app.py",
  startLine: 1,
  isNew: true,
  isAutofixable: true,
  safeToAutofix: true,
  tags: [],
  scoreImpact: 0
};

describe("finding helpers", () => {
  it("deduplicates overlapping findings", () => {
    const result = dedupeFindings([
      baseFinding,
      { ...baseFinding, id: "b", source: "biome", severity: "medium", safeToAutofix: false, isAutofixable: false }
    ]);

    expect(result).toHaveLength(1);
    expect(result[0].severity).toBe("medium");
  });

  it("produces stable fingerprints", () => {
    expect(fingerprintFinding(baseFinding)).toBe(fingerprintFinding({ ...baseFinding, id: "c" }));
  });

  it("matches line-moved findings when snippet evidence stays the same", () => {
    const fingerprint = fingerprintFinding({
      ...baseFinding,
      startLine: 10,
      evidence: { snippet: "SECRET_TOKEN=abc" }
    });

    const moved = applyBaseline(
      [
        {
          ...baseFinding,
          id: "moved",
          startLine: 50,
          evidence: { snippet: "SECRET_TOKEN=abc" }
        }
      ],
      new Set([fingerprint])
    );

    expect(moved[0].isNew).toBe(false);
  });
});
