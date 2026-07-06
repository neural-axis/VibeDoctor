import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runScanCommand } from "../../src/cli/commands/scan";
import { isValidAadhaar, maskPiiValue, passesLuhn } from "../../src/adapters/privacyDetector";
import { runScan } from "../../src/core/engine";
import { createTempFixtureCopy } from "../helpers";

describe("privacy detector", () => {
  it("validates and masks common identifier formats", () => {
    expect(passesLuhn("4111 1111 1111 1111")).toBe(true);
    expect(passesLuhn("4111 1111 1111 1112")).toBe(false);
    expect(isValidAadhaar("2345 6789 0124")).toBe(true);
    expect(isValidAadhaar("2345 6789 0123")).toBe(false);
    expect(maskPiiValue("rohit.sharma@example.com", "email")).toBe("ro***@example.com");
    expect(maskPiiValue("ABCDE1234F", "pan")).toBe("A****1234*");
    expect(maskPiiValue("2345 6789 0124", "aadhaar")).toBe("********0124");
  });

  it("detects Privacy Review findings and stores masked evidence", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const scan = await runScan(root, "full");

    expect(scan.privacyFindings.length).toBeGreaterThan(0);
    expect(scan.privacyFindings.every((finding) => finding.source === "privacy-detector")).toBe(true);
    expect(scan.privacyFindings.some((finding) => finding.evidence?.entityType === "pan")).toBe(true);
    expect(scan.privacyFindings.some((finding) => finding.evidence?.entityType === "combination_risk")).toBe(true);

    const serialized = JSON.stringify(scan.privacyFindings);
    expect(serialized).not.toContain("ABCDE1234F");
    expect(serialized).not.toContain("rohit.sharma@example.com");
    expect(serialized).toContain("A****1234*");
  });

  it("supports privacy category filtering from the scan command", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const result = await runScanCommand(root, { full: true, category: "privacy", report: "json" });
    const json = JSON.parse(result.output) as { findings: Array<{ category: string }>; privacyFindings: unknown[] };

    expect(result.exitCode).toBe(0);
    expect(json.findings.length).toBeGreaterThan(0);
    expect(json.findings.every((finding) => finding.category === "privacy")).toBe(true);
    expect(json.privacyFindings.length).toBe(json.findings.length);
  });

  it("respects the configured file-size cap", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-pii-size-"));
    await fs.mkdir(path.join(root, "data"), { recursive: true });
    await fs.writeFile(path.join(root, "data", "large.txt"), `email: rohit.sharma@example.com\n${"x".repeat(200)}`, "utf8");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
paths:
  include:
    - data/**
baseline:
  enabled: false
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: false
  leftovers:
    enabled: false
  refactorReadiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: true
    max_file_bytes: 10
`,
      "utf8"
    );

    const scan = await runScan(root, "full");
    expect(scan.privacyFindings).toHaveLength(0);
  });
});
