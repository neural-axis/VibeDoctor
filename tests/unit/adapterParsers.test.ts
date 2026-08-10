import { describe, expect, it } from "vitest";
import { biomeAdapter } from "../../src/adapters/biome";
import { gitleaksAdapter } from "../../src/adapters/gitleaks";
import { knipAdapter } from "../../src/adapters/knip";
import { lizardAdapter } from "../../src/adapters/lizard";
import { osvScannerAdapter } from "../../src/adapters/osvScanner";
import { buildJscpdArgs } from "../../src/adapters/jscpd";
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
      toolResult("app.py:8: unused function 'old_auth' (60% confidence)"),
      ctx
    );

    expect(findings[0].safeToAutofix).toBe(false);
    expect(findings[0].confidence).toBe("low");
  });

  it("marks __init__.py vulture results as review-only", () => {
    const findings = vultureAdapter.parseResult!(
      toolResult("pkg/__init__.py:1: unused variable 'exported' (100% confidence)"),
      ctx
    );

    expect(findings[0].confidence).toBe("low");
    expect(findings[0].title).toContain("Review package initializer");
    expect(findings[0].tags).toContain("review-only");
    expect(findings[0].safeToAutofix).toBe(false);
  });

  it("passes configured excludes through to jscpd", () => {
    const args = buildJscpdArgs("out", [".agents/**", "ops/**", "**/*.test.*", "**/__tests__/**"]);

    expect(args).toContain("--min-lines");
    expect(args).toContain("30");
    expect(args).toContain("--ignore");
    expect(args).toContain(".agents/**,ops/**,**/*.test.*,**/__tests__/**");
  });

  it("parses current Lizard CSV output", () => {
    const parserContext = {
      ...ctx,
      config: { checks: { refactorReadiness: { minComplexity: 12 } } } as ToolAdapterContext["config"]
    };
    const findings = lizardAdapter.parseResult!(
      toolResult('35,12,333,1,40,"normalizeRawConfig@258-297@src/core/config.ts","src/core/config.ts","normalizeRawConfig","normalizeRawConfig ( raw )",258,297', "", 0),
      parserContext
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].source).toBe("lizard");
    expect(findings[0].startLine).toBe(258);
  });

  it("builds OSV-Scanner v2 lockfile arguments and parses findings", () => {
    const command = osvScannerAdapter.buildScanCommand!({
      ...ctx,
      project: { ...ctx.project, lockfiles: ["package-lock.json"] }
    });
    expect(command.args).toEqual([
      "scan", "source", "--lockfile", "package-lock.json", "--format", "json", "--verbosity", "error"
    ]);

    const findings = osvScannerAdapter.parseResult!(
      toolResult('{"results":[{"packages":[{"package":{"name":"vite"},"vulnerabilities":[{"id":"GHSA-test","summary":"Test advisory","severity":[{"score":"9.8"}]}]}]}]}'),
      ctx
    );
    expect(findings[0].title).toBe("GHSA-test");
  });

  it("reads locations from the Biome reporter's current shape", () => {
    const findings = biomeAdapter.parseResult!(
      toolResult(
        JSON.stringify({
          diagnostics: [
            {
              severity: "error",
              message: "Use const instead of let.",
              category: "lint/style/useConst",
              location: { path: "src/app.ts", start: { line: 41, column: 6 }, end: { line: 41, column: 9 } }
            }
          ]
        })
      ),
      ctx
    );

    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/app.ts");
    // Biome counts lines from zero; reports and editors count from one.
    expect(findings[0].startLine).toBe(42);
    expect(findings[0].startColumn).toBe(7);
    expect(findings[0].message).toBe("Use const instead of let.");
    expect(findings[0].title).toBe("lint/style/useConst");
  });

  it("recovers Biome output containing unescaped Windows path separators", () => {
    // Biome writes `"src\core\finding.ts"` into JSON, which is not valid JSON.
    // Parsing used to throw and the whole check silently reported nothing.
    const raw = '{"diagnostics":[{"severity":"error","message":"Formatter would have printed different content.","category":"format","location":{"path":"src\\core\\finding.ts","start":{"line":0,"column":0}}}]}';

    expect(() => JSON.parse(raw)).toThrow();

    const findings = biomeAdapter.parseResult!(toolResult(raw), ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe("src/core/finding.ts");
    expect(findings[0].startLine).toBe(1);
  });

  it("still reads the older Biome span shape and hands offsets to the normalizer", () => {
    const findings = biomeAdapter.parseResult!(
      toolResult(
        JSON.stringify({
          diagnostics: [
            {
              severity: "warn",
              description: "Older reporter field.",
              category: "lint/suspicious/noExplicitAny",
              location: { path: { file: "src/old.ts" }, span: [120, 130] }
            }
          ]
        })
      ),
      ctx
    );

    expect(findings[0].file).toBe("src/old.ts");
    expect(findings[0].message).toBe("Older reporter field.");
    expect(findings[0].evidence?.startOffset).toBe(120);
    // Rules that can change behaviour are not offered as safe autofixes.
    expect(findings[0].safeToAutofix).toBe(false);
  });

  it("classifies dependency advisories by runtime exposure and names the fix version", () => {
    const report = {
      results: [
        {
          source: { path: "package-lock.json" },
          packages: [
            {
              package: { name: "vite", version: "5.0.0", ecosystem: "npm" },
              vulnerabilities: [
                {
                  id: "GHSA-dev",
                  summary: "Dev server flaw",
                  severity: [{ score: "9.8" }],
                  affected: [{ ranges: [{ events: [{ introduced: "0" }, { fixed: "5.4.6" }] }] }]
                }
              ]
            },
            {
              package: { name: "pdf-render", version: "1.2.0", ecosystem: "npm" },
              vulnerabilities: [{ id: "GHSA-runtime", summary: "Parser flaw", severity: [{ score: "9.8" }] }]
            }
          ]
        }
      ]
    };

    const findings = osvScannerAdapter.parseResult!(toolResult(JSON.stringify(report)), {
      ...ctx,
      project: {
        ...ctx.project,
        declaredDependencies: { runtime: ["pdf-render"], dev: ["vite"], optional: [] }
      }
    });

    const dev = findings.find((finding) => finding.title === "GHSA-dev")!;
    const runtime = findings.find((finding) => finding.title === "GHSA-runtime")!;

    expect(dev.package?.scope).toBe("dev");
    expect(dev.package?.fixedIn).toBe("5.4.6");
    expect(dev.message).toContain("Fixed in 5.4.6");
    expect(runtime.package?.scope).toBe("runtime");

    // The same CVSS score must not read the same when only one of them ships.
    expect(runtime.severity).toBe("critical");
    expect(dev.severity).not.toBe("critical");
    expect(dev.evidence?.reasons?.join(" ")).toContain("does not ship to production");
    expect(runtime.remediation?.kind).toBe("dependency");
  });

  it("marks knip Node version incompatibility output as skipped", () => {
    const result = toolResult("", "TypeError: util.styleText is not a function", 1);
    const findings = knipAdapter.parseResult!(result, ctx);

    expect(findings).toHaveLength(0);
    expect(result.status).toBe("skipped");
    expect(result.installHint).toContain("Node >= 20.19");
  });

  it("marks tsc CLI help output (missing tsconfig) as skipped even with a successful exit", () => {
    const result = toolResult("", "Syntax: tsc [options] [file ...]\nOptions:\n --help", 0);
    const findings = tscAdapter.parseResult!(result, ctx);

    expect(findings).toHaveLength(0);
    expect(result.status).toBe("skipped");
  });
});
