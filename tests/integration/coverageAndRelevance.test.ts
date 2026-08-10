import { promises as fs } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { runScanCommand } from "../../src/cli/commands/scan";
import { createTempFixtureCopy } from "../helpers";

/**
 * These cover the promises the report makes about itself: that it says which
 * tools ran, that it never presents a filtered list as a complete one, and that
 * an acknowledged finding is hidden for a stated reason with a stated expiry.
 */

// Every category the assertions do not need is off: these scans run several
// times, and leaving Semgrep on makes the suite an order of magnitude slower
// without changing what is being tested.
const BASE_CONFIG = `version: 1
checks:
  security: { enabled: false }
  correctness: { enabled: false }
  deadCode: { enabled: false }
  leftovers: { enabled: true }
  refactor_readiness: { enabled: false }
  tests: { enabled: false }
  dependencies: { enabled: false }
  privacy: { enabled: false }
  dpdp: { enabled: false }
`;

async function writeConfig(root: string, extra = ""): Promise<void> {
  await fs.writeFile(path.join(root, "vibedoctor.yml"), `${BASE_CONFIG}${extra}`, "utf8");
}

async function writeSuppressions(root: string, content: string): Promise<void> {
  const target = path.join(root, ".vibedoctor", "suppressions.yml");
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

describe("scan coverage and relevance reporting", () => {
  it(
    "reports a state, reason, and finding counts for every tool it considered",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(root);

      const scan = await runScan(root, "full");
      expect(scan.capabilityMatrix.tools.length).toBeGreaterThan(0);

      for (const tool of scan.capabilityMatrix.tools) {
        // A row with no reason is the failure this table exists to prevent.
        expect(tool.reason.length).toBeGreaterThan(0);
        expect(tool.findingsSurfaced).toBeLessThanOrEqual(tool.findingsReported);
      }

      // Tools turned off in config are deliberate, so they are not coverage gaps.
      const disabled = scan.capabilityMatrix.tools.filter((tool) => tool.state === "disabled");
      expect(disabled.length).toBeGreaterThan(0);
      for (const tool of disabled) {
        expect(scan.capabilityMatrix.gaps).not.toContain(tool.id);
        expect(tool.reason).toContain("Turned off in config");
      }

      // Anything that did not run has somewhere to go next.
      for (const id of scan.capabilityMatrix.gaps) {
        const tool = scan.capabilityMatrix.tools.find((candidate) => candidate.id === id)!;
        expect(tool.remediation).toBeTruthy();
      }
    },
    120_000
  );

  it(
    "carries the coverage table, filtering, and acknowledgements into the JSON report",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(root);

      const command = await runScanCommand(root, { full: true, report: "json" });
      const json = JSON.parse(command.output) as {
        capabilityMatrix?: { tools?: unknown[] };
        relevance?: { totalReported?: number; totalSurfaced?: number };
        suppressions?: { file?: string };
        verifications?: unknown[];
      };

      expect(json.capabilityMatrix?.tools?.length).toBeGreaterThan(0);
      expect(json.relevance?.totalReported).toBeGreaterThanOrEqual(json.relevance?.totalSurfaced ?? 0);
      expect(json.suppressions?.file).toBeTruthy();
      expect(Array.isArray(json.verifications)).toBe(true);
    },
    120_000
  );

  it(
    "hides an acknowledged finding, keeps its rationale, and counts it in the report",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(root);

      const before = await runScan(root, "full");
      const target = before.findings.find((finding) => finding.category === "leftovers");
      expect(target).toBeDefined();

      await writeSuppressions(
        root,
        `version: 1
suppressions:
  - id: known-leftovers
    reason: Reviewed on 2026-02-01; these markers are tracked in the migration ticket.
    classification: deferred
    owner: platform-team
    expires: 2999-01-01
    match:
      categories: [leftovers]
`
      );

      const after = await runScan(root, "full");
      expect(after.findings.some((finding) => finding.category === "leftovers")).toBe(false);
      expect(after.suppressedFindings.length).toBeGreaterThan(0);
      expect(after.suppressions.hits["known-leftovers"]).toBeGreaterThan(0);
      expect(after.suppressedFindings[0].suppression?.reason).toContain("migration ticket");
    },
    180_000
  );

  it(
    "brings a finding back once its acknowledgement expires",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(root);
      await writeSuppressions(
        root,
        `version: 1
suppressions:
  - id: lapsed
    reason: Accepted until the cleanup sprint that has since finished.
    classification: accepted_risk
    expires: 2020-01-01
    match:
      categories: [leftovers]
`
      );

      const scan = await runScan(root, "full");
      const resurfaced = scan.findings.filter((finding) => finding.baselineState === "resurfaced");

      expect(resurfaced.length).toBeGreaterThan(0);
      expect(scan.suppressions.resurfaced).toBe(resurfaced.length);
      expect(resurfaced[0].message).toContain("expired 2020-01-01");
    },
    180_000
  );

  it(
    "discloses what a per-tool cap withheld instead of silently shortening the list",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(
        root,
        `
relevance:
  max_findings_per_tool: 1
`
      );

      const scan = await runScan(root, "full");
      const leftovers = scan.relevance.perTool.find((tool) => tool.tool === "custom-leftovers");

      expect(leftovers).toBeDefined();
      expect(leftovers!.surfaced).toBeLessThanOrEqual(1);
      expect(leftovers!.reported).toBeGreaterThan(leftovers!.surfaced);
      expect(leftovers!.withheld.some((group) => group.reason === "over_tool_cap")).toBe(true);
      expect(scan.relevance.notes.join(" ")).toContain("custom-leftovers");
    },
    120_000
  );

  it(
    "records where each tool was resolved, so the report can prove what ran",
    async () => {
      const root = await createTempFixtureCopy("leftovers");
      await writeConfig(root);

      const scan = await runScan(root, "full");
      const executed = scan.capabilityMatrix.tools.filter((tool) => tool.state === "completed" && tool.command);

      for (const tool of executed) {
        expect(tool.resolvedPath).toBeTruthy();
      }
    },
    120_000
  );
});
