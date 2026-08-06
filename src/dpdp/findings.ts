import type { Finding } from "../core/finding";
import type { ControlResult, EvidenceItem } from "./types";

const STATUS_TO_INCLUDE = new Set(["VIOLATED", "PARTIAL", "ERROR"]);

/**
 * Build a stable, masked snippet for fingerprinting.
 * When present, fingerprintFinding omits startLine so line-only moves do not thrash baselines.
 */
export function stableDpdpFindingSnippet(
  result: ControlResult,
  primary: EvidenceItem | undefined
): string {
  return [
    result.controlId,
    result.status,
    primary?.file ?? "repo",
    primary?.field ?? primary?.symbol ?? "",
    // Prefer classified summary over free-form explanation drift where possible
    primary?.summary ?? result.explanation
  ]
    .join("|")
    .slice(0, 400);
}

export function controlResultsToFindings(
  results: ControlResult[],
  evidenceById: Map<string, EvidenceItem>
): Finding[] {
  const findings: Finding[] = [];

  for (const result of results) {
    if (!STATUS_TO_INCLUDE.has(result.status)) {
      continue;
    }

    const primary = result.evidenceIds.map((id) => evidenceById.get(id)).find(Boolean);
    const severity =
      result.status === "VIOLATED"
        ? result.severity
        : result.status === "ERROR"
          ? "medium"
          : result.severity === "critical"
            ? "high"
            : result.severity;

    const snippet = primary?.snippet ?? stableDpdpFindingSnippet(result, primary);

    findings.push({
      id: `dpdp:${result.controlId}:${result.status}:${primary?.file ?? "repo"}:${primary?.line ?? 0}`,
      source: "dpdp",
      category: "privacy",
      severity,
      confidence: result.confidence,
      title: `DPDP ${result.status}: ${result.title}`,
      message: result.explanation,
      file: primary?.file,
      startLine: primary?.line,
      isNew: result.isNew,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: result.remediation,
      tags: ["dpdp", result.controlId, result.domain, result.status.toLowerCase(), result.verificationClass.toLowerCase()],
      evidence: {
        detector: "dpdp",
        // Always set snippet so fingerprints prefer content hash over line number
        snippet,
        fieldPath: primary?.field,
        matchedPattern: result.controlId,
        detectionPath: result.verificationClass,
        reasons: [result.explanation, ...(result.limitations ?? [])],
        recommendedAction: result.remediation,
        rationale: result.humanReviewQuestion,
        entityType: primary?.dataCategory,
        sensitivity:
          result.severity === "critical" || result.severity === "high"
            ? result.severity === "critical"
              ? "regulated_identifier"
              : "high"
            : "moderate"
      },
      scoreImpact: 0
    });
  }

  return findings;
}

/**
 * Sync control `isNew` from baselined findings.
 * Controls without a finding (not VIOLATED/PARTIAL/ERROR) keep isNew=false after baseline is applied
 * so they do not look like "new issues" in matrices.
 */
export function syncControlIsNewFromFindings(
  controls: ControlResult[],
  findings: Finding[],
  baselineEnabled: boolean
): ControlResult[] {
  if (!baselineEnabled) {
    return controls;
  }

  const findingByControl = new Map<string, Finding>();
  for (const finding of findings) {
    const controlId = finding.tags.find((tag) => tag.startsWith("DPDP-"));
    if (controlId) {
      findingByControl.set(controlId, finding);
    }
  }

  return controls.map((result) => {
    const finding = findingByControl.get(result.controlId);
    if (finding) {
      return { ...result, isNew: finding.isNew };
    }
    // No open finding for this control → not a new open issue
    return { ...result, isNew: false };
  });
}
