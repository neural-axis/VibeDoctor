import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { filterScanByCategories, type ScanOutput } from "../../src/core/engine";
import { buildCapabilityMatrix } from "../../src/core/capability";
import type { Finding } from "../../src/core/finding";
import { renderJsonReport } from "../../src/reporters/json";
import { renderTerminalReport } from "../../src/reporters/terminal";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "leftover:src/auth.ts:4",
    source: "custom-leftovers",
    category: "leftovers",
    severity: "low",
    confidence: "medium",
    title: "Legacy fallback path appears present",
    message: "if (LEGACY_AUTH_ENABLED) {",
    file: "src/auth.ts",
    startLine: 4,
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    tags: ["leftovers", "fallback-branch"],
    scoreImpact: 2,
    ...overrides
  };
}

function makeScan(): ScanOutput {
  const findings = [
    makeFinding({
      id: "gitleaks:src/config.ts:1",
      source: "gitleaks",
      category: "security",
      severity: "critical",
      confidence: "high",
      title: "Hardcoded secret",
      message: "Hardcoded secret in config",
      file: "src/config.ts",
      startLine: 1,
      tags: ["security"],
      scoreImpact: 45
    }),
    makeFinding({
      id: "dead-chain:1",
      source: "custom-dead-chain",
      category: "dead_code",
      severity: "medium",
      confidence: "high",
      title: "Dead chain candidate",
      message: "src/legacy.ts look isolated from active entrypoints.",
      file: "src/legacy.ts",
      startLine: undefined,
      tags: ["dead-chain"],
      scoreImpact: 8
    }),
    makeFinding(),
    makeFinding({
      id: "refactor:src/report_builder.ts",
      source: "custom-refactor",
      category: "refactor_readiness",
      title: "Ready for refactor",
      message: "src/report_builder.ts is large and tangled enough to split with moderate safety.",
      file: "src/report_builder.ts",
      startLine: undefined,
      tags: ["refactor", "ready"]
    })
  ];

  return {
    root: "D:\\repo",
    mode: "full",
    score: {
      overall: 71,
      categories: {
        security: 55,
        correctness: 100,
        dead_code: 92,
        leftovers: 98,
        maintainability: 100,
        dependencies: 100,
        tests: 100,
        privacy: 100,
        efficiency: 100,
        refactor_readiness: 98
      },
      penalties: {
        security: 45,
        correctness: 0,
        dead_code: 8,
        leftovers: 2,
        maintainability: 0,
        dependencies: 0,
        tests: 0,
        privacy: 0,
        efficiency: 0,
        refactor_readiness: 2
      }
    },
    findings,
    topFindings: [findings[0]],
    blockers: [findings[0]],
    fixNext: [findings[0], findings[1], findings[3]],
    privacyFindings: [],
    leftovers: [findings[2]],
    deadCodeCandidates: [findings[1]],
    refactorCandidates: [findings[3]],
    toolStatuses: [{ id: "gitleaks", status: "ok" }],
    skippedTools: [{ id: "semgrep", status: "skipped", installHint: "Install Semgrep" }],
    completeness: {
      status: "partial",
      comparable: false,
      planned: 2,
      completed: 1,
      incompleteTools: ["semgrep"],
      requiredIncompleteTools: [],
      reason: "1 of 2 planned checks did not complete."
    },
    recoveryActions: [],
    testCommands: ["npm test"],
    agentPlan: {
      goal: "Raise health score from 71 to 85",
      status: "partial",
      target: "generic",
      workflow: ["scan", "plan", "safe fix", "edit carefully", "verify", "scan again", "summarize"],
      rules: [
        "Fix blockers before cleanup work.",
        "Do not delete low-confidence dead code.",
        "Do not refactor large files without tests.",
        "Do not lower test, lint, security, or coverage thresholds."
      ],
      allowedActions: ["edit source files", "add tests", "run safe fixes"],
      forbiddenActions: [
        "disable tests",
        "lower thresholds",
        "delete low-confidence dead code",
        "upgrade dependencies",
        "change public APIs without approval"
      ],
      doNotTouch: ["Do not assume semgrep was fully checked because the tool was skipped."],
      recoveryActions: [],
      tasks: [
        {
          id: "task-1",
          title: "Hardcoded secret",
          priority: 1,
          files: ["src/config.ts"],
          instructions: [
            "Hardcoded secret in config",
            "Move the secret to an environment variable.",
            "Do not change public behavior unless required."
          ],
          verify: ["npm test", "vibedoctor scan --changed --report json"],
          doNotTouch: ["Do not change public APIs without approval."],
          commands: []
        }
      ]
    },
    configPath: "D:\\repo\\vibedoctor.yml",
    capabilityMatrix: buildCapabilityMatrix(
      [
        {
          id: "gitleaks",
          category: "security",
          state: "completed",
          planned: true,
          applicable: true,
          discovered: true,
          executed: true,
          resolvedPath: "C:\\tools\\gitleaks.exe",
          version: "8.18.0",
          command: "gitleaks detect --no-banner",
          durationMs: 1200,
          findingsReported: 1,
          findingsSurfaced: 1,
          reason: "Ran 8.18.0 at C:\\tools\\gitleaks.exe.",
          trust: "authoritative"
        },
        {
          id: "semgrep",
          category: "security",
          state: "timed_out",
          planned: true,
          applicable: true,
          discovered: true,
          executed: true,
          timeoutSeconds: 300,
          durationMs: 300_000,
          findingsReported: 0,
          findingsSurfaced: 0,
          reason: "Exceeded its 300s budget and was stopped, so this check did not run.",
          remediation: "Raise runtime.tool_timeouts.semgrep in vibedoctor.yml, scan fewer paths, or run `vibedoctor scan --changed` for a diff-scoped run.",
          trust: "absent"
        }
      ],
      []
    ),
    relevance: {
      enabled: true,
      perTool: [
        {
          tool: "vulture",
          reported: 120,
          surfaced: 50,
          adjusted: 0,
          withheld: [
            {
              reason: "over_tool_cap",
              count: 70,
              detail: "beyond the 50-finding cap for vulture, ranked by severity, novelty, and evidence",
              remediation: "Raise relevance.per_tool.vulture.max_findings in vibedoctor.yml, or run `vibedoctor scan --category <category>` to see the full set."
            }
          ]
        }
      ],
      totalReported: 124,
      totalSurfaced: 54,
      notes: ["vulture: showing 50 of 120 — withheld 70 beyond the 50-finding cap for vulture, ranked by severity, novelty, and evidence."]
    },
    suppressions: {
      file: ".vibedoctor/suppressions.yml",
      active: [],
      expired: [],
      invalid: [],
      permanent: [],
      hits: {},
      expiredHits: {},
      unused: [],
      resurfaced: 0
    },
    suppressedFindings: [],
    verifications: []
  };
}

async function readSnapshot(name: string): Promise<string> {
  return fs.readFile(path.join(process.cwd(), "tests", "snapshots", name), "utf8");
}

describe("reporters", () => {
  it("keeps JSON output stable", async () => {
    const scan = makeScan();
    expect(renderJsonReport(scan)).toBe(await readSnapshot("report.json"));
  });

  it("keeps terminal output stable", async () => {
    const scan = makeScan();
    expect(renderTerminalReport(scan)).toBe(`${await readSnapshot("terminal-report.txt")}\n`);
  });

  it("surfaces errored tool causes in reports", () => {
    const scan = makeScan();
    scan.toolStatuses.push({
      id: "vitest",
      status: "error",
      message: "MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8",
      command: "vitest run --coverage.enabled=true"
    });
    scan.capabilityMatrix = buildCapabilityMatrix(
      [
        ...scan.capabilityMatrix.tools,
        {
          id: "vitest",
          category: "tests",
          state: "failed",
          planned: true,
          applicable: true,
          discovered: true,
          executed: true,
          command: "vitest run --coverage.enabled=true",
          findingsReported: 0,
          findingsSurfaced: 0,
          reason: "MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8",
          remediation: "Run `vibedoctor tool retry vitest` to see the full output.",
          trust: "absent"
        }
      ],
      []
    );

    const json = JSON.parse(renderJsonReport(scan)) as ScanOutput;

    expect(json.toolStatuses).toContainEqual({
      id: "vitest",
      status: "error",
      message: "MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8",
      command: "vitest run --coverage.enabled=true"
    });
    expect(renderTerminalReport(scan)).toContain("MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8");
  });

  it("reports a tool that ran but had every finding filtered out as distinct from one that found nothing", () => {
    const scan = makeScan();
    const terminal = renderTerminalReport(scan);

    // The matrix must show 50 of 120, not a bare 50, so a capped tool is never
    // mistaken for a tool with nothing to report.
    expect(terminal).toContain("TOOL COVERAGE");
    expect(terminal).toContain("REPORT FILTERING");
    expect(terminal).toContain("showing 54 of 124 findings");
    expect(terminal).toContain("Raise relevance.per_tool.vulture.max_findings");
  });

  it("separates a timed-out tool from a completed one in the coverage table", () => {
    const scan = makeScan();
    const terminal = renderTerminalReport(scan);

    expect(terminal).toContain("semgrep");
    expect(terminal).toContain("timed out");
    expect(terminal).toContain("TO RESTORE COVERAGE");
    expect(terminal).toContain("Raise runtime.tool_timeouts.semgrep");
  });

  it("says so when a category-filtered report shows scan-wide filtering totals", () => {
    const scan = makeScan();
    const security = filterScanByCategories(scan, ["security"]);

    // The totals still describe the whole scan, because a withheld finding is no
    // longer available to attribute to a category. Saying which they cover keeps
    // "showing 54 of 124" from reading as a claim about security alone.
    expect(security.relevance.totalReported).toBe(scan.relevance.totalReported);
    expect(security.relevance.scopeNote).toContain("whole scan");
    expect(renderTerminalReport(security)).toContain("Counted across the whole scan");
  });
});
