import { describe, expect, it } from "vitest";
import { buildScore, scoreFinding } from "../../src/core/scoring";
import type { Finding } from "../../src/core/finding";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "finding",
    source: "gitleaks",
    category: "security",
    severity: "critical",
    confidence: "high",
    title: "Secret",
    message: "Secret found",
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    tags: [],
    scoreImpact: 0,
    ...overrides
  };
}

describe("scoring", () => {
  it("penalizes a critical security issue more than many autofixable style issues", () => {
    const critical = makeFinding({});
    const styles = Array.from({ length: 50 }, (_, index) =>
      makeFinding({
        id: `style-${index}`,
        source: "biome",
        category: "correctness",
        severity: "low",
        safeToAutofix: true,
        isAutofixable: true,
        title: "Format",
        message: "formatting"
      })
    );

    expect(scoreFinding(critical)).toBeGreaterThan(scoreFinding(styles[0]));
    expect(buildScore([critical]).overall).toBeLessThan(buildScore(styles).overall);
  });
});
