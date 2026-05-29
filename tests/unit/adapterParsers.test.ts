import { describe, expect, it } from "vitest";
import { gitleaksAdapter } from "../../src/adapters/gitleaks";
import { tscAdapter } from "../../src/adapters/tsc";
import { vultureAdapter } from "../../src/adapters/vulture";
import type { ToolAdapterContext } from "../../src/adapters/shared";
import type { ToolResult } from "../../src/core/toolRunner";

const ctx: ToolAdapterContext = {
  root: "D:\\repo",
  project: {
    root: "D:\\repo",
    languages: ["python", "typescript"],
    packageManagers: [],
    hasGit: false,
    changedFiles: [],
    configFiles: [],
    lockfiles: [],
    testCommands: [],
    toolsAvailable: {},
    frameworkHints: [],
    entryFiles: [],
    projectFiles: []
  },
  config: {} as ToolAdapterContext["config"],
  scanMode: "default"
};

function toolResult(stdout: string, stderr = "", exitCode = 1): ToolResult {
  return {
    command: "tool",
    stdout,
    stderr,
    exitCode,
    durationMs: 1,
    status: exitCode === 0 ? "ok" : "error"
  };
}

describe("adapter parsing", () => {
  it("maps gitleaks findings to critical security issues", () => {
    const findings = gitleaksAdapter.parseResult!(
      toolResult('[{"RuleID":"generic-api-key","Description":"Potential secret","File":"src/config.ts","StartLine":12,"Match":"token=abc"}]'),
      ctx
    );

    expect(findings[0].severity).toBe("critical");
    expect(findings[0].category).toBe("security");
  });

  it("maps tsc output to correctness findings", () => {
    const findings = tscAdapter.parseResult!(
      toolResult("", "src/app.ts(4,10): error TS2322: Type 'number' is not assignable to type 'string'."),
      ctx
    );

    expect(findings[0].source).toBe("tsc");
    expect(findings[0].category).toBe("correctness");
  });

  it("keeps vulture results non-autodeletable", () => {
    const findings = vultureAdapter.parseResult!(
      toolResult('[{"filename":"app.py","first_lineno":8,"name":"old_auth","type":"function","confidence":60}]'),
      ctx
    );

    expect(findings[0].safeToAutofix).toBe(false);
    expect(findings[0].confidence).toBe("low");
  });

  it("marks __init__.py vulture results as review-only", () => {
    const findings = vultureAdapter.parseResult!(
      toolResult('[{"filename":"pkg/__init__.py","first_lineno":1,"name":"exported","type":"variable","confidence":100}]'),
      ctx
    );

    expect(findings[0].confidence).toBe("low");
    expect(findings[0].title).toContain("Review package initializer");
    expect(findings[0].tags).toContain("review-only");
    expect(findings[0].safeToAutofix).toBe(false);
  });
});
