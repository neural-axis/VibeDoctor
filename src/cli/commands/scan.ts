import { runScan } from "../../core/engine";
import type { VibeDoctorConfig } from "../../core/config";
import { parseFindingCategoryList, type Finding } from "../../core/finding";
import { filterScanByCategories, type ScanOutput } from "../../core/engine";
import type { ScanMode } from "../../core/scanPlanner";
import { renderTerminalReport } from "../../reporters/terminal";
import { renderJsonReport } from "../../reporters/json";
import { renderHtmlReport } from "../../reporters/html";
import { renderAgentJson, renderAgentMarkdown } from "../../reporters/agent";
import { ensureOutputArtifacts, getConfig } from "./shared";
import { evaluateDpdpFailureGate, findingToGateCandidate } from "../../dpdp/gates";
import { currentPolicy } from "../../core/executionPolicy";
import { buildMachineEnvelope } from "../../integration/envelope";
import { sourceFingerprint } from "../../integration/sourceFingerprint";

export type ScanCommandResult = {
  output: string;
  exitCode: number;
};

function shouldCountForFailure(isNew: boolean, config: VibeDoctorConfig): boolean {
  return config.baseline.failOnlyOnNewIssues ? isNew : true;
}

function isHighSeverity(finding: Finding): boolean {
  return finding.severity === "high" || finding.severity === "critical";
}

function isHighConfidence(finding: Finding): boolean {
  return finding.confidence === "high";
}

function isReviewedFalsePositive(finding: Finding): boolean {
  return finding.evidence?.reviewState === "false_positive";
}

export function determineExitCode(scan: Pick<ScanOutput, "score" | "findings"> & Partial<Pick<ScanOutput, "completeness">>, config: VibeDoctorConfig): number {
  if (
    scan.completeness &&
    (scan.completeness.status === "invalid" || (config.runtime.failOnIncompleteScan && scan.completeness.status !== "complete"))
  ) {
    return 2;
  }
  if (scan.score.overall < config.score.minimum) {
    return 1;
  }

  const failingFindings = scan.findings.filter((finding) => shouldCountForFailure(finding.isNew, config));
  const secretFailure =
    config.checks.security.enabled &&
    config.checks.security.failOnSecrets && failingFindings.some((finding) => finding.source === "gitleaks");
  const dependencyFailure =
    ((config.checks.security.enabled && config.checks.security.failOnNewHighVulnerabilities) ||
      (config.checks.dependencies.enabled && config.checks.dependencies.failOnNewDirectVulnerabilities))
      ? failingFindings.some((finding) => finding.category === "dependencies" && isHighSeverity(finding))
      : false;
  const missingDependencyFailure =
    config.checks.dependencies.enabled &&
    config.checks.dependencies.failOnMissingDependencies &&
    failingFindings.some((finding) => finding.source === "deptry" && finding.title === "DEP002");
  const typeFailure =
    config.checks.correctness.enabled &&
    config.checks.correctness.failOnTypeErrors &&
    failingFindings.some(
      (finding) =>
        finding.source === "tsc" ||
        finding.source === "pyright" ||
        (finding.category === "correctness" &&
          isHighSeverity(finding) &&
          finding.source !== "flow-doctor")
    );
  const testFailure =
    config.checks.correctness.enabled &&
    config.checks.correctness.failOnTestFailures &&
    failingFindings.some((finding) => finding.category === "tests" && isHighSeverity(finding));
  const regulatedIdentifierFailure =
    config.checks.privacy.enabled &&
    config.checks.privacy.failOnRegulatedIdentifiers &&
    failingFindings.some(
      (finding) =>
        finding.category === "privacy" &&
        isHighConfidence(finding) &&
        !isReviewedFalsePositive(finding) &&
        finding.evidence?.sensitivity === "regulated_identifier"
    );
  const sensitiveAttributeFailure =
    config.checks.privacy.enabled &&
    config.checks.privacy.failOnSensitiveAttributes &&
    failingFindings.some(
      (finding) =>
        finding.category === "privacy" &&
        isHighConfidence(finding) &&
        !isReviewedFalsePositive(finding) &&
        finding.evidence?.sensitivity === "high"
    );

  const dpdpFailure = evaluateDpdpFailureGate(
    scan.findings.map(findingToGateCandidate).filter((item) => item !== undefined),
    config
  );

  return secretFailure ||
    dependencyFailure ||
    missingDependencyFailure ||
    typeFailure ||
    testFailure ||
    regulatedIdentifierFailure ||
    sensitiveAttributeFailure ||
    dpdpFailure
    ? 1
    : 0;
}

export function resolveScanMode(options: { changed?: boolean; quick?: boolean; full?: boolean }): ScanMode {
  if (options.changed) {
    return "changed";
  }
  if (options.quick) {
    return "quick";
  }
  return "full";
}

export async function runScanCommand(
  root: string,
  options: {
    changed?: boolean;
    quick?: boolean;
    full?: boolean;
    category?: string;
    report?: "terminal" | "json" | "html" | "agent" | "agent-json" | "envelope";
    /** Producer version recorded in the machine envelope. */
    version?: string;
  }
): Promise<ScanCommandResult> {
  const mode = resolveScanMode(options);
  const categories = parseFindingCategoryList(options.category);
  const startedAt = new Date();
  // Fingerprint the snapshot before tools run, so the envelope names exactly what was scanned.
  const source = options.report === "envelope" ? await sourceFingerprint(root) : null;
  const scan = await runScan(root, mode);
  const filteredScan = categories ? filterScanByCategories(scan, categories) : scan;
  const { config } = await getConfig(root);
  await ensureOutputArtifacts(root, config, filteredScan);
  const exitCode = determineExitCode(filteredScan, config);

  switch (options.report) {
    case "envelope": {
      const envelope = await buildMachineEnvelope({
        scan: filteredScan,
        config,
        policy: currentPolicy(),
        version: options.version ?? "unknown",
        startedAt,
        finishedAt: new Date(),
        exitCode,
        categories: categories ?? null,
        source: source!
      });
      return { output: `${JSON.stringify(envelope)}\n`, exitCode };
    }
    case "json":
      return { output: renderJsonReport(filteredScan), exitCode };
    case "html":
      return { output: renderHtmlReport(filteredScan), exitCode };
    case "agent":
      return { output: renderAgentMarkdown(filteredScan), exitCode };
    case "agent-json":
      return { output: renderAgentJson(filteredScan), exitCode };
    default:
      return { output: renderTerminalReport(filteredScan), exitCode };
  }
}
