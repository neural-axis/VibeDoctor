import { runScan } from "../../core/engine";
import type { VibeDoctorConfig } from "../../core/config";
import { parseFindingCategoryList, type Finding } from "../../core/finding";
import { filterScanByCategories, type ScanOutput } from "../../core/engine";
import { renderTerminalReport } from "../../reporters/terminal";
import { renderJsonReport } from "../../reporters/json";
import { renderHtmlReport } from "../../reporters/html";
import { renderAgentJson, renderAgentMarkdown } from "../../reporters/agent";
import { ensureOutputArtifacts, getConfig } from "./shared";

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
      (finding) => ["tsc", "pyright"].includes(finding.source) || (finding.category === "correctness" && isHighSeverity(finding))
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

  return secretFailure ||
    dependencyFailure ||
    missingDependencyFailure ||
    typeFailure ||
    testFailure ||
    regulatedIdentifierFailure ||
    sensitiveAttributeFailure
    ? 1
    : 0;
}

export async function runScanCommand(
  root: string,
  options: {
    changed?: boolean;
    quick?: boolean;
    full?: boolean;
    category?: string;
    report?: "terminal" | "json" | "html" | "agent" | "agent-json";
  }
): Promise<ScanCommandResult> {
  const mode = options.changed ? "changed" : options.quick ? "quick" : options.full ? "full" : "default";
  const scan = await runScan(root, mode);
  const categories = parseFindingCategoryList(options.category);
  const filteredScan = categories ? filterScanByCategories(scan, categories) : scan;
  const { config } = await getConfig(root);
  await ensureOutputArtifacts(root, config, filteredScan);
  const exitCode = determineExitCode(filteredScan, config);

  switch (options.report) {
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
