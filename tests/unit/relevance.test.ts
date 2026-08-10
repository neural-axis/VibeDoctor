import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assessCredential, extractAssignedValue, shannonEntropy } from "../../src/core/credentialHeuristics";
import { createFileRoleClassifier } from "../../src/core/fileRole";
import type { Finding } from "../../src/core/finding";
import { applyRelevance, computePriority, defaultRelevanceConfig } from "../../src/core/relevance";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "test:1",
    source: "vulture",
    category: "dead_code",
    severity: "low",
    confidence: "medium",
    title: "Unused function",
    message: "helper appears unused.",
    file: "src/helper.py",
    startLine: 10,
    isNew: false,
    isAutofixable: false,
    safeToAutofix: false,
    tags: [],
    scoreImpact: 0,
    ...overrides
  };
}

async function withTempRepo(files: Record<string, string>, run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-relevance-"));
  try {
    for (const [file, content] of Object.entries(files)) {
      const target = path.join(root, file);
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, content, "utf8");
    }
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("credential heuristics", () => {
  it("treats short structured identifiers as names, not credentials", () => {
    for (const value of ["format_key", "renderer_key", "thread_key", "sessionId", "cache-key"]) {
      expect(assessCredential(value).verdict).toBe("identifier");
    }
  });

  it("treats high-entropy tokens and prefixed keys as credentials", () => {
    expect(assessCredential("sk-abc123DEF456ghi789JKL").verdict).toBe("credential");
    expect(assessCredential("AKIAIOSFODNN7EXAMPLE").verdict).toBe("credential");
    expect(assessCredential("Zt7Qx3Lm9Wv2Bn5Kj8Hf4Rd6Yc1Pa0Se").verdict).toBe("credential");
  });

  it("recognises placeholders and environment references", () => {
    for (const value of ["changeme", "your-api-key", "${API_TOKEN}", "process.env.SECRET", "<your token here>"]) {
      expect(assessCredential(value).verdict).toBe("placeholder");
    }
  });

  it("reports entropy so the verdict can be audited", () => {
    expect(shannonEntropy("aaaa")).toBe(0);
    expect(shannonEntropy("abcd")).toBeCloseTo(2, 5);
    expect(assessCredential("format_key").reason).toMatch(/identifier|words|entropy/i);
  });

  it("pulls the assigned value out of the shapes tools flag", () => {
    expect(extractAssignedValue('const formatKey = "format_key";')).toBe("format_key");
    expect(extractAssignedValue("API_TOKEN=sk-abc123DEF456ghi789")).toBe("sk-abc123DEF456ghi789");
    expect(extractAssignedValue('{ "thread_key": "thread_key" }')).toBe("thread_key");
  });
});

describe("file role classification", () => {
  const classify = createFileRoleClassifier();

  it("separates fixtures, tests, generated code, and real source", () => {
    expect(classify("fixtures/sample/app.ts")).toBe("fixture");
    expect(classify("src/__fixtures__/user.json")).toBe("fixture");
    expect(classify("src/__tests__/auth.test.ts")).toBe("test");
    expect(classify("tests/unit/auth.test.ts")).toBe("test");
    expect(classify("src/api/client.generated.ts")).toBe("generated");
    expect(classify("vendor/lib/thing.js")).toBe("vendor");
    expect(classify("src/auth.ts")).toBe("source");
  });

  it("lets a repository correct a misclassification without losing the defaults", () => {
    const custom = createFileRoleClassifier({ source: ["fixtures/real/**"] });
    expect(custom("fixtures/real/app.ts")).toBe("source");
    expect(custom("fixtures/other/app.ts")).toBe("fixture");
  });
});

describe("relevance filtering", () => {
  it("downgrades a secret finding whose matched value is an identifier", async () => {
    await withTempRepo({ "src/render.ts": 'const formatKey = "format_key";\n' }, async (root) => {
      const result = await applyRelevance(
        [
          makeFinding({
            source: "gitleaks",
            category: "security",
            severity: "critical",
            confidence: "high",
            title: "generic-api-key",
            message: "Potential secret detected.",
            file: "src/render.ts",
            startLine: 1,
            tags: ["security", "secret"]
          })
        ],
        { root, config: defaultRelevanceConfig }
      );

      const finding = result.findings[0];
      expect(finding.severity).not.toBe("critical");
      expect(finding.confidence).toBe("low");
      expect(finding.tags).toContain("likely-false-positive");
      expect(finding.evidence?.reviewState).toBe("false_positive");
      expect(finding.remediation?.kind).toBe("human_review");
      expect(result.report.perTool.find((tool) => tool.tool === "gitleaks")?.adjusted).toBe(1);
    });
  });

  it("leaves a genuine credential at full severity and records why", async () => {
    await withTempRepo({ "src/config.ts": 'const key = "sk-9dK2mQ7pR4xZ1vB8nL3jH6gF5tY0wC";\n' }, async (root) => {
      const result = await applyRelevance(
        [
          makeFinding({
            source: "gitleaks",
            category: "security",
            severity: "critical",
            confidence: "high",
            title: "generic-api-key",
            file: "src/config.ts",
            startLine: 1,
            tags: ["security", "secret"]
          })
        ],
        { root, config: defaultRelevanceConfig }
      );

      expect(result.findings[0].severity).toBe("critical");
      expect(result.findings[0].evidenceGrade).toBe("verified");
      expect(result.findings[0].evidence?.rationale).toMatch(/credential/i);
    });
  });

  it("caps a noisy tool by rank and discloses exactly what it withheld", async () => {
    await withTempRepo({}, async (root) => {
      const findings = Array.from({ length: 120 }, (_, index) =>
        makeFinding({
          id: `vulture:${index}`,
          confidence: "high",
          severity: index === 0 ? "high" : "low",
          startLine: index + 1,
          isNew: index === 0
        })
      );

      const result = await applyRelevance(findings, {
        root,
        config: { ...defaultRelevanceConfig, perTool: { vulture: { maxFindings: 10 } } }
      });

      expect(result.findings).toHaveLength(10);
      // The one high-severity, new finding must survive the cap.
      expect(result.findings[0].severity).toBe("high");

      const vulture = result.report.perTool.find((tool) => tool.tool === "vulture");
      expect(vulture?.reported).toBe(120);
      expect(vulture?.surfaced).toBe(10);
      expect(vulture?.withheld.find((group) => group.reason === "over_tool_cap")?.count).toBe(110);
      expect(result.report.notes.join(" ")).toContain("showing 10 of 120");
    });
  });

  it("applies a per-tool confidence floor and says how to lower it", async () => {
    await withTempRepo({}, async (root) => {
      const result = await applyRelevance(
        [makeFinding({ confidence: "low" }), makeFinding({ id: "keep", confidence: "high" })],
        { root, config: { ...defaultRelevanceConfig, perTool: { vulture: { minConfidence: "medium" } } } }
      );

      expect(result.findings).toHaveLength(1);
      const withheld = result.report.perTool[0].withheld[0];
      expect(withheld.reason).toBe("below_confidence_floor");
      expect(withheld.remediation).toContain("relevance.per_tool.vulture.min_confidence");
    });
  });

  it("downgrades rather than hides findings in fixtures by default", async () => {
    await withTempRepo({}, async (root) => {
      const result = await applyRelevance(
        [
          makeFinding({
            source: "gitleaks",
            category: "security",
            severity: "critical",
            file: "fixtures/demo/config.ts",
            fileRole: "fixture",
            tags: ["security"]
          })
        ],
        { root, config: { ...defaultRelevanceConfig, validateSecrets: false } }
      );

      expect(result.findings).toHaveLength(1);
      expect(result.findings[0].severity).toBe("high");
      expect(result.findings[0].tags).toContain("role:fixture");
    });
  });

  it("keeps every finding when filtering is turned off, and says so", async () => {
    await withTempRepo({}, async (root) => {
      const findings = Array.from({ length: 5 }, (_, index) => makeFinding({ id: `f${index}`, confidence: "low" }));
      const result = await applyRelevance(findings, {
        root,
        config: { ...defaultRelevanceConfig, enabled: false, minConfidence: "high" }
      });

      expect(result.findings).toHaveLength(5);
      expect(result.report.notes[0]).toContain("disabled");
    });
  });
});

describe("priority ranking", () => {
  it("puts a new finding in changed code above an older, more severe one", () => {
    const newInChangedCode = computePriority(makeFinding({ severity: "medium", isNew: true, inChangedFile: true }));
    const olderMoreSevere = computePriority(makeFinding({ severity: "high", isNew: false, inChangedFile: false }));
    expect(newInChangedCode).toBeGreaterThan(olderMoreSevere);
  });

  it("rewards corroboration between tools", () => {
    const corroborated = computePriority(makeFinding({ corroboratedBy: ["knip"] }));
    const alone = computePriority(makeFinding());
    expect(corroborated).toBeGreaterThan(alone);
  });

  it("demotes findings a reviewer already rejected", () => {
    const rejected = computePriority(makeFinding({ evidence: { reviewState: "false_positive" } }));
    expect(rejected).toBeLessThan(computePriority(makeFinding()));
  });
});
