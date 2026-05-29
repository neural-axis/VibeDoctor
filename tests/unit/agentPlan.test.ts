import { describe, expect, it } from "vitest";
import { createAgentPlan, type ScanOutput } from "../../src/core/engine";
import type { Finding } from "../../src/core/finding";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "finding",
    source: "gitleaks",
    category: "security",
    severity: "critical",
    confidence: "high",
    title: "Secret found",
    message: "Hardcoded token detected",
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    tags: [],
    scoreImpact: 10,
    ...overrides
  };
}

describe("createAgentPlan", () => {
  it("orders security before cleanup and is deterministic", () => {
    const findings = [
      makeFinding({ id: "cleanup", category: "leftovers", severity: "low", source: "custom-leftovers", title: "Old comment" }),
      makeFinding({ id: "secret", category: "security", severity: "critical", source: "gitleaks", title: "Secret found" })
    ];

    const scan = {
      findings,
      score: { overall: 70, categories: {} as ScanOutput["score"]["categories"], penalties: {} as ScanOutput["score"]["penalties"] },
      skippedTools: []
    };

    const first = createAgentPlan(scan);
    const second = createAgentPlan(scan);

    expect(first.tasks[0].title).toBe("Secret found");
    expect(first.target).toBe("generic");
    expect(first.allowedActions).toContain("run safe fixes");
    expect(first.forbiddenActions).toContain("change public APIs without approval");
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("uses Python test commands for Python findings", () => {
    const scan = {
      findings: [makeFinding({ id: "ruff", source: "ruff", category: "correctness", severity: "medium", title: "F401", file: "app/main.py", tags: ["python"] })],
      score: { overall: 80, categories: {} as ScanOutput["score"]["categories"], penalties: {} as ScanOutput["score"]["penalties"] },
      skippedTools: [],
      testCommands: ["npm test", "pytest"]
    };

    const plan = createAgentPlan(scan);

    expect(plan.tasks[0].verify).toContain("pytest");
    expect(plan.tasks[0].verify).not.toContain("npm test");
  });
});
