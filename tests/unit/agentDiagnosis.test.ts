import { describe, expect, it } from "vitest";
import { buildAgentDiagnosis } from "../../src/core/agentDiagnosis";
import { correlateFindings } from "../../src/core/findingCorrelator";
import { rankFindings } from "../../src/core/riskRanker";
import { withReportingDefaults, type ScanOutput } from "../../src/core/engine";
import type { Finding } from "../../src/core/finding";
import { renderAgentJson } from "../../src/reporters/agent";

function makeFinding(overrides: Partial<Finding>): Finding {
  return {
    id: "finding",
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
    tags: ["python", "lint"],
    evidence: { toolRawId: "F401" },
    scoreImpact: 1,
    ...overrides
  };
}

describe("agent diagnosis", () => {
  it("ranks a serious issue above lint and groups overlapping evidence", () => {
    const findings = [
      makeFinding({ id: "lint-1", title: "F401", evidence: { toolRawId: "F401" } }),
      makeFinding({
        id: "lint-2",
        title: "F401",
        startLine: 2,
        file: "src/other.py",
        evidence: { toolRawId: "F401" }
      }),
      makeFinding({
        id: "lint-3",
        title: "F841",
        startLine: 3,
        evidence: { toolRawId: "F841" }
      }),
      makeFinding({
        id: "secret",
        source: "gitleaks",
        category: "security",
        severity: "critical",
        title: "Hardcoded secret",
        message: "Token committed in source",
        file: "src/config.ts",
        startLine: 4,
        tags: ["security"],
        evidence: { toolRawId: "generic-api-key" }
      }),
      makeFinding({
        id: "semgrep-secret",
        source: "semgrep",
        category: "security",
        severity: "high",
        title: "Hardcoded secret",
        message: "Token committed in source",
        file: "src/config.ts",
        startLine: 4,
        tags: ["security"],
        evidence: { toolRawId: "generic-api-key" },
        corroboratedBy: ["gitleaks"]
      })
    ];

    const ranked = rankFindings(findings);
    expect(ranked[0].id).toBe("secret");

    const groups = correlateFindings(findings);
    const secretGroup = groups.find((group) => group.findingIds.includes("secret"));
    expect(secretGroup?.findingIds).toEqual(expect.arrayContaining(["secret", "semgrep-secret"]));
    expect(secretGroup?.supportingEngines).toEqual(expect.arrayContaining(["gitleaks", "semgrep"]));
    expect(groups.some((group) => group.findingIds.includes("secret") && group.findingIds.includes("lint-1"))).toBe(
      false
    );

    const scan = withReportingDefaults({
      findings: ranked,
      mode: "full",
      completeness: {
        status: "complete",
        comparable: true,
        planned: 3,
        completed: 3,
        incompleteTools: [],
        requiredIncompleteTools: []
      },
      testCommands: ["pytest"]
    });
    const diagnosis = buildAgentDiagnosis(scan);
    expect(diagnosis.topIssues[0].id).toBe("secret");
    expect(diagnosis.topIssues[0].locations[0]?.file).toBe("src/config.ts");
    expect(diagnosis.topIssues[0].recommendedRepair).toBeTruthy();
    expect(diagnosis.topIssues[0].verificationGuidance).toMatch(/vibedoctor scan --changed/);
    expect(diagnosis.completeness.status).toBe("complete");
    expect(diagnosis.recommendedOrder[0]).toBe("secret");

    const first = renderAgentJson({ ...scan, diagnosis });
    const second = renderAgentJson({ ...scan, diagnosis });
    expect(first).toBe(second);
    expect(first).toContain("topIssues");
    expect(first).toContain("rootCauseGroups");
    expect(first).toContain("src/config.ts");
  });

  it("does not merge nearby findings from different categories", () => {
    const findings = [
      makeFinding({
        id: "lint-1",
        source: "ruff",
        category: "correctness",
        file: "src/app.py",
        startLine: 4
      }),
      makeFinding({
        id: "secret",
        source: "gitleaks",
        category: "security",
        file: "src/app.py",
        startLine: 5,
        title: "Hardcoded secret"
      })
    ];

    const groups = correlateFindings(findings);
    expect(groups).toHaveLength(2);
  });
});
