import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCapabilityMatrix, renderCapabilityMatrixLines, type ToolCapability } from "../../src/core/capability";
import { normalizeFindings } from "../../src/core/findingNormalizer";
import { createFileRoleClassifier } from "../../src/core/fileRole";
import type { Finding } from "../../src/core/finding";
import { compareVersions, minimumSatisfying, parseVersion, satisfiesRange } from "../../src/core/semverLite";
import { getToolEntry, registryExecutables, TOOL_REGISTRY } from "../../src/core/toolRegistry";
import { isVerificationBlocking, probeRuntimes, verifyTool } from "../../src/core/toolVerification";

function makeCapability(overrides: Partial<ToolCapability> = {}): ToolCapability {
  return {
    id: "biome",
    category: "correctness",
    state: "completed",
    planned: true,
    applicable: true,
    discovered: true,
    executed: true,
    findingsReported: 0,
    findingsSurfaced: 0,
    reason: "Ran.",
    trust: "authoritative",
    ...overrides
  };
}

describe("semver ranges", () => {
  it("evaluates the range shapes engine fields actually use", () => {
    const node18 = parseVersion("18.20.4")!;
    const node20 = parseVersion("20.19.0")!;

    expect(satisfiesRange(node18, ">=20.19.0")).toBe(false);
    expect(satisfiesRange(node20, ">=20.19.0")).toBe(true);
    expect(satisfiesRange(node18, "^18.0.0")).toBe(true);
    expect(satisfiesRange(node20, "^18.0.0")).toBe(false);
    expect(satisfiesRange(node20, ">=18.0.0 <21.0.0")).toBe(true);
    expect(satisfiesRange(node18, ">=20.19.0 || >=22.12.0")).toBe(false);
    expect(satisfiesRange(node20, ">=20.19.0 || >=22.12.0")).toBe(true);
  });

  it("reports undefined rather than guessing on syntax it does not model", () => {
    expect(satisfiesRange(parseVersion("20.0.0")!, "next")).toBeUndefined();
  });

  it("treats an empty range as satisfied", () => {
    expect(satisfiesRange(parseVersion("1.0.0")!, undefined)).toBe(true);
  });

  it("names the lowest acceptable version for remediation messages", () => {
    expect(minimumSatisfying(">=20.19.0 || >=22.12.0")).toBe("20.19.0");
  });

  it("orders prereleases below their release", () => {
    expect(compareVersions(parseVersion("1.0.0-rc.1")!, parseVersion("1.0.0")!)).toBeLessThan(0);
  });
});

describe("tool registry", () => {
  it("gives every external tool a way to be verified", () => {
    for (const entry of TOOL_REGISTRY) {
      if (entry.ecosystem === "built-in") {
        continue;
      }
      expect(Boolean(entry.executable || entry.moduleProbe)).toBe(true);
    }
  });

  it("exposes every executable so availability probing covers the whole registry", () => {
    const executables = registryExecutables();
    for (const entry of TOOL_REGISTRY) {
      if (entry.executable) {
        expect(executables).toContain(entry.executable);
      }
    }
  });

  it("keeps ids aligned with the adapters that report findings", () => {
    for (const id of ["biome", "ruff", "gitleaks", "osv-scanner", "semgrep", "vulture", "knip", "coverage.py"]) {
      expect(getToolEntry(id)).toBeDefined();
    }
  });
});

describe("tool verification", () => {
  it("reports a missing tool as not found, with where it looked and how to fix it", async () => {
    const root = process.cwd();
    const verification = await verifyTool(
      {
        id: "definitely-not-installed",
        ecosystem: "manual",
        priority: "recommended",
        reason: "test",
        executable: "vibedoctor-nonexistent-tool",
        probeArgs: ["--version"]
      },
      { root, runtimes: {} }
    );

    expect(verification.state).toBe("not_found");
    expect(isVerificationBlocking(verification)).toBe(true);
    expect(verification.reason).toMatch(/was not found in any of the \d+ directories/);
    expect(verification.remediation).toBeTruthy();
  });

  it("refuses to claim a tool is installed when it cannot be proven", async () => {
    const verification = await verifyTool(
      { id: "opaque", ecosystem: "manual", priority: "recommended", reason: "test" },
      { root: process.cwd(), runtimes: {} }
    );

    expect(verification.state).toBe("unverifiable");
    // Unverifiable must not read as a pass, but it also must not block a scan.
    expect(isVerificationBlocking(verification)).toBe(false);
  });

  it("treats built-in checks as verified without looking for a binary", async () => {
    const verification = await verifyTool(
      { id: "custom-leftovers", ecosystem: "built-in", priority: "essential", reason: "test" },
      { root: process.cwd(), runtimes: {} }
    );

    expect(verification.state).toBe("verified");
    expect(verification.resolvedPath).toBeUndefined();
  });

  it("reports a runtime mismatch separately from a broken install", async () => {
    const runtimes = await probeRuntimes(process.cwd(), ["node"]);
    const verification = await verifyTool(
      {
        id: "needs-future-node",
        ecosystem: "npm",
        priority: "recommended",
        reason: "test",
        executable: "node",
        packageName: "vibedoctor-fake-package",
        probeArgs: ["--version"]
      },
      { root: process.cwd(), runtimes }
    );

    // No installed package means no declared requirement, so this must not
    // fabricate an incompatibility.
    expect(verification.runtime?.requirement).toBeUndefined();
    expect(verification.state).toBe("verified");
  });
});

describe("capability matrix", () => {
  it("counts deliberate exclusions as covered and real gaps as not", () => {
    const matrix = buildCapabilityMatrix(
      [
        makeCapability({ id: "biome", state: "completed" }),
        makeCapability({ id: "ruff", state: "not_applicable", trust: "authoritative" }),
        makeCapability({ id: "semgrep", state: "timed_out", trust: "absent" }),
        makeCapability({ id: "vulture", state: "partial", trust: "partial" })
      ],
      ["semgrep"]
    );

    expect(matrix.gaps).toEqual(["semgrep", "vulture"]);
    expect(matrix.requiredGaps).toEqual(["semgrep"]);
    expect(matrix.fullCoverage).toBe(false);
    expect(matrix.counts.completed).toBe(1);
    expect(matrix.counts.not_applicable).toBe(1);
  });

  it("shows surfaced and reported counts separately when they differ", () => {
    const matrix = buildCapabilityMatrix(
      [makeCapability({ id: "vulture", findingsReported: 120, findingsSurfaced: 50 })],
      []
    );

    const rendered = renderCapabilityMatrixLines(matrix).join("\n");
    expect(rendered).toContain("50 of 120");
  });

  it("lists remediation only for tools whose coverage is actually missing", () => {
    const matrix = buildCapabilityMatrix(
      [
        makeCapability({ id: "biome", state: "completed", remediation: "should not appear" }),
        makeCapability({ id: "semgrep", state: "timed_out", trust: "absent", remediation: "Raise the timeout." })
      ],
      []
    );

    const rendered = renderCapabilityMatrixLines(matrix).join("\n");
    expect(rendered).toContain("TO RESTORE COVERAGE");
    expect(rendered).toContain("Raise the timeout.");
    expect(rendered).not.toContain("should not appear");
  });
});

describe("finding normalization", () => {
  const classifyFile = createFileRoleClassifier();

  function makeFinding(overrides: Partial<Finding> = {}): Finding {
    return {
      id: "biome:1",
      source: "biome",
      category: "correctness",
      severity: "medium",
      confidence: "high",
      title: "lint/style/useConst",
      message: "Use const.",
      isNew: true,
      isAutofixable: true,
      safeToAutofix: true,
      tags: [],
      scoreImpact: 0,
      ...overrides
    };
  }

  it("recovers a line and column from a byte offset", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-normalize-"));
    try {
      const content = "const a = 1;\nlet b = 2;\nlet c = 3;\n";
      await fs.mkdir(path.join(root, "src"), { recursive: true });
      await fs.writeFile(path.join(root, "src", "a.ts"), content, "utf8");

      const offset = content.indexOf("let b");
      const result = await normalizeFindings(
        [makeFinding({ file: "src/a.ts", evidence: { startOffset: offset, endOffset: offset + 5 } })],
        { root, tool: "biome", classifyFile }
      );

      expect(result.findings[0].startLine).toBe(2);
      expect(result.findings[0].startColumn).toBe(1);
      expect(result.findings[0].locationQuality).toBe("exact");
      expect(result.locationLossRate).toBe(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("records the share of findings that arrived with no position", async () => {
    const result = await normalizeFindings(
      [makeFinding({ file: "src/a.ts" }), makeFinding({ id: "b", file: "src/a.ts", startLine: 4 })],
      { root: process.cwd(), tool: "biome", classifyFile }
    );

    expect(result.locationLossRate).toBe(0.5);
    expect(result.issues.find((issue) => issue.kind === "missing_location")).toBeDefined();
  });

  it("assigns an evidence grade per tool so a guess is not shown like a proof", async () => {
    const result = await normalizeFindings(
      [makeFinding({ source: "tsc" }), makeFinding({ id: "b", source: "vulture", category: "dead_code" })],
      { root: process.cwd(), tool: "mixed", classifyFile }
    );

    expect(result.findings[0].evidenceGrade).toBe("verified");
    expect(result.findings[1].evidenceGrade).toBe("heuristic");
  });

  it("repairs an out-of-range enum instead of letting it reach the report", async () => {
    const result = await normalizeFindings([makeFinding({ severity: "catastrophic" as Finding["severity"] })], {
      root: process.cwd(),
      tool: "biome",
      classifyFile
    });

    expect(result.findings[0].severity).toBe("medium");
    expect(result.issues.find((issue) => issue.kind === "invalid_enum")).toBeDefined();
  });

  it("marks findings in changed files so they can be prioritised", async () => {
    const result = await normalizeFindings([makeFinding({ file: "src/a.ts", startLine: 1 })], {
      root: process.cwd(),
      tool: "biome",
      classifyFile,
      changedFiles: ["src/a.ts"]
    });

    expect(result.findings[0].inChangedFile).toBe(true);
  });
});
