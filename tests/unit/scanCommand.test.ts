import { describe, expect, it } from "vitest";
import { determineExitCode } from "../../src/cli/commands/scan";
import { defaultConfig } from "../../src/core/config";
import type { Finding } from "../../src/core/finding";
import type { ScanOutput } from "../../src/core/engine";

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
    scoreImpact: 20,
    ...overrides
  };
}

function makeScan(overrides: Partial<Pick<ScanOutput, "score" | "findings">>): Pick<ScanOutput, "score" | "findings"> {
  return {
    score: {
      overall: 95,
      categories: {
        security: 95,
        correctness: 100,
        tests: 100,
        dependencies: 100,
        maintainability: 100,
        dead_code: 100,
        leftovers: 100,
        refactor_readiness: 100,
        efficiency: 100
      },
      penalties: {
        security: 5,
        correctness: 0,
        tests: 0,
        dependencies: 0,
        maintainability: 0,
        dead_code: 0,
        leftovers: 0,
        refactor_readiness: 0,
        efficiency: 0
      }
    },
    findings: [],
    ...overrides
  };
}

describe("determineExitCode", () => {
  it("does not fail without dependency findings when dependency gates are enabled", () => {
    expect(determineExitCode(makeScan({}), defaultConfig)).toBe(0);
  });

  it("fails when the score is below the configured minimum", () => {
    const config = {
      ...defaultConfig,
      score: {
        minimum: 90
      }
    };

    expect(
      determineExitCode(
        makeScan({
          score: {
            ...makeScan({}).score,
            overall: 74
          }
        }),
        config
      )
    ).toBe(1);
  });

  it("ignores baseline findings for blocker rules when configured", () => {
    const scan = makeScan({
      findings: [makeFinding({ isNew: false })]
    });

    expect(determineExitCode(scan, defaultConfig)).toBe(0);
  });

  it("fails on a new test failure", () => {
    const scan = makeScan({
      findings: [
        makeFinding({
          source: "vitest",
          category: "tests",
          severity: "high",
          title: "Test failure"
        })
      ]
    });

    expect(determineExitCode(scan, defaultConfig)).toBe(1);
  });

  it("fails on a new missing dependency finding", () => {
    const scan = makeScan({
      findings: [
        makeFinding({
          source: "deptry",
          category: "dependencies",
          severity: "medium",
          title: "DEP002"
        })
      ]
    });

    expect(determineExitCode(scan, defaultConfig)).toBe(1);
  });
});
