import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ScanOutput } from "../../src/core/engine";
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
        efficiency: 0,
        refactor_readiness: 2
      }
    },
    findings,
    topFindings: [findings[0]],
    blockers: [findings[0]],
    fixNext: [findings[0], findings[1], findings[3]],
    leftovers: [findings[2]],
    deadCodeCandidates: [findings[1]],
    refactorCandidates: [findings[3]],
    toolStatuses: [{ id: "gitleaks", status: "ok" }],
    skippedTools: [{ id: "semgrep", status: "skipped", installHint: "Install Semgrep" }],
    testCommands: ["npm test"],
    agentPlan: {
      goal: "Raise health score from 71 to 85",
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
    configPath: "D:\\repo\\vibedoctor.yml"
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

    const json = JSON.parse(renderJsonReport(scan)) as ScanOutput;

    expect(json.toolStatuses).toContainEqual({
      id: "vitest",
      status: "error",
      message: "MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8",
      command: "vitest run --coverage.enabled=true"
    });
    expect(renderTerminalReport(scan)).toContain("vitest — MISSING DEPENDENCY Cannot find dependency @vitest/coverage-v8");
  });
});
