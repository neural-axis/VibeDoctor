import type { Severity } from "../core/finding";
import { getControlById } from "./catalogue";
import type { ControlResult, ControlStatusCounts, DpdpCapabilityStatus, DpdpScores } from "./types";

/**
 * Controls that expect an implementation signal when personal data is processed.
 * NOT_OBSERVED on these is weak posture (missing expected control), not a clean bill of health.
 */
export const POSITIVE_CONTROL_EVALUATORS = new Set([
  "notice-signals",
  "consent-capture",
  "consent-metadata",
  "consent-withdrawal",
  "purpose-binding",
  "retention-mechanism",
  "erasure-path",
  "access-export",
  "correction-path",
  "grievance-handling",
  "nomination-signal",
  "rights-request-tracking",
  "breach-preparedness",
  "audit-signals",
  "guardian-consent",
  "childrens-data"
]);

/**
 * Gap / anti-pattern detectors. NOT_OBSERVED means no gap was seen (good, with uncertainty).
 */
export const GAP_CONTROL_EVALUATORS = new Set([
  "api-overfetch",
  "broad-db-select",
  "pii-in-logs",
  "pii-in-llm",
  "pii-in-urls",
  "browser-storage-pii",
  "insecure-http",
  "route-auth",
  "hardcoded-pii",
  "debug-exposure",
  "weak-masking",
  "unprotected-export",
  "third-party-user-object",
  "storage-without-deletion"
]);

export function isPositiveControl(control: ControlResult): boolean {
  const definition = getControlById(control.controlId);
  const evaluatorId = definition?.evaluatorId;
  if (!evaluatorId) {
    return false;
  }
  return POSITIVE_CONTROL_EVALUATORS.has(evaluatorId);
}

export function isGapControl(control: ControlResult): boolean {
  const definition = getControlById(control.controlId);
  const evaluatorId = definition?.evaluatorId;
  if (!evaluatorId) {
    return false;
  }
  return GAP_CONTROL_EVALUATORS.has(evaluatorId);
}

export function countStatuses(controls: ControlResult[]): ControlStatusCounts {
  const counts: ControlStatusCounts = {
    verified: 0,
    violated: 0,
    partial: 0,
    notObserved: 0,
    needsContext: 0,
    notApplicable: 0,
    skipped: 0,
    error: 0,
    humanReview: 0,
    unresolved: 0
  };

  for (const control of controls) {
    switch (control.status) {
      case "VERIFIED":
        counts.verified += 1;
        break;
      case "VIOLATED":
        counts.violated += 1;
        break;
      case "PARTIAL":
        counts.partial += 1;
        break;
      case "NOT_OBSERVED":
        counts.notObserved += 1;
        break;
      case "NEEDS_CONTEXT":
        counts.needsContext += 1;
        break;
      case "NOT_APPLICABLE":
        counts.notApplicable += 1;
        break;
      case "SKIPPED":
        counts.skipped += 1;
        break;
      case "ERROR":
        counts.error += 1;
        break;
      default:
        break;
    }

    if (control.verificationClass === "HUMAN_REVIEW" || control.status === "NEEDS_CONTEXT") {
      counts.humanReview += 1;
    }
  }

  // Unresolved = needs attention: violated + partial + needs_context + error
  counts.unresolved = counts.violated + counts.partial + counts.needsContext + counts.error;
  return counts;
}

/**
 * Whether the scanners a control depends on actually ran.
 *
 * "Nothing bad was found" and "nothing looked" produce the same control status,
 * and a gap detector's silence was credited at 0.85 either way. That let a
 * posture score climb because a scanner was missing, which is exactly backwards.
 */
export function hasSupportingCoverage(capabilities: DpdpCapabilityStatus[]): boolean {
  const optional = capabilities.filter((capability) => capability.id === "presidio" || capability.id === "semgrep");
  if (optional.length === 0) {
    return true;
  }
  return optional.some((capability) => capability.status === "available");
}

/** Points contributed by one control status toward technical posture (0–1). */
export function posturePointsForControl(control: ControlResult, coverageComplete = true): number {
  switch (control.status) {
    case "VERIFIED":
      return 1;
    case "PARTIAL":
      return 0.5;
    case "VIOLATED":
      return 0;
    case "ERROR":
      return 0.15;
    case "NEEDS_CONTEXT":
      return 0.4;
    case "NOT_OBSERVED":
      // Positive controls missing expected signals: low credit.
      // Gap detectors with no bad pattern: mostly good (not VERIFIED).
      if (isPositiveControl(control)) {
        return 0.25;
      }
      if (isGapControl(control)) {
        // Silence only earns credit when something was actually looking. Without
        // the supporting scanners it is an unknown, scored like NEEDS_CONTEXT.
        return coverageComplete ? 0.85 : 0.4;
      }
      // Inventory, processors, cross-border, SDF, etc. — neutral-good silence
      return coverageComplete ? 0.7 : 0.4;
    default:
      return 0.5;
  }
}

/**
 * Technical posture score from applicable technically observable controls only.
 * NOT a legal compliance percentage.
 *
 * Scoring table:
 * - VERIFIED 1.0 · PARTIAL 0.5 · VIOLATED 0.0 · ERROR 0.15 · NEEDS_CONTEXT 0.4
 * - NOT_OBSERVED: 0.25 (positive control), 0.85 (gap detector), 0.7 (other)
 * - When supporting scanners did not run, unobserved controls score 0.4 instead,
 *   because their silence carries no information.
 */
export function computeTechnicalPostureScore(controls: ControlResult[], capabilities: DpdpCapabilityStatus[] = []): number {
  const observable = controls.filter(
    (control) =>
      control.applicable &&
      control.status !== "NOT_APPLICABLE" &&
      control.status !== "SKIPPED" &&
      (control.verificationClass === "DETERMINISTIC" || control.verificationClass === "TECHNICAL_SIGNAL")
  );

  if (observable.length === 0) {
    return 100;
  }

  const coverageComplete = hasSupportingCoverage(capabilities);

  let points = 0;
  for (const control of observable) {
    points += posturePointsForControl(control, coverageComplete);
  }

  return Math.max(0, Math.min(100, Math.round((points / observable.length) * 100)));
}

/**
 * Evidence completeness: share of applicable controls that have evidence or are verified/violated/partial.
 */
export function computeEvidenceCompleteness(controls: ControlResult[]): number {
  const applicable = controls.filter(
    (control) => control.applicable && control.status !== "NOT_APPLICABLE" && control.status !== "SKIPPED"
  );
  if (applicable.length === 0) {
    return 100;
  }

  const withEvidence = applicable.filter(
    (control) =>
      control.evidenceIds.length > 0 ||
      control.status === "VERIFIED" ||
      control.status === "VIOLATED" ||
      control.status === "PARTIAL"
  );
  return Math.round((withEvidence.length / applicable.length) * 100);
}

export function openRiskBySeverity(controls: ControlResult[]): Record<Severity, number> {
  const counts: Record<Severity, number> = {
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    info: 0
  };

  for (const control of controls) {
    if (control.status === "VIOLATED" || control.status === "PARTIAL" || control.status === "ERROR") {
      counts[control.severity] += 1;
    }
  }
  return counts;
}

export function buildDpdpScores(controls: ControlResult[], capabilities: DpdpCapabilityStatus[] = []): DpdpScores {
  const coverageComplete = hasSupportingCoverage(capabilities);
  const missing = capabilities
    .filter((capability) => capability.status !== "available")
    .map((capability) => capability.id);

  return {
    technicalPostureScore: computeTechnicalPostureScore(controls, capabilities),
    evidenceCompletenessPercent: computeEvidenceCompleteness(controls),
    openRiskBySeverity: openRiskBySeverity(controls),
    statusCounts: countStatuses(controls),
    labels: {
      technicalPosture: coverageComplete
        ? "DPDP technical posture (not legal compliance)"
        : `DPDP technical posture — reduced coverage, ${missing.join(" and ")} did not run (not legal compliance)`,
      evidenceCompleteness: "Evidence completeness (technical observability)",
      openRisk: "Open technical risk counts by severity"
    }
  };
}
