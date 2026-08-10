import type { DataFlowStep, EvidenceGrade, Finding, FindingRemediation, RemediationKind } from "../core/finding";
import type { ControlResult, DpdpCapabilityStatus, EvidenceItem, VerificationClass } from "./types";

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

/**
 * Maps how a control was checked onto how strongly its evidence supports the
 * claim.
 *
 * A DPDP finding could previously carry critical severity whether it came from
 * following a data path or from a variable name that looked like an identifier.
 * A readiness figure built on that mixture reads as stronger than the evidence
 * behind it, which is worse than a lower, honest one.
 */
export function evidenceGradeForControl(
  verificationClass: VerificationClass,
  primary: EvidenceItem | undefined
): EvidenceGrade {
  if (verificationClass === "DETERMINISTIC") {
    return primary?.certainty === "confirmed" ? "verified" : "observed";
  }
  if (verificationClass === "TECHNICAL_SIGNAL") {
    // A signal anchored to a real file and line was observed; one inferred from
    // shape alone is a heuristic, however plausible.
    if (primary?.certainty === "confirmed" && primary.file) {
      return "observed";
    }
    return "heuristic";
  }
  if (verificationClass === "DECLARED_EVIDENCE") {
    return "unproven";
  }
  return "unproven";
}

/**
 * Whether a control that observed nothing means the control is missing, or only
 * that static analysis could not settle the question.
 *
 * These need different responses — one is a gap to fix, the other a gap in
 * coverage — and presenting them identically is what let a readiness score imply
 * more than the scan established.
 */
export function absenceClaimForControl(
  result: ControlResult,
  capabilities: DpdpCapabilityStatus[]
): Finding["absenceClaim"] {
  if (!result.applicable || result.status === "NOT_APPLICABLE") {
    return "not_applicable";
  }

  // A scanner that did not run cannot have failed to find something.
  const unavailable = capabilities.filter((capability) => capability.status !== "available");
  if (unavailable.length > 0 && result.verificationClass === "TECHNICAL_SIGNAL") {
    return "not_statically_provable";
  }

  if (result.verificationClass === "HUMAN_REVIEW" || result.verificationClass === "DECLARED_EVIDENCE") {
    return "not_statically_provable";
  }

  return result.status === "VIOLATED" ? "control_absent" : "not_statically_provable";
}

/**
 * Classifies an evidence item's place in a data path. The mapping is by evidence
 * kind rather than by guesswork, so a step only appears when something concrete
 * was recorded at that stage.
 */
function flowKindFor(item: EvidenceItem): DataFlowStep["kind"] | undefined {
  const kind = item.kind;

  if (/collect|input|form|field|schema|request|param/i.test(kind)) {
    return "source";
  }
  if (/storage|store|cookie|database|table|column|persist|cache/i.test(kind)) {
    return "store";
  }
  if (/transfer|processor|third_party|vendor|llm|model|ai|api_call/i.test(kind)) {
    return "processor";
  }
  if (/log|export|sink|telemetry|analytics|email|report/i.test(kind)) {
    return "sink";
  }
  if (/transform|mask|redact|hash|encrypt/i.test(kind)) {
    return "transform";
  }
  return undefined;
}

const FLOW_ORDER: Record<DataFlowStep["kind"], number> = {
  source: 0,
  transform: 1,
  store: 2,
  processor: 3,
  sink: 4
};

/**
 * Assembles the data path behind a control from its own evidence items, ordered
 * source to sink. Each step carries its own grade, so a traced storage write and
 * an inferred processor hop are not presented as equally established.
 */
export function buildDataFlow(result: ControlResult, evidenceById: Map<string, EvidenceItem>): DataFlowStep[] | undefined {
  const steps: DataFlowStep[] = [];

  for (const id of result.evidenceIds) {
    const item = evidenceById.get(id);
    if (!item) {
      continue;
    }
    const kind = flowKindFor(item);
    if (!kind) {
      continue;
    }

    steps.push({
      kind,
      label: item.field ?? item.symbol ?? item.summary.slice(0, 80),
      file: item.file,
      startLine: item.line,
      evidenceGrade:
        item.certainty === "confirmed" && item.file ? "observed" : item.certainty === "declared" ? "unproven" : "heuristic",
      detail: item.summary
    });
  }

  if (steps.length < 2) {
    // A single step is not a path; the finding's own location already says where
    // it is, and calling one point a "flow" would overstate the evidence.
    return undefined;
  }

  return steps.sort((left, right) => FLOW_ORDER[left.kind] - FLOW_ORDER[right.kind]);
}

/**
 * Works out what kind of change a remediation actually is, so the finding
 * reaches whoever can act on it rather than defaulting to an engineer.
 */
export function remediationForControl(result: ControlResult): FindingRemediation | undefined {
  if (!result.remediation) {
    return undefined;
  }

  // Domains whose controls are satisfied by a documented decision or process
  // rather than by code. Routing these to an engineer produces a task nobody can
  // close.
  const policyDomains = new Set<ControlResult["domain"]>([
    "grievance_handling",
    "nomination",
    "significant_data_fiduciary",
    "exemptions_and_applicability",
    "breach_preparedness",
    "notice"
  ]);

  const kind: RemediationKind =
    result.verificationClass === "HUMAN_REVIEW" || result.verificationClass === "DECLARED_EVIDENCE"
      ? "human_review"
      : policyDomains.has(result.domain)
        ? "policy"
        : /config|setting|environment|flag|header|policy file/i.test(result.remediation)
          ? "config"
          : "code";

  return {
    kind,
    component: result.controlId,
    steps: [result.remediation, ...(result.humanReviewQuestion ? [`Confirm with an owner: ${result.humanReviewQuestion}`] : [])],
    requiredEvidence:
      result.verificationClass === "DETERMINISTIC"
        ? "A rerun of `vibedoctor dpdp scan` showing this control verified."
        : result.verificationClass === "TECHNICAL_SIGNAL"
          ? "Code changes plus a rerun, or a declared-evidence entry recording the decision."
          : `A signed-off entry in the declared-evidence file (${result.controlId}).`,
    requiresHumanDecision: kind === "human_review" || kind === "policy"
  };
}

export function controlResultsToFindings(
  results: ControlResult[],
  evidenceById: Map<string, EvidenceItem>,
  capabilities: DpdpCapabilityStatus[] = []
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
    const evidenceGrade = evidenceGradeForControl(result.verificationClass, primary);
    const absenceClaim = absenceClaimForControl(result, capabilities);
    const dataFlow = buildDataFlow(result, evidenceById);

    // State the strength of the claim in the message itself. A reader scanning a
    // list should not have to open the JSON to learn that a "critical" item rests
    // on a naming heuristic.
    const gradeNote =
      evidenceGrade === "verified"
        ? "Verified from code."
        : evidenceGrade === "observed"
          ? "Observed at a specific location; its meaning is inferred."
          : evidenceGrade === "heuristic"
            ? "Heuristic signal: inferred from names or shape, not from a traced code path."
            : "Not established from code; needs human confirmation.";

    const absenceNote =
      absenceClaim === "not_statically_provable"
        ? " This scan could not prove the control is absent, only that it was not observed."
        : "";

    findings.push({
      id: `dpdp:${result.controlId}:${result.status}:${primary?.file ?? "repo"}:${primary?.line ?? 0}`,
      source: "dpdp",
      category: "privacy",
      severity,
      confidence: result.confidence,
      title: `DPDP ${result.status}: ${result.title}`,
      message: `${result.explanation} ${gradeNote}${absenceNote}`,
      file: primary?.file,
      startLine: primary?.line,
      isNew: result.isNew,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: result.remediation,
      evidenceGrade,
      absenceClaim,
      dataFlow,
      remediation: remediationForControl(result),
      tags: [
        "dpdp",
        result.controlId,
        result.domain,
        result.status.toLowerCase(),
        result.verificationClass.toLowerCase(),
        `evidence:${evidenceGrade}`
      ],
      evidence: {
        detector: "dpdp",
        // Always set snippet so fingerprints prefer content hash over line number
        snippet,
        fieldPath: primary?.field,
        matchedPattern: result.controlId,
        detectionPath: result.verificationClass,
        reasons: [
          result.explanation,
          gradeNote,
          ...(absenceClaim === "not_statically_provable"
            ? ["Absence of the control was not proven; it was not observed."]
            : []),
          ...(result.limitations ?? [])
        ],
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
