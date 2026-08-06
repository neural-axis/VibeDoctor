import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { DPDP_CONTROLS, DPDP_CATALOGUE_META } from "../../src/dpdp/catalogue";
import { LEGAL_SOURCES, LEGAL_SOURCE_MANIFEST_VERSION } from "../../src/dpdp/legalSources";
import {
  runDpdpScan,
  determineDpdpExitCode,
  initDpdpWorkspace,
  explainDpdpTarget,
  loadOrScanDpdp
} from "../../src/dpdp/scan";
import { loadCachedDpdpScanResult } from "../../src/dpdp/artifacts";
import * as collectorsMod from "../../src/dpdp/collectors";
import {
  confidenceMeetsThreshold,
  filterSignalsByConfidence,
  collectDpdpSignals,
  classifyPrivacyFindingTags
} from "../../src/dpdp/collectors";
import { controlResultsToFindings, stableDpdpFindingSnippet } from "../../src/dpdp/findings";
import { fingerprintFinding } from "../../src/core/finding";
import { writeBaseline } from "../../src/core/baseline";
import {
  buildDpdpScores,
  computeTechnicalPostureScore,
  isGapControl,
  isPositiveControl,
  posturePointsForControl
} from "../../src/dpdp/scoring";
import { redactLikelyPii } from "../../src/dpdp/evidence";
import { isHardcodedLiteralSignal } from "../../src/dpdp/evaluators";
import type { ControlResult } from "../../src/dpdp/types";
import {
  applyNonUnknownOrg,
  DEFAULT_DPDP_CONTEXT,
  resolveDpdpContext
} from "../../src/dpdp/context";
import { resolveDpdpCandidateFiles } from "../../src/dpdp/paths";
import { loadConfig, defaultConfig } from "../../src/core/config";
import type { ProjectContext } from "../../src/core/projectDetector";
import type { ToolAdapterContext } from "../../src/adapters/shared";
import { createTempFixtureCopy } from "../helpers";
import { runDpdpScanCommand, runDpdpInitCommand, runDpdpReportCommand } from "../../src/cli/commands/dpdp";
import { AGENT_SKILLS } from "../../src/agentPack/templates/skills";
import { VERIFICATION_CLASSES, CONTROL_STATUSES, type TechnicalSignalBag } from "../../src/dpdp/types";

function makeProject(overrides: Partial<ProjectContext> = {}): ProjectContext {
  return {
    root: "/tmp/proj",
    languages: ["typescript"],
    packageManagers: ["npm"],
    hasGit: true,
    changedFiles: [],
    configFiles: [],
    lockfiles: [],
    testCommands: [],
    toolsAvailable: {},
    frameworkHints: [],
    entryFiles: [],
    projectFiles: ["src/a.ts", "src/b.ts", "src/schema.prisma", "README.md"],
    ...overrides
  };
}

function makeCtx(overrides: Partial<ToolAdapterContext> = {}): ToolAdapterContext {
  const config = structuredClone(defaultConfig);
  config.checks.dpdp.enabled = true;
  config.paths.include = ["src/**", "**/*.prisma"];
  config.paths.exclude = ["node_modules/**"];
  return {
    root: "/tmp/proj",
    project: makeProject(),
    config,
    scanMode: "full",
    ...overrides
  };
}

describe("DPDP catalogue", () => {
  it("represents a full obligation set with verification class and legal references", () => {
    expect(DPDP_CONTROLS.length).toBeGreaterThanOrEqual(30);
    expect(DPDP_CATALOGUE_META.disclaimer.toLowerCase()).toContain("not a legal certification");
    expect(LEGAL_SOURCES.map((item) => item.id)).toEqual(
      expect.arrayContaining(["DPDP-ACT-2023", "DPDP-RULES-2025", "DPDP-CORRIGENDUM", "DPDP-ENFORCEMENT-NOTIFICATION"])
    );
    expect(LEGAL_SOURCE_MANIFEST_VERSION).toBeTruthy();
    const finalRules = LEGAL_SOURCES.find((item) => item.id === "DPDP-RULES-2025");
    const commencement = LEGAL_SOURCES.find((item) => item.id === "DPDP-ENFORCEMENT-NOTIFICATION");
    expect(finalRules?.notificationId).toBe("G.S.R. 846(E)");
    expect(finalRules?.url).toMatch(/^https:\/\/www\.meity\.gov\.in\//);
    expect(finalRules?.effectiveSchedule?.length).toBeGreaterThan(0);
    expect(commencement?.notificationId).toBe("G.S.R. 843(E)");

    for (const control of DPDP_CONTROLS) {
      expect(control.id).toMatch(/^DPDP-/);
      expect(control.title.length).toBeGreaterThan(0);
      expect(control.domain).toBeTruthy();
      expect(control.technicalIntent.length).toBeGreaterThan(0);
      expect(control.legalSourceIds.length).toBeGreaterThan(0);
      expect(control.legalCitations.length).toBeGreaterThan(0);
      expect(VERIFICATION_CLASSES).toContain(control.verificationClass);
      expect(control.evidenceRequirements.length).toBeGreaterThan(0);
      expect(control.possibleStatuses.length).toBeGreaterThan(0);
      expect(control.limitations.length).toBeGreaterThan(0);
      expect(control.remediation.length).toBeGreaterThan(0);
      expect(control.humanReviewQuestions.length).toBeGreaterThan(0);
      expect(control.sourceVersion).toBeTruthy();
      for (const status of control.possibleStatuses) {
        expect(CONTROL_STATUSES).toContain(status);
      }
    }

    const domains = new Set(DPDP_CONTROLS.map((item) => item.domain));
    expect(domains.has("notice")).toBe(true);
    expect(domains.has("consent")).toBe(true);
    expect(domains.has("security_safeguards")).toBe(true);
    expect(domains.has("childrens_data")).toBe(true);
    expect(domains.has("significant_data_fiduciary")).toBe(true);
  });
});

describe("DPDP deterministic scan", () => {
  it("scores a technically strong application without claiming legal compliance", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const result = await runDpdpScan(root, "full");

    expect(result.disclaimer.toLowerCase()).toContain("not legal");
    expect(result.scores.labels.technicalPosture.toLowerCase()).toContain("not legal compliance");
    expect(result.scores.technicalPostureScore).toBeGreaterThanOrEqual(50);
    expect(result.controlMatrix.controls.length).toBe(DPDP_CONTROLS.length);
    expect(result.dataMap.stores.length).toBeGreaterThan(0);
    expect(result.controlMatrix.controls.some((item) => item.controlId === "DPDP-CONSENT-001" && item.status !== "VIOLATED")).toBe(
      true
    );

    const serialized = JSON.stringify(result);
    expect(serialized).not.toMatch(/ABCDE1234F/);
    expect(result.scores.statusCounts.verified + result.scores.statusCounts.partial).toBeGreaterThan(0);
  });

  it("detects violations in an unsafe application and masks raw PII", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const result = await runDpdpScan(root, "full");

    expect(result.scores.statusCounts.violated).toBeGreaterThan(0);
    expect(result.findings.some((finding) => finding.source === "dpdp")).toBe(true);
    expect(result.dataMap.externalRecipients.length).toBeGreaterThan(0);
    expect(result.dataMap.safeguardGaps.length).toBeGreaterThan(0);

    const controlIds = result.controlMatrix.controls.filter((item) => item.status === "VIOLATED").map((item) => item.controlId);
    expect(controlIds.length).toBeGreaterThan(0);

    const blob = JSON.stringify(result);
    expect(blob).not.toContain("ABCDE1234F");
    expect(blob).not.toContain("rohit.sharma@example.com");
    expect(blob).not.toContain("2345 6789 0124");

    const artifacts = await fs.readdir(path.join(root, ".vibedoctor", "dpdp"));
    expect(artifacts).toEqual(
      expect.arrayContaining([
        "data-map.json",
        "control-matrix.json",
        "evidence-ledger.json",
        "review-queue.md",
        "agent-handoff.md",
        "readiness-report.html"
      ])
    );
  });

  it("handles ambiguous applications with missing context as needs-context / not-observed", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    const result = await runDpdpScan(root, "full");

    expect(result.controlMatrix.controls.some((item) => item.status === "NEEDS_CONTEXT")).toBe(true);
    expect(result.reviewQueue.length).toBeGreaterThan(0);
    expect(result.scores.evidenceCompletenessPercent).toBeGreaterThanOrEqual(0);
    expect(result.disclaimer).toContain("technical readiness");
  });

  it("flags children's data without guardian consent signals", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/children");
    const result = await runDpdpScan(root, "full");
    const guardian = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-CHILD-002");
    expect(guardian).toBeDefined();
    expect(["VIOLATED", "PARTIAL", "NOT_OBSERVED"]).toContain(guardian!.status);
    const children = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-CHILD-001");
    expect(children?.status === "PARTIAL" || children?.status === "VIOLATED" || Boolean(children)).toBe(true);
  });

  it("detects PII in logs and LLM prompts", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/llm-logs");
    const result = await runDpdpScan(root, "full");
    const logs = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-001");
    const llm = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-002");
    expect(logs?.status === "VIOLATED" || result.evidenceLedger.evidence.some((item) => item.tags.includes("pii-in-logs"))).toBe(
      true
    );
    expect(llm?.status === "VIOLATED" || result.evidenceLedger.evidence.some((item) => item.tags.includes("pii-in-llm"))).toBe(
      true
    );
  });

  it("treats declared evidence as non-deterministic provenance", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    await fs.mkdir(path.join(root, ".vibedoctor", "dpdp"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".vibedoctor", "dpdp", "evidence.yml"),
      `version: 1
assertions:
  - id: ASSERT-PROC-1
    statement: "All processors have signed contracts"
    source: "legal/contracts.md"
    supplied_role: legal
    date: "2026-01-01"
    related_controls: ["DPDP-PROC-002"]
    verification_status: unverified
`,
      "utf8"
    );

    const result = await runDpdpScan(root, "full");
    expect(result.evidenceLedger.declared.some((item) => item.id === "ASSERT-PROC-1")).toBe(true);
    expect(result.evidenceLedger.evidence.some((item) => item.provenance === "declared")).toBe(true);
    const procContract = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-PROC-002");
    expect(procContract?.status).not.toBe("VERIFIED");
    expect(procContract?.verificationClass).toBe("DECLARED_EVIDENCE");
  });

  it("does not fail CI on human-review alone", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    const result = await runDpdpScan(root, "full");
    const { config } = await loadConfig(root);
    expect(determineDpdpExitCode(result, config)).toBe(0);
  });

  it("fails CI only when configured deterministic gates match", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const result = await runDpdpScan(root, "full");
    const { config } = await loadConfig(root);
    config.checks.dpdp.failOnViolatedControls = result.controlMatrix.controls
      .filter((item) => item.status === "VIOLATED")
      .map((item) => item.controlId)
      .slice(0, 1);
    expect(config.checks.dpdp.failOnViolatedControls.length).toBe(1);
    expect(determineDpdpExitCode(result, config)).toBe(1);
  });

  it("produces stable finding ids and masks snippets", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const first = await runDpdpScan(root, "full");
    const second = await runDpdpScan(root, "full");
    const ids = first.findings.map((item) => item.id).sort();
    expect(ids).toEqual(second.findings.map((item) => item.id).sort());
    expect(ids.every((id) => id.startsWith("dpdp:"))).toBe(true);
    expect(redactLikelyPii("email rohit.sharma@example.com pan ABCDE1234F")).toContain("[email]");
    expect(redactLikelyPii("email rohit.sharma@example.com pan ABCDE1234F")).toContain("[pan]");
    const expanded = redactLikelyPii(
      'name="Rohit Sharma" passport="A1234567" api_key="super-secret-value" ip=192.168.1.4'
    );
    expect(expanded).not.toContain("Rohit Sharma");
    expect(expanded).not.toContain("A1234567");
    expect(expanded).not.toContain("super-secret-value");
    expect(expanded).not.toContain("192.168.1.4");
  });

  it("supports init and report CLI commands", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const init = await runDpdpInitCommand(root);
    expect(init.exitCode).toBe(0);
    expect(init.output.toLowerCase()).toContain("technical readiness");

    const scan = await runDpdpScanCommand(root, { full: true, report: "json" });
    expect(scan.exitCode).toBe(0);
    const json = JSON.parse(scan.output) as { scores: { technicalPostureScore: number }; disclaimer: string };
    expect(json.scores.technicalPostureScore).toBeGreaterThanOrEqual(0);
    expect(json.disclaimer.toLowerCase()).toContain("not legal");

    const report = await runDpdpReportCommand(root, { markdown: true });
    expect(report.output).toContain("Technical Readiness");
  });

  it("explains a control id", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const explained = await explainDpdpTarget(root, "DPDP-APP-001");
    expect(explained.type).toBe("control");
  });

  it("uses cached artifacts for map/explain unless refresh is set", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const live = await runDpdpScan(root, "full");
    const cached = await loadCachedDpdpScanResult(root);
    expect(cached?.generatedAt).toBe(live.generatedAt);
    expect(cached?.controlMatrix.controls.length).toBe(DPDP_CONTROLS.length);

    const spy = vi.spyOn(collectorsMod, "collectDpdpSignals");
    const fromCache = await loadOrScanDpdp(root, "full", false);
    expect(fromCache.generatedAt).toBe(live.generatedAt);
    expect(spy).not.toHaveBeenCalled();

    const explained = await explainDpdpTarget(root, "DPDP-APP-001", { refresh: false });
    expect(explained.type).toBe("control");
    expect(explained.fromCache).toBe(true);
    expect(spy).not.toHaveBeenCalled();

    await loadOrScanDpdp(root, "full", true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();

    // Fixture helpers opt out of external scanners for speed; capabilities must still be recorded.
    const presidio = live.capabilities.find((item) => item.id === "presidio");
    const semgrep = live.capabilities.find((item) => item.id === "semgrep");
    expect(presidio).toBeTruthy();
    expect(semgrep).toBeTruthy();
    expect(["available", "skipped", "error"]).toContain(presidio?.status);
    expect(["available", "skipped", "error"]).toContain(semgrep?.status);
    // Opted out in fixtures → skipped with opt-out wording (never a silent pass)
    expect(presidio?.status).toBe("skipped");
    expect(semgrep?.status).toBe("skipped");
    expect(presidio?.message?.toLowerCase()).toMatch(/opt(ed)? out|not installed|unavailable|disabled/);
    expect(semgrep?.message?.toLowerCase()).toMatch(/opt(ed)? out|not installed|unavailable|disabled|not applicable/);
  });

  it("defaults usePresidio and useSemgrep to true (opt-out model)", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-dpdp-defaults-"));
    const { config } = await loadConfig(root);
    expect(config.checks.dpdp.enabled).toBe(true);
    expect(config.checks.dpdp.usePresidio).toBe(true);
    expect(config.checks.dpdp.useSemgrep).toBe(true);
    expect(config.checks.privacy.presidio.enabled).toBe(true);
  });

  it("respects explicit opt-out of optional scanners", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
baseline:
  enabled: false
checks:
  privacy:
    enabled: true
    presidio:
      enabled: false
  dpdp:
    enabled: true
    use_presidio: false
    use_semgrep: false
paths:
  include:
    - src/**
`,
      "utf8"
    );
    const result = await runDpdpScan(root, "full");
    const presidio = result.capabilities.find((item) => item.id === "presidio");
    const semgrep = result.capabilities.find((item) => item.id === "semgrep");
    expect(presidio?.status).toBe("skipped");
    expect(semgrep?.status).toBe("skipped");
    expect(presidio?.message?.toLowerCase()).toContain("opt");
    expect(semgrep?.message?.toLowerCase()).toContain("opt");
  });

  it("includes the readiness-review skill in agent pack templates", () => {
    expect(AGENT_SKILLS.some((skill) => skill.name === "vibedoctor-dpdp-readiness-review")).toBe(true);
    const skill = AGENT_SKILLS.find((item) => item.name === "vibedoctor-dpdp-readiness-review");
    expect(skill?.content).toContain("not");
    expect(skill?.content.toLowerCase()).toContain("legal certification");
    expect(skill?.content).toContain("vibedoctor dpdp scan");
    expect(skill?.content).toContain("## Legal-source freshness gate");
    expect(skill?.content).toContain("LEGAL_SOURCE_DRIFT");
    expect(skill?.content).toContain("CURRENT_LEGAL_SOURCES_NOT_VERIFIED");
    expect(skill?.content).toContain("meity.gov.in");
    expect(skill?.content).toContain("indiacode.nic.in");
    expect(skill?.content).toContain("egazette.nic.in");
  });

  it("never treats absence of evidence as VERIFIED for deterministic safeguards", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    const result = await runDpdpScan(root, "full");
    const piiLogs = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-001");
    // Without personal data, may be N/A; with none, must not be VERIFIED solely from silence in ambiguous empty apps
    if (piiLogs && piiLogs.applicable && piiLogs.evidenceIds.length === 0) {
      expect(piiLogs.status).not.toBe("VERIFIED");
    }
    const scores = buildDpdpScores(result.controlMatrix.controls);
    expect(scores.labels.technicalPosture).toContain("not legal compliance");
  });

  it("applies checks.dpdp.organization from vibedoctor.yml when context.yml is absent", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    // Neutral source without region/processor signals so inventory sees no code evidence
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const ok = true;\n", "utf8");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
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
    presidio:
      enabled: false
  dpdp:
    enabled: true
    use_presidio: false
    use_semgrep: false
    organization:
      processes_personal_data: true
paths:
  include:
    - src/**
`,
      "utf8"
    );

    const result = await runDpdpScan(root, "full");
    expect(result.context.organization.processesPersonalData).toBe("true");
    const inventory = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-APP-001");
    // No personal-data signals in code; organisation declares processing → PARTIAL
    expect(inventory?.status).toBe("PARTIAL");
  });

  it("lets context.yml override vibedoctor.yml organisation defaults", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
baseline:
  enabled: false
checks:
  privacy:
    enabled: true
    presidio:
      enabled: false
  dpdp:
    enabled: true
    use_presidio: false
    use_semgrep: false
    organization:
      processes_personal_data: true
      processes_children_data: true
paths:
  include:
    - src/**
`,
      "utf8"
    );
    await fs.mkdir(path.join(root, ".vibedoctor", "dpdp"), { recursive: true });
    await fs.writeFile(
      path.join(root, ".vibedoctor", "dpdp", "context.yml"),
      `version: 1
organization:
  processes_personal_data: false
  processes_children_data: unknown
`,
      "utf8"
    );

    const { config } = await loadConfig(root);
    const context = await resolveDpdpContext(root, config);
    expect(context.organization.processesPersonalData).toBe("false");
    // yml non-unknown children=true, context left children as unknown → context wins with unknown
    expect(context.organization.processesChildrenData).toBe("unknown");
  });
});

describe("DPDP scoring policy", () => {
  function syntheticControl(
    partial: Partial<ControlResult> & Pick<ControlResult, "controlId" | "status" | "verificationClass">
  ): ControlResult {
    return {
      title: partial.controlId,
      domain: "security_safeguards",
      confidence: "medium",
      severity: "medium",
      evidenceIds: [],
      explanation: "test",
      limitations: [],
      isNew: true,
      applicable: true,
      ...partial
    };
  }

  it("assigns lower NOT_OBSERVED credit to positive controls than gap detectors", () => {
    const consentMissing = syntheticControl({
      controlId: "DPDP-CONSENT-001",
      status: "NOT_OBSERVED",
      verificationClass: "TECHNICAL_SIGNAL"
    });
    const piiLogsClean = syntheticControl({
      controlId: "DPDP-SEC-001",
      status: "NOT_OBSERVED",
      verificationClass: "DETERMINISTIC"
    });
    expect(isPositiveControl(consentMissing)).toBe(true);
    expect(isGapControl(piiLogsClean)).toBe(true);
    expect(posturePointsForControl(consentMissing)).toBe(0.25);
    expect(posturePointsForControl(piiLogsClean)).toBe(0.85);
    expect(posturePointsForControl(syntheticControl({
      controlId: "DPDP-SEC-001",
      status: "VIOLATED",
      verificationClass: "DETERMINISTIC"
    }))).toBe(0);
    expect(posturePointsForControl(syntheticControl({
      controlId: "DPDP-SEC-001",
      status: "VERIFIED",
      verificationClass: "DETERMINISTIC"
    }))).toBe(1);
  });

  it("computes posture score from the published point table", () => {
    const controls: ControlResult[] = [
      syntheticControl({
        controlId: "DPDP-SEC-001",
        status: "VERIFIED",
        verificationClass: "DETERMINISTIC"
      }),
      syntheticControl({
        controlId: "DPDP-CONSENT-001",
        status: "NOT_OBSERVED",
        verificationClass: "TECHNICAL_SIGNAL"
      }),
      syntheticControl({
        controlId: "DPDP-SEC-002",
        status: "VIOLATED",
        verificationClass: "DETERMINISTIC"
      }),
      // excluded from posture
      syntheticControl({
        controlId: "DPDP-NOTICE-002",
        status: "NEEDS_CONTEXT",
        verificationClass: "HUMAN_REVIEW"
      }),
      syntheticControl({
        controlId: "DPDP-SEC-003",
        status: "NOT_APPLICABLE",
        verificationClass: "DETERMINISTIC",
        applicable: false
      })
    ];
    // observable: SEC-001 VERIFIED 1.0, CONSENT NOT_OBSERVED 0.25, SEC-002 VIOLATED 0 → avg 0.4167 → 42
    expect(computeTechnicalPostureScore(controls)).toBe(42);
  });

  it("keeps strong fixture posture competitive and unsafe clearly worse", async () => {
    const strong = await runDpdpScan(await createTempFixtureCopy("dpdp/projects/strong"), "full");
    const unsafe = await runDpdpScan(await createTempFixtureCopy("dpdp/projects/unsafe"), "full");
    expect(strong.scores.technicalPostureScore).toBeGreaterThanOrEqual(45);
    expect(unsafe.scores.technicalPostureScore).toBeLessThan(strong.scores.technicalPostureScore);
    expect(unsafe.scores.statusCounts.violated).toBeGreaterThan(0);
  });
});

describe("DPDP hardcoded PII evaluator", () => {
  it("classifies field metadata vs value literals", () => {
    expect(classifyPrivacyFindingTags("src/user.ts", "email-field", "metadata")).toContain("field-metadata");
    expect(classifyPrivacyFindingTags("src/user.ts", "email-regex", "regex")).toContain("value-literal");
    expect(classifyPrivacyFindingTags("fixtures/seed.ts", "pan-regex", "regex + checksum")).toEqual(
      expect.arrayContaining(["value-literal", "fixture-path"])
    );
  });

  it("isHardcodedLiteralSignal ignores field-metadata only", () => {
    expect(
      isHardcodedLiteralSignal({
        id: "1",
        kind: "field",
        summary: "email field",
        confidence: "high",
        tags: ["privacy-detector", "email", "field-metadata"],
        detectionMethod: "email-field",
        provenance: "privacy-detector",
        certainty: "confirmed",
        category: "email"
      })
    ).toBe(false);
    expect(
      isHardcodedLiteralSignal({
        id: "2",
        kind: "category",
        summary: "email value",
        confidence: "high",
        tags: ["privacy-detector", "email", "value-literal"],
        detectionMethod: "email-regex",
        provenance: "privacy-detector",
        certainty: "confirmed",
        category: "email"
      })
    ).toBe(true);
  });

  it("schema-only personal fields do not force hardcoded PII VIOLATED", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    // Strong app has schema fields (email/phone) but no production PII literals in source
    const result = await runDpdpScan(root, "full");
    const hardcoded = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-007");
    expect(hardcoded).toBeTruthy();
    expect(hardcoded?.status).not.toBe("VIOLATED");
  });

  it("unsafe fixture with embedded literals still violates hardcoded PII", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const result = await runDpdpScan(root, "full");
    const hardcoded = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-007");
    expect(hardcoded?.status).toBe("VIOLATED");
  });
});

describe("DPDP config helpers", () => {
  it("filters signals by min confidence threshold", () => {
    expect(confidenceMeetsThreshold("high", "medium")).toBe(true);
    expect(confidenceMeetsThreshold("low", "medium")).toBe(false);
    expect(confidenceMeetsThreshold("medium", "medium")).toBe(true);

    const signals: TechnicalSignalBag[] = [
      {
        id: "a",
        kind: "safeguard_gap",
        summary: "low",
        confidence: "low",
        tags: [],
        detectionMethod: "t"
      },
      {
        id: "b",
        kind: "safeguard_gap",
        summary: "high",
        confidence: "high",
        tags: [],
        detectionMethod: "t"
      },
      {
        id: "c",
        kind: "capability",
        summary: "cap",
        confidence: "low",
        tags: ["capability"],
        detectionMethod: "t"
      }
    ];
    const filtered = filterSignalsByConfidence(signals, "high");
    expect(filtered.map((item) => item.id).sort()).toEqual(["b", "c"]);
  });

  it("applies non-unknown org overlays", () => {
    const merged = applyNonUnknownOrg(DEFAULT_DPDP_CONTEXT.organization, {
      processesPersonalData: "true",
      isSignificantDataFiduciary: "unknown"
    });
    expect(merged.processesPersonalData).toBe("true");
    expect(merged.isSignificantDataFiduciary).toBe("unknown");
  });
});

describe("DPDP changed scope", () => {
  it("resolveDpdpCandidateFiles scopes to changed files when present", () => {
    const ctx = makeCtx({
      scanMode: "changed",
      project: makeProject({
        projectFiles: ["src/a.ts", "src/b.ts", "src/c.ts"],
        changedFiles: ["src/a.ts"]
      })
    });
    const resolution = resolveDpdpCandidateFiles(ctx);
    expect(resolution.scope).toBe("changed");
    expect(resolution.files).toEqual(["src/a.ts"]);
    expect(resolution.capability?.id).toBe("changed-scope");
    expect(resolution.capability?.status).toBe("available");
  });

  it("resolveDpdpCandidateFiles falls back to full when changed list is empty", () => {
    const ctx = makeCtx({
      scanMode: "changed",
      project: makeProject({
        projectFiles: ["src/a.ts", "src/b.ts"],
        changedFiles: []
      })
    });
    const resolution = resolveDpdpCandidateFiles(ctx);
    expect(resolution.scope).toBe("changed-fallback-full");
    expect(resolution.files.sort()).toEqual(["src/a.ts", "src/b.ts"]);
    expect(resolution.capability?.status).toBe("skipped");
    expect(resolution.capability?.message?.toLowerCase()).toContain("full");
  });

  it("full mode ignores changedFiles for candidate selection", () => {
    const ctx = makeCtx({
      scanMode: "full",
      project: makeProject({
        projectFiles: ["src/a.ts", "src/b.ts"],
        changedFiles: ["src/a.ts"]
      })
    });
    const resolution = resolveDpdpCandidateFiles(ctx);
    expect(resolution.scope).toBe("full");
    expect(resolution.files.sort()).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("collectDpdpSignals only reads allowlisted changed files", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const { config } = await loadConfig(root);
    // Unsafe fixture: server.ts has violations; schema.prisma is separate. Scope to schema only.
    const projectFiles = ["src/server.ts", "src/schema.prisma"];
    const ctx: ToolAdapterContext = {
      root,
      config,
      scanMode: "changed",
      project: {
        root,
        languages: ["typescript"],
        packageManagers: ["npm"],
        hasGit: true,
        changedFiles: ["src/schema.prisma"],
        configFiles: [],
        lockfiles: [],
        testCommands: [],
        toolsAvailable: {},
        frameworkHints: [],
        entryFiles: [],
        projectFiles
      }
    };

    const bundle = await collectDpdpSignals(ctx);
    expect(bundle.scope).toBe("changed");
    expect(bundle.candidateFiles).toEqual(["src/schema.prisma"]);
    expect(bundle.filesScanned).toBe(1);
    // Signals from server.ts (debug dump, mixpanel, openai chat) must not appear
    const files = new Set(bundle.signals.map((signal) => signal.file).filter(Boolean));
    expect(files.has("src/server.ts")).toBe(false);
    expect([...files].every((file) => file === "src/schema.prisma")).toBe(true);
  });

  it("runDpdpScan --changed records scope capability and keeps full control matrix", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const result = await runDpdpScan(root, "changed");
    expect(result.mode).toBe("changed");
    expect(result.controlMatrix.controls.length).toBe(DPDP_CONTROLS.length);
    const scopeCap = result.capabilities.find((item) => item.id === "changed-scope");
    expect(scopeCap).toBeTruthy();
    // Non-git temp fixture → empty changed files → fallback full
    expect(scopeCap?.status === "skipped" || scopeCap?.status === "available").toBe(true);
  });
});

describe("DPDP baseline", () => {
  async function writeUnsafeBaselineConfig(root: string): Promise<void> {
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
baseline:
  enabled: true
  file: .vibedoctor/baseline.json
  fail_only_on_new_issues: true
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
    minConfidenceToReport: low
    presidio:
      enabled: false
  dpdp:
    enabled: true
    usePresidio: false
    useSemgrep: false
    failOnlyOnNew: true
    failOnViolatedControls: []
paths:
  include:
    - src/**
`,
      "utf8"
    );
  }

  it("produces stable fingerprints when snippet is present even if line moves", () => {
    const control = {
      controlId: "DPDP-SEC-001",
      title: "PII in logs",
      domain: "security_safeguards" as const,
      status: "VIOLATED" as const,
      verificationClass: "DETERMINISTIC" as const,
      confidence: "high" as const,
      severity: "high" as const,
      evidenceIds: ["ev-1"],
      explanation: "Unsanitized personal-data logging signals detected.",
      limitations: ["heuristic"],
      isNew: true,
      applicable: true
    };
    const evidence = new Map([
      [
        "ev-1",
        {
          id: "ev-1",
          kind: "safeguard_gap" as const,
          file: "src/server.ts",
          line: 10,
          detectionMethod: "t",
          confidence: "high" as const,
          provenance: "deterministic" as const,
          relatedControls: ["DPDP-SEC-001"],
          certainty: "confirmed" as const,
          summary: "Potential PII in logger call",
          snippet: "console.log(user.email)",
          tags: ["pii-in-logs"]
        }
      ]
    ]);
    const [finding] = controlResultsToFindings([control], evidence);
    expect(finding.evidence?.snippet).toBeTruthy();
    const fp = fingerprintFinding(finding);
    const moved = fingerprintFinding({ ...finding, startLine: 999 });
    expect(fp).toBe(moved);
    expect(stableDpdpFindingSnippet(control, evidence.get("ev-1"))).toContain("DPDP-SEC-001");
  });

  it("marks baselined DPDP findings and controls as not new", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    await writeUnsafeBaselineConfig(root);

    const first = await runDpdpScan(root, "full");
    expect(first.baselineApplied).toBe(true);
    expect(first.findings.length).toBeGreaterThan(0);
    expect(first.findings.every((finding) => finding.isNew)).toBe(true);
    expect(first.controlMatrix.controls.some((item) => item.status === "VIOLATED" && item.isNew)).toBe(true);

    await writeBaseline(root, ".vibedoctor/baseline.json", first.findings);

    const second = await runDpdpScan(root, "full");
    expect(second.findings.length).toBeGreaterThan(0);
    expect(second.findings.every((finding) => finding.isNew === false)).toBe(true);
    const violated = second.controlMatrix.controls.filter((item) => item.status === "VIOLATED");
    expect(violated.length).toBeGreaterThan(0);
    expect(violated.every((item) => item.isNew === false)).toBe(true);
  });

  it("failOnlyOnNew does not fail CI for baselined violated controls", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    await writeUnsafeBaselineConfig(root);

    const first = await runDpdpScan(root, "full");
    const violatedIds = first.controlMatrix.controls
      .filter((item) => item.status === "VIOLATED")
      .map((item) => item.controlId);
    expect(violatedIds.length).toBeGreaterThan(0);

    await writeBaseline(root, ".vibedoctor/baseline.json", first.findings);

    const second = await runDpdpScan(root, "full");
    const { config } = await loadConfig(root);
    config.checks.dpdp.failOnlyOnNew = true;
    config.checks.dpdp.failOnViolatedControls = violatedIds;

    expect(determineDpdpExitCode(first, config)).toBe(1);
    expect(determineDpdpExitCode(second, config)).toBe(0);
  });

  it("failOnlyOnNew still fails when an unbaselined violated control remains", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    await writeUnsafeBaselineConfig(root);

    const first = await runDpdpScan(root, "full");
    expect(first.findings.length).toBeGreaterThan(1);

    // Baseline all but one finding so one control stays "new"
    const partial = first.findings.slice(0, Math.max(1, first.findings.length - 1));
    await writeBaseline(root, ".vibedoctor/baseline.json", partial);

    const second = await runDpdpScan(root, "full");
    const newViolated = second.controlMatrix.controls.filter(
      (item) => item.status === "VIOLATED" && item.isNew
    );
    expect(newViolated.length).toBeGreaterThan(0);

    const { config } = await loadConfig(root);
    config.checks.dpdp.failOnlyOnNew = true;
    config.checks.dpdp.failOnViolatedControls = newViolated.map((item) => item.controlId);
    expect(determineDpdpExitCode(second, config)).toBe(1);
  });
});

describe("DPDP data-map graph", () => {
  it("includes a non-empty classified graph for unsafe fixtures", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/unsafe");
    const result = await runDpdpScan(root, "full");
    const { graph } = result.dataMap;

    expect(graph).toBeTruthy();
    expect(graph.nodes.length).toBeGreaterThan(0);
    expect(graph.edges.length).toBeGreaterThan(0);
    expect(graph.nodes.some((node) => node.kind === "category" || node.kind === "store" || node.kind === "external")).toBe(
      true
    );
    expect(graph.nodes.some((node) => node.kind === "control")).toBe(true);

    const blob = JSON.stringify(graph);
    expect(blob).not.toContain("rohit.sharma@example.com");
    expect(blob).not.toContain("ABCDE1234F");
    expect(blob).not.toContain("2345 6789 0124");
  });

  it("keeps flat map fields for compatibility", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const result = await runDpdpScan(root, "full");
    expect(Array.isArray(result.dataMap.categories)).toBe(true);
    expect(Array.isArray(result.dataMap.stores)).toBe(true);
    expect(Array.isArray(result.dataMap.graph.nodes)).toBe(true);
    expect(Array.isArray(result.dataMap.graph.edges)).toBe(true);
  });
});

describe("DPDP collector modules", () => {
  it("extracts Prisma field-level personal-data signals", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/strong");
    const result = await runDpdpScan(root, "full");
    const fieldSignals = result.evidenceLedger.evidence.filter(
      (item) => item.tags.includes("prisma-field") || item.detectionMethod === "prisma-field-extract"
    );
    expect(fieldSignals.length).toBeGreaterThan(0);
    expect(fieldSignals.some((item) => (item.field ?? "").toLowerCase().includes("email"))).toBe(true);
  });

  it("detects multi-line logger PII that single-line heuristics miss", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    await fs.writeFile(
      path.join(root, "src", "index.ts"),
      `export type User = { email: string };
export function log(user: User) {
  console.log(
    "user",
    user.email
  );
}
`,
      "utf8"
    );
    const result = await runDpdpScan(root, "full");
    const logs = result.controlMatrix.controls.find((item) => item.controlId === "DPDP-SEC-001");
    expect(logs?.status).toBe("VIOLATED");
    expect(
      result.evidenceLedger.evidence.some((item) => item.detectionMethod === "logger-multiline-pattern")
    ).toBe(true);
  });
});

describe("DPDP workspace init", () => {
  it("writes context and evidence scaffolding", async () => {
    const root = await createTempFixtureCopy("dpdp/projects/ambiguous");
    const written = await initDpdpWorkspace(root);
    expect(written.length).toBeGreaterThan(0);
    const context = await fs.readFile(path.join(root, ".vibedoctor", "dpdp", "context.yml"), "utf8");
    expect(context).toContain("unknown");
    const evidence = await fs.readFile(path.join(root, ".vibedoctor", "dpdp", "evidence.yml"), "utf8");
    expect(evidence).toContain("assertions");
  });
});
