import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { Finding } from "../../src/core/finding";
import { fingerprintFinding } from "../../src/core/finding";
import { applySuppressions, loadSuppressions, renderSuppressionLines } from "../../src/core/suppressions";

function makeFinding(overrides: Partial<Finding> = {}): Finding {
  return {
    id: "gitleaks:1",
    source: "gitleaks",
    category: "security",
    severity: "critical",
    confidence: "high",
    title: "generic-api-key",
    message: "Potential secret detected.",
    file: "fixtures/demo/config.ts",
    startLine: 3,
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    tags: ["security", "secret"],
    scoreImpact: 0,
    ...overrides
  };
}

async function withSuppressionsFile(content: string, run: (root: string) => Promise<void>): Promise<void> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-suppress-"));
  try {
    const target = path.join(root, ".vibedoctor", "suppressions.yml");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, content, "utf8");
    await run(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

describe("suppressions", () => {
  it("hides findings a rule acknowledges and records the rationale", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: fixture-credentials
    reason: Synthetic credentials in test fixtures, never used against real systems.
    classification: fixture
    owner: platform-team
    expires: 2999-12-31
    match:
      tools: [gitleaks]
      paths: ["fixtures/**"]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([makeFinding(), makeFinding({ id: "keep", file: "src/config.ts" })], loaded);

        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].file).toBe("src/config.ts");
        expect(result.suppressed[0].suppression?.ruleId).toBe("fixture-credentials");
        expect(result.suppressed[0].suppression?.reason).toContain("Synthetic credentials");
        expect(result.report.hits["fixture-credentials"]).toBe(1);
      }
    );
  });

  it("stops hiding findings once the acknowledgement expires, and marks them resurfaced", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: temporary-waiver
    reason: Accepted until the Q1 credential rotation lands.
    classification: accepted_risk
    expires: 2020-01-01
    match:
      tools: [gitleaks]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([makeFinding()], loaded);

        expect(result.suppressed).toHaveLength(0);
        expect(result.findings).toHaveLength(1);
        expect(result.findings[0].baselineState).toBe("resurfaced");
        expect(result.findings[0].suppression?.expired).toBe(true);
        expect(result.findings[0].message).toContain("expired 2020-01-01");
        expect(result.report.resurfaced).toBe(1);
        expect(renderSuppressionLines(result.report).join("\n")).toContain("Expired acknowledgements");
      }
    );
  });

  it("rejects an acknowledgement with no stated reason instead of applying it", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: no-reason
    classification: false_positive
    match:
      tools: [gitleaks]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        expect(loaded.rules).toHaveLength(0);
        expect(loaded.invalid[0].problem).toMatch(/reason of at least/i);

        const result = applySuppressions([makeFinding()], loaded);
        expect(result.findings).toHaveLength(1);
        expect(renderSuppressionLines(result.report).join("\n")).toContain("Rejected acknowledgements");
      }
    );
  });

  it("rejects a rule with no match criteria so it cannot silence the whole report", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: catch-all
    reason: We looked at all of these already and they are fine.
    classification: accepted_risk
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        expect(loaded.rules).toHaveLength(0);
        expect(loaded.invalid[0].problem).toMatch(/at least one match criterion/i);
      }
    );
  });

  it("pins a single finding by fingerprint", async () => {
    const finding = makeFinding({ file: "src/config.ts" });
    const fingerprint = fingerprintFinding(finding);

    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: pinned
    reason: Reviewed on 2026-01-10 and confirmed to be a cache key.
    classification: false_positive
    match:
      fingerprints: ["${fingerprint}"]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([finding, makeFinding({ id: "other", startLine: 99 })], loaded);

        expect(result.suppressed).toHaveLength(1);
        expect(result.findings).toHaveLength(1);
      }
    );
  });

  it("reports acknowledgements that never expire and ones that matched nothing", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: forever
    reason: Vendored code we do not control and do not ship.
    classification: accepted_risk
    match:
      paths: ["vendor/**"]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([makeFinding()], loaded);

        expect(result.report.permanent).toContain("forever");
        expect(result.report.unused).toContain("forever");
        const rendered = renderSuppressionLines(result.report).join("\n");
        expect(rendered).toContain("Permanent acknowledgements");
        expect(rendered).toContain("matched nothing");
      }
    );
  });

  it("does not count an expired acknowledgement as having suppressed anything", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: lapsed
    reason: Accepted until the rotation that has since happened.
    classification: accepted_risk
    expires: 2020-01-01
    match:
      tools: [gitleaks]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([makeFinding()], loaded);

        // The finding is shown, so claiming it was suppressed contradicts the
        // rest of the report.
        expect(result.report.hits).toEqual({});
        expect(result.report.expiredHits.lapsed).toBe(1);
        const rendered = renderSuppressionLines(result.report).join("\n");
        expect(rendered).not.toContain("Suppressed:");
        expect(rendered).toContain("1 finding(s) shown again");
        // A rule that matched is in use, even though it no longer hides anything.
        expect(result.report.unused).not.toContain("lapsed");
      }
    );
  });

  it("rejects an acknowledgement with no expiry when the config requires one", async () => {
    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: forever
    reason: We accept these and never wrote down for how long.
    classification: accepted_risk
    match:
      tools: [gitleaks]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);

        const permitted = applySuppressions([makeFinding()], loaded);
        expect(permitted.suppressed).toHaveLength(1);

        const required = applySuppressions([makeFinding()], loaded, { requireExpiry: true });
        expect(required.suppressed).toHaveLength(0);
        expect(required.findings).toHaveLength(1);
        expect(required.report.invalid[0]).toMatchObject({ id: "forever" });
        expect(required.report.invalid[0].problem).toMatch(/expiry date is required/i);
        expect(required.report.permanent).toEqual([]);
      }
    );
  });

  it("narrows rather than widens when a fingerprint is combined with another criterion", async () => {
    const finding = makeFinding({ file: "src/config.ts" });
    const fingerprint = fingerprintFinding(finding);

    await withSuppressionsFile(
      `version: 1
suppressions:
  - id: pinned-in-vendor
    reason: Reviewed on 2026-01-10 and scoped deliberately to vendored code.
    classification: fixture
    match:
      fingerprints: ["${fingerprint}"]
      paths: ["vendor/**"]
`,
      async (root) => {
        const loaded = await loadSuppressions(root);
        const result = applySuppressions([finding], loaded);

        // The fingerprint matches, but the declared path scope does not, and the
        // rule says both. Honouring the fingerprint alone would let a stale or
        // colliding one suppress a finding outside the intended scope.
        expect(result.suppressed).toHaveLength(0);
        expect(result.findings).toHaveLength(1);
        expect(result.report.unused).toContain("pinned-in-vendor");
      }
    );
  });

  it("treats a missing suppressions file as no acknowledgements rather than an error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-suppress-empty-"));
    try {
      const loaded = await loadSuppressions(root);
      expect(loaded.rules).toHaveLength(0);
      expect(loaded.invalid).toHaveLength(0);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});
