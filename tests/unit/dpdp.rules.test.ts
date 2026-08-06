import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import YAML from "yaml";
import { runDpdpScan } from "../../src/dpdp/scan";
import type { ControlStatus } from "../../src/dpdp/types";

type RuleCase = {
  controlId: string;
  kind: "positive" | "negative";
  /** Optional unique id for extra positive variants (e.g. multiline). */
  id?: string;
  files: Record<string, string>;
  expectedStatus: ControlStatus | ControlStatus[];
  rawPiiSamples?: string[];
};

const RULES_ROOT = path.join(process.cwd(), "fixtures", "dpdp", "rules");

const VIBEDOCTOR_YML = {
  version: 1,
  baseline: { enabled: false },
  paths: { include: ["src/**"] },
  checks: {
    security: { enabled: false },
    correctness: { enabled: false },
    deadCode: { enabled: false },
    leftovers: { enabled: false },
    refactorReadiness: { enabled: false },
    tests: { enabled: false },
    dependencies: { enabled: false },
    privacy: {
      enabled: true,
      minConfidenceToReport: "low",
      maskExamples: true,
      presidio: { enabled: false }
    },
    dpdp: {
      enabled: true,
      minConfidenceToReport: "low",
      maskExamples: true,
      usePresidio: false,
      useSemgrep: false
    }
  }
};

async function loadCases(): Promise<RuleCase[]> {
  const raw = await fs.readFile(path.join(RULES_ROOT, "cases.json"), "utf8");
  return JSON.parse(raw) as RuleCase[];
}

async function materializeCase(ruleCase: RuleCase): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), `vibedoctor-dpdp-rule-${ruleCase.controlId}-`));
  await fs.mkdir(path.join(root, "src"), { recursive: true });
  await fs.writeFile(path.join(root, "vibedoctor.yml"), YAML.stringify(VIBEDOCTOR_YML), "utf8");

  for (const [relativeOut, relativeSource] of Object.entries(ruleCase.files)) {
    const sourcePath = path.join(RULES_ROOT, relativeSource);
    const targetPath = path.join(root, relativeOut);
    await fs.mkdir(path.dirname(targetPath), { recursive: true });
    await fs.copyFile(sourcePath, targetPath);
  }

  return root;
}

function statusMatches(actual: ControlStatus | undefined, expected: ControlStatus | ControlStatus[]): boolean {
  if (!actual) {
    return false;
  }
  return Array.isArray(expected) ? expected.includes(actual) : actual === expected;
}

describe("DPDP deterministic rule fixtures", () => {
  it("registers paired positive/negative cases for priority controls", async () => {
    const cases = await loadCases();
    expect(cases.length).toBeGreaterThanOrEqual(20);

    const byControl = new Map<string, Set<string>>();
    for (const item of cases) {
      const kinds = byControl.get(item.controlId) ?? new Set<string>();
      kinds.add(item.kind);
      byControl.set(item.controlId, kinds);
    }

    for (const [controlId, kinds] of byControl) {
      expect(kinds.has("positive"), `${controlId} missing positive`).toBe(true);
      expect(kinds.has("negative"), `${controlId} missing negative`).toBe(true);
    }
  });

  it("evaluates every registered rule case", async () => {
    const cases = await loadCases();

    for (const ruleCase of cases) {
      const label = ruleCase.id ?? `${ruleCase.controlId} ${ruleCase.kind}`;
      const root = await materializeCase(ruleCase);
      const result = await runDpdpScan(root, "full");
      const control = result.controlMatrix.controls.find((item) => item.controlId === ruleCase.controlId);

      expect(control, `${label}: control missing`).toBeTruthy();
      expect(
        statusMatches(control?.status, ruleCase.expectedStatus),
        `${label}: expected ${JSON.stringify(ruleCase.expectedStatus)}, got ${control?.status}`
      ).toBe(true);

      const blob = JSON.stringify(result);
      // Always fail-closed for common literal patterns used in fixtures
      expect(blob).not.toMatch(/demo@example\.com/i);
      expect(blob).not.toMatch(/\bABCDE1234F\b/);
      expect(blob).not.toMatch(/2345\s*6789\s*0124/);

      if (ruleCase.kind === "positive" && ruleCase.rawPiiSamples) {
        for (const sample of ruleCase.rawPiiSamples) {
          // Samples may be field paths; ensure raw email/pan-style values never leak
          if (/@/.test(sample) || /^[A-Z]{5}\d{4}[A-Z]$/.test(sample)) {
            expect(blob).not.toContain(sample);
          }
        }
      }
    }
  }, 120_000);
});
