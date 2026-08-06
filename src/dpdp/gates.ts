import type { VibeDoctorConfig } from "../core/config";
import type { Finding, Severity } from "../core/finding";
import type { ControlResult, ControlStatus, VerificationClass } from "./types";

export type DpdpGateCandidate = {
  controlId: string;
  status: ControlStatus;
  severity: Severity;
  verificationClass: VerificationClass;
  isNew: boolean;
};

export function controlToGateCandidate(control: ControlResult): DpdpGateCandidate {
  return {
    controlId: control.controlId,
    status: control.status,
    severity: control.severity,
    verificationClass: control.verificationClass,
    isNew: control.isNew
  };
}

export function findingToGateCandidate(finding: Finding): DpdpGateCandidate | undefined {
  if (finding.source !== "dpdp") {
    return undefined;
  }
  const controlId = finding.tags.find((tag) => tag.startsWith("DPDP-"));
  const statusTag = finding.tags.find((tag) => ["violated", "partial", "error"].includes(tag));
  const verificationTag = finding.tags.find((tag) =>
    ["deterministic", "technical_signal", "declared_evidence", "human_review"].includes(tag)
  );
  if (!controlId || !statusTag || !verificationTag) {
    return undefined;
  }
  return {
    controlId,
    status: statusTag.toUpperCase() as ControlStatus,
    severity: finding.severity,
    verificationClass: verificationTag.toUpperCase() as VerificationClass,
    isNew: finding.isNew
  };
}

/** Shared CI policy for dedicated and normal DPDP scan entry points. */
export function evaluateDpdpFailureGate(
  candidates: DpdpGateCandidate[],
  config: VibeDoctorConfig
): boolean {
  const dpdp = config.checks.dpdp;
  if (!dpdp.enabled) {
    return false;
  }

  const eligible = candidates.filter((candidate) => (dpdp.failOnlyOnNew ? candidate.isNew : true));
  if (
    eligible.some(
      (candidate) =>
        candidate.status === "VIOLATED" && dpdp.failOnViolatedControls.includes(candidate.controlId)
    )
  ) {
    return true;
  }

  const severities = new Set(dpdp.failOnSeverity);
  return eligible.some(
    (candidate) =>
      (candidate.status === "VIOLATED" || candidate.status === "PARTIAL") &&
      candidate.verificationClass === "DETERMINISTIC" &&
      severities.has(candidate.severity)
  );
}
