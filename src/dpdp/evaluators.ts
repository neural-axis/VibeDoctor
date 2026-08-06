import type { Confidence, Severity } from "../core/finding";
import { getControlById, DPDP_CONTROLS } from "./catalogue";
import type {
  ControlDefinition,
  ControlResult,
  ControlStatus,
  DeclaredAssertion,
  DpdpContext,
  EvidenceItem,
  TechnicalSignalBag,
  VerificationClass
} from "./types";

export type EvaluationContext = {
  signals: TechnicalSignalBag[];
  evidence: EvidenceItem[];
  context: DpdpContext;
  declared: DeclaredAssertion[];
  capabilities: Array<{ id: string; status: "available" | "skipped" | "error"; message?: string }>;
};

function hasTag(signals: TechnicalSignalBag[], tag: string): TechnicalSignalBag[] {
  return signals.filter((signal) => signal.tags.includes(tag));
}

function hasKind(signals: TechnicalSignalBag[], kind: string): TechnicalSignalBag[] {
  return signals.filter((signal) => signal.kind === kind);
}

function personalDataPresent(signals: TechnicalSignalBag[]): boolean {
  return (
    signals.some((signal) => signal.category && signal.category !== "unknown") ||
    hasTag(signals, "privacy-detector").length > 0 ||
    hasTag(signals, "pii-store").length > 0 ||
    hasKind(signals, "collection").length > 0 ||
    hasKind(signals, "storage").length > 0
  );
}

function confidenceFromSignals(matches: TechnicalSignalBag[]): Confidence {
  if (matches.some((item) => item.confidence === "high")) {
    return "high";
  }
  if (matches.some((item) => item.confidence === "medium")) {
    return "medium";
  }
  return matches.length > 0 ? "low" : "low";
}

function resultFor(
  control: ControlDefinition,
  status: ControlStatus,
  matches: TechnicalSignalBag[],
  explanation: string,
  options: { severity?: Severity; remediation?: string; question?: string; applicable?: boolean } = {}
): ControlResult {
  const applicable = options.applicable ?? true;
  let severity: Severity = control.severityRules.defaultSeverity;
  if (status === "VIOLATED") {
    severity = options.severity ?? control.severityRules.violatedSeverity;
  } else if (status === "PARTIAL") {
    severity = options.severity ?? control.severityRules.partialSeverity ?? control.severityRules.defaultSeverity;
  } else if (status === "VERIFIED") {
    severity = "info";
  }

  return {
    controlId: control.id,
    title: control.title,
    domain: control.domain,
    status,
    verificationClass: control.verificationClass,
    confidence: matches.length > 0 ? confidenceFromSignals(matches) : status === "NEEDS_CONTEXT" ? "low" : "medium",
    severity,
    evidenceIds: matches.map((item) => item.id),
    explanation,
    limitations: control.limitations,
    remediation: status === "VERIFIED" || status === "NOT_APPLICABLE" ? undefined : options.remediation ?? control.remediation,
    humanReviewQuestion:
      status === "NEEDS_CONTEXT" || status === "PARTIAL" || control.verificationClass === "HUMAN_REVIEW"
        ? options.question ?? control.humanReviewQuestions[0]
        : options.question,
    isNew: true,
    applicable
  };
}

function notApplicable(control: ControlDefinition, reason: string): ControlResult {
  return resultFor(control, "NOT_APPLICABLE", [], reason, { applicable: false });
}

function needsContext(control: ControlDefinition, reason: string, matches: TechnicalSignalBag[] = []): ControlResult {
  return resultFor(control, "NEEDS_CONTEXT", matches, reason);
}

function evaluateInventory(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = [
    ...hasTag(ctx.signals, "privacy-detector"),
    ...hasKind(ctx.signals, "storage"),
    ...hasKind(ctx.signals, "collection"),
    ...hasKind(ctx.signals, "external")
  ];
  if (matches.length === 0) {
    if (ctx.context.organization.processesPersonalData === "true") {
      return resultFor(control, "PARTIAL", [], "Organisation declares personal-data processing but code inventory found no signals.");
    }
    if (ctx.context.organization.processesPersonalData === "false") {
      return resultFor(control, "NOT_OBSERVED", [], "No personal-data signals observed; organisation declares no personal-data processing.");
    }
    return resultFor(control, "NOT_OBSERVED", [], "No personal-data processing signals observed in scanned paths.");
  }
  return resultFor(control, "VERIFIED", matches, `Observed ${matches.length} personal-data inventory signal(s).`);
}

function evaluateConsentCapture(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals; consent capture not applicable from code.");
  }
  const matches = hasTag(ctx.signals, "consent-capture");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "Personal data appears present but no consent capture implementation signal was found.");
  }
  return resultFor(control, "PARTIAL", matches, "Consent capture signals found; legal adequacy of consent requires human review.");
}

function evaluateConsentMetadata(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const consent = hasTag(ctx.signals, "consent-capture");
  if (consent.length === 0) {
    return notApplicable(control, "No consent capture signals to evaluate metadata against.");
  }
  const meta = hasTag(ctx.signals, "consent-metadata");
  if (meta.length === 0) {
    return resultFor(control, "VIOLATED", consent, "Consent capture exists but consent timestamp/purpose/notice metadata was not observed.");
  }
  const hasTs = meta.some((item) => item.tags.includes("has-timestamp"));
  const hasPurpose = meta.some((item) => item.tags.includes("has-purpose"));
  const hasNotice = meta.some((item) => item.tags.includes("has-notice"));
  if (hasTs && hasPurpose && hasNotice) {
    return resultFor(control, "VERIFIED", meta, "Consent metadata signals include timestamp, purpose, and notice version.");
  }
  if (hasTs || hasPurpose || hasNotice) {
    return resultFor(
      control,
      "PARTIAL",
      meta,
      `Consent metadata incomplete (timestamp=${hasTs}, purpose=${hasPurpose}, notice=${hasNotice}).`
    );
  }
  return resultFor(control, "VIOLATED", meta, "Consent-related fields found without complete metadata markers.");
}

function evaluateWithdrawal(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals) && hasTag(ctx.signals, "consent-capture").length === 0) {
    return notApplicable(control, "No personal-data or consent signals observed.");
  }
  const matches = hasTag(ctx.signals, "consent-withdrawal");
  if (matches.length === 0) {
    if (hasTag(ctx.signals, "consent-capture").length > 0) {
      return resultFor(control, "VIOLATED", hasTag(ctx.signals, "consent-capture"), "Consent capture observed without withdrawal path signals.");
    }
    return resultFor(control, "NOT_OBSERVED", [], "No consent withdrawal implementation signal observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Withdrawal signals observed; ease-of-use and processor propagation need human review.");
}

function evaluateNotice(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "notice-signal");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No privacy notice / notice_version technical signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Notice technical signals present; content adequacy is human-reviewed.");
}

function evaluatePurpose(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "purpose-binding");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No purpose identifier binding signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Purpose identifiers observed; purpose limitation enforcement needs review.");
}

function evaluateBinaryGap(
  control: ControlDefinition,
  ctx: EvaluationContext,
  tag: string,
  violatedMessage: string,
  cleanMessage: string
): ControlResult {
  if (!personalDataPresent(ctx.signals) && tag !== "hardcoded") {
    // still evaluate hardcoded pii and some safeguards from privacy findings alone
  }
  const matches = hasTag(ctx.signals, tag);
  if (matches.length > 0) {
    return resultFor(control, "VIOLATED", matches, violatedMessage);
  }
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals; control not applicable from scanned code.");
  }
  return resultFor(control, "NOT_OBSERVED", [], cleanMessage);
}

function evaluatePiiInLogs(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "pii-in-logs",
    "Unsanitized personal-data logging signals detected.",
    "No unsanitized PII-in-logs signals observed (not a proof of absence)."
  );
}

function evaluatePiiInLlm(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "pii-in-llm");
  if (matches.length > 0) {
    return resultFor(control, "VIOLATED", matches, "Personal data appears in LLM prompt/embedding paths.");
  }
  const llmPresent = ctx.signals.some((signal) => signal.tags.includes("llm") || /llm provider/i.test(signal.summary));
  if (!llmPresent) {
    return notApplicable(control, "No LLM provider signals observed.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "LLM integrations present; no direct PII-in-prompt signals observed.");
}

function evaluateApiOverfetch(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "api-overfetch",
    "API handlers appear to serialise whole user/customer entities.",
    "No API over-fetch patterns observed."
  );
}

function evaluateBroadSelect(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "broad-db-select",
    "Broad database selection patterns on personal-data models detected.",
    "No broad personal-data select patterns observed."
  );
}

function evaluateBrowserStorage(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "browser-storage",
    "Browser storage used near personal-data keywords.",
    "No browser-storage personal-data signals observed."
  );
}

function evaluateInsecureHttp(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "insecure-http",
    "Cleartext HTTP URLs observed near personal-data context.",
    "No cleartext HTTP personal-data transport signals observed."
  );
}

function evaluatePiiInUrls(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "pii-in-urls",
    "Personal data identifiers appear in URL/query handling.",
    "No query-string personal-data signals observed."
  );
}

/**
 * Only value-literal (or seed/fixture path) detections count as hardcoded production PII.
 * Field-name / schema metadata alone must not flip this control to VIOLATED.
 */
export function isHardcodedLiteralSignal(signal: TechnicalSignalBag): boolean {
  if (signal.tags.includes("field-metadata") && !signal.tags.includes("value-literal")) {
    return false;
  }
  if (signal.tags.includes("value-literal")) {
    return true;
  }
  if (/-regex|luhn|checksum/i.test(signal.detectionMethod)) {
    return true;
  }
  // Seed/fixture path with high-confidence privacy hit still needs a value-style pattern
  if (signal.tags.includes("fixture-path") && /regex|value|literal/i.test(signal.detectionMethod)) {
    return true;
  }
  return false;
}

function evaluateHardcodedPii(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const categories = new Set(["aadhaar", "pan", "passport", "financial_payment", "email", "phone"]);
  const matches = ctx.signals.filter(
    (signal) =>
      signal.provenance === "privacy-detector" &&
      signal.category &&
      categories.has(signal.category) &&
      isHardcodedLiteralSignal(signal) &&
      (signal.confidence === "high" || signal.certainty === "confirmed")
  );
  if (matches.length > 0) {
    return resultFor(
      control,
      "VIOLATED",
      matches,
      "High-confidence personal data values (literals) appear embedded in source or fixtures."
    );
  }
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals; hardcoded value check not applicable.");
  }
  return resultFor(
    control,
    "NOT_OBSERVED",
    [],
    "No high-confidence hardcoded personal-data value literals observed (field/schema names alone do not count)."
  );
}

function evaluateDebugExposure(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "debug-exposure",
    "Debug/dump endpoints may expose personal records.",
    "No debug personal-data exposure signals observed."
  );
}

function evaluateWeakMasking(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "weak-masking");
  if (matches.length > 0) {
    return resultFor(control, "PARTIAL", matches, "Potentially weak masking helpers detected.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "No weak masking patterns observed.");
}

function evaluateRouteAuth(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "missing-route-auth");
  if (matches.length > 0) {
    return resultFor(control, "PARTIAL", matches, "Personal-data routes without nearby authentication signals.");
  }
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "No missing-auth route signals observed; global guards may still apply.");
}

function evaluateAudit(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "missing-audit");
  if (matches.length > 0) {
    return resultFor(control, "PARTIAL", matches, "Sensitive operations without nearby audit signals.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "No missing-audit signals observed.");
}

function evaluateRetention(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const stores = hasTag(ctx.signals, "pii-store");
  if (stores.length === 0 && !personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data stores observed.");
  }
  const retention = hasTag(ctx.signals, "retention-present");
  const missing = hasTag(ctx.signals, "missing-retention");
  if (missing.length > 0 && retention.length === 0) {
    return resultFor(control, "VIOLATED", missing, "Personal-data stores without retention/TTL/soft-delete fields.");
  }
  if (retention.length > 0 && missing.length > 0) {
    return resultFor(control, "PARTIAL", [...retention, ...missing], "Some stores have retention signals; others do not.");
  }
  if (retention.length > 0) {
    return resultFor(control, "PARTIAL", retention, "Retention/TTL signals present; policy alignment needs human review.");
  }
  if (stores.length > 0) {
    return resultFor(control, "VIOLATED", stores, "Personal-data storage observed without retention mechanism signals.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "No retention mechanism evaluation inputs found.");
}

function evaluateErasure(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "erasure-path");
  if (matches.length === 0) {
    return resultFor(control, "VIOLATED", hasTag(ctx.signals, "pii-store"), "Personal data appears stored without erasure/account-deletion path signals.");
  }
  return resultFor(control, "PARTIAL", matches, "Erasure path signals found; backup/processor cascade needs review.");
}

function evaluateStorageWithoutDeletion(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const stores = [...hasTag(ctx.signals, "pii-store"), ...hasKind(ctx.signals, "storage")];
  const deletions = hasTag(ctx.signals, "erasure-path");
  const retention = hasTag(ctx.signals, "retention-present");
  if (stores.length === 0) {
    return notApplicable(control, "No personal-data stores observed.");
  }
  if (deletions.length === 0 && retention.length === 0) {
    return resultFor(control, "VIOLATED", stores, "Personal-data storage without visible deletion or TTL path.");
  }
  if (deletions.length === 0) {
    return resultFor(control, "PARTIAL", [...stores, ...retention], "Retention fields present but no deletion path signals.");
  }
  return resultFor(control, "PARTIAL", [...stores, ...deletions], "Stores and deletion signals both present; completeness needs review.");
}

function evaluateAccessExport(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "access-export");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No data access/export endpoint signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Access/export signals found; package completeness needs review.");
}

function evaluateCorrection(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "correction-path");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No correction/update path signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Correction/update signals found; processor propagation needs review.");
}

function evaluateGrievance(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "grievance");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No grievance/privacy-contact technical signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Grievance/contact signals found; operational SLAs need human review.");
}

function evaluateNomination(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "nomination");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No nomination implementation signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Nomination signals found; legal applicability needs confirmation.");
}

function evaluateChildren(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const orgChildren = ctx.context.organization.processesChildrenData;
  const matches = hasTag(ctx.signals, "childrens-data");
  if (orgChildren === "false" && matches.length === 0) {
    return notApplicable(control, "Organisation declares no children's data processing and no signals observed.");
  }
  if (matches.length === 0) {
    if (orgChildren === "true") {
      return resultFor(control, "PARTIAL", [], "Organisation declares children's data processing but no age-gate signals observed.");
    }
    return resultFor(control, "NOT_OBSERVED", [], "No children's data signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Children's data / age signals observed; verification strength needs review.");
}

function evaluateGuardian(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const childSignals = hasTag(ctx.signals, "childrens-data");
  const guardian = hasTag(ctx.signals, "guardian-consent");
  if (childSignals.length === 0 && ctx.context.organization.processesChildrenData !== "true") {
    return notApplicable(control, "No children's data processing signals.");
  }
  if (guardian.length === 0) {
    return resultFor(
      control,
      "VIOLATED",
      childSignals,
      "Children's data signals present without guardian/parental consent implementation signals."
    );
  }
  return resultFor(control, "PARTIAL", guardian, "Guardian consent signals found; identity verification needs human review.");
}

function evaluateProcessors(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasKind(ctx.signals, "external");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No external processor SDK/manifest signals observed.");
  }
  return resultFor(control, "VERIFIED", matches, `Observed ${matches.length} external recipient/processor technical signal(s).`);
}

function evaluateCrossBorder(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "cross-border");
  const external = hasKind(ctx.signals, "external");
  if (ctx.context.organization.hasCrossBorderTransfer === "false" && matches.length === 0) {
    return notApplicable(control, "Organisation declares no cross-border transfer and no region signals observed.");
  }
  if (matches.length > 0) {
    return resultFor(control, "PARTIAL", matches, "Cross-border/region configuration signals observed.");
  }
  if (external.length > 0) {
    return resultFor(control, "PARTIAL", external, "External services present; transfer geography not fully determined from code.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "No cross-border technical signals observed.");
}

function evaluateBreach(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (!personalDataPresent(ctx.signals)) {
    return notApplicable(control, "No personal-data signals observed.");
  }
  const matches = hasTag(ctx.signals, "breach-preparedness");
  if (matches.length === 0) {
    return resultFor(control, "NOT_OBSERVED", [], "No breach/incident technical signals observed.");
  }
  return resultFor(control, "PARTIAL", matches, "Breach-related signals found; operational readiness needs human review.");
}

function evaluateRightsTracking(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const rights = [...hasTag(ctx.signals, "access-export"), ...hasTag(ctx.signals, "correction-path"), ...hasTag(ctx.signals, "erasure-path")];
  if (rights.length === 0) {
    return notApplicable(control, "No rights endpoints observed to evaluate tracking against.");
  }
  const tracking = hasTag(ctx.signals, "rights-tracking");
  if (tracking.length === 0) {
    return resultFor(control, "PARTIAL", rights, "Rights endpoints found without request tracking signals.");
  }
  return resultFor(control, "PARTIAL", [...rights, ...tracking], "Rights tracking signals present; identity proofing needs review.");
}

function evaluateUnprotectedExport(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const matches = hasTag(ctx.signals, "unprotected-export");
  if (matches.length > 0) {
    return resultFor(control, "VIOLATED", matches, "Export/access endpoints without nearby authentication signals.");
  }
  if (hasTag(ctx.signals, "access-export").length === 0) {
    return notApplicable(control, "No export endpoints observed.");
  }
  return resultFor(control, "NOT_OBSERVED", [], "Export endpoints present; no missing-auth export signals observed.");
}

function evaluateThirdPartyUserObject(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  return evaluateBinaryGap(
    control,
    ctx,
    "third-party-user-object",
    "Whole user/profile objects may be sent to third-party SDKs.",
    "No whole-user third-party shipment patterns observed."
  );
}

function evaluateSdf(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  if (ctx.context.organization.isSignificantDataFiduciary === "false") {
    return notApplicable(control, "Organisation declares it is not a Significant Data Fiduciary.");
  }
  const dpo = hasTag(ctx.signals, "grievance").filter((item) => /dpo|data protection officer/i.test(item.summary));
  if (ctx.context.organization.isSignificantDataFiduciary === "true") {
    if (dpo.length === 0) {
      return resultFor(control, "PARTIAL", [], "SDF declared; limited technical DPO/audit signals observed.");
    }
    return resultFor(control, "PARTIAL", dpo, "SDF declared with some technical signals; audits/DPIA need human evidence.");
  }
  return needsContext(control, "Significant Data Fiduciary status is unknown; cannot verify Section 10 technical obligations from code alone.");
}

function evaluateHumanReview(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const relatedDeclared = ctx.declared.filter((item) => item.relatedControls.includes(control.id));
  if (relatedDeclared.length > 0) {
    return resultFor(
      control,
      "NEEDS_CONTEXT",
      [],
      `Declared evidence present (${relatedDeclared.map((item) => item.id).join(", ")}) but not deterministic verification.`,
      { question: control.humanReviewQuestions[0] }
    );
  }
  return needsContext(control, control.humanReviewQuestions[0] ?? "Human/organisational review required.");
}

function evaluateDeclaredEvidence(control: ControlDefinition, ctx: EvaluationContext): ControlResult {
  const related = ctx.declared.filter((item) => item.relatedControls.includes(control.id) || control.id === "DPDP-PROC-002");
  const processors = hasKind(ctx.signals, "external");
  if (control.id === "DPDP-PROC-002") {
    if (processors.length === 0) {
      return notApplicable(control, "No processors observed.");
    }
    if (related.length === 0) {
      return resultFor(
        control,
        "NEEDS_CONTEXT",
        processors,
        "External processors observed; processor contracts are not established from code (declared evidence required)."
      );
    }
    return resultFor(
      control,
      "PARTIAL",
      processors,
      "Declared processor-contract assertions exist; they are not deterministic verification.",
      { question: control.humanReviewQuestions[0] }
    );
  }
  return evaluateHumanReview(control, ctx);
}

const EVALUATORS: Record<string, (control: ControlDefinition, ctx: EvaluationContext) => ControlResult> = {
  "inventory-personal-data": evaluateInventory,
  "notice-signals": evaluateNotice,
  "consent-capture": evaluateConsentCapture,
  "consent-metadata": evaluateConsentMetadata,
  "consent-withdrawal": evaluateWithdrawal,
  "purpose-binding": evaluatePurpose,
  "api-overfetch": evaluateApiOverfetch,
  "broad-db-select": evaluateBroadSelect,
  "correction-path": evaluateCorrection,
  "pii-in-logs": evaluatePiiInLogs,
  "pii-in-llm": evaluatePiiInLlm,
  "pii-in-urls": evaluatePiiInUrls,
  "browser-storage-pii": evaluateBrowserStorage,
  "insecure-http": evaluateInsecureHttp,
  "route-auth": evaluateRouteAuth,
  "hardcoded-pii": evaluateHardcodedPii,
  "debug-exposure": evaluateDebugExposure,
  "weak-masking": evaluateWeakMasking,
  "audit-signals": evaluateAudit,
  "breach-preparedness": evaluateBreach,
  "retention-mechanism": evaluateRetention,
  "erasure-path": evaluateErasure,
  "storage-without-deletion": evaluateStorageWithoutDeletion,
  "access-export": evaluateAccessExport,
  "grievance-handling": evaluateGrievance,
  "nomination-signal": evaluateNomination,
  "childrens-data": evaluateChildren,
  "guardian-consent": evaluateGuardian,
  "external-processors": evaluateProcessors,
  "cross-border-signals": evaluateCrossBorder,
  "sdf-signals": evaluateSdf,
  "rights-request-tracking": evaluateRightsTracking,
  "unprotected-export": evaluateUnprotectedExport,
  "third-party-user-object": evaluateThirdPartyUserObject
};

export function evaluateAllControls(ctx: EvaluationContext): ControlResult[] {
  return DPDP_CONTROLS.map((control) => {
    try {
      if (control.evaluatorId && EVALUATORS[control.evaluatorId]) {
        return EVALUATORS[control.evaluatorId](control, ctx);
      }
      if (control.verificationClass === "DECLARED_EVIDENCE") {
        return evaluateDeclaredEvidence(control, ctx);
      }
      if (control.verificationClass === "HUMAN_REVIEW") {
        return evaluateHumanReview(control, ctx);
      }
      return needsContext(control, "No deterministic evaluator registered for this control.");
    } catch (error) {
      return resultFor(control, "ERROR", [], `Evaluator error: ${error instanceof Error ? error.message : String(error)}`);
    }
  });
}

export function attachDeclaredEvidenceIds(results: ControlResult[], declared: DeclaredAssertion[]): ControlResult[] {
  return results.map((result) => {
    const related = declared.filter((item) => item.relatedControls.includes(result.controlId));
    if (related.length === 0) {
      return result;
    }
    return {
      ...result,
      evidenceIds: [...result.evidenceIds, ...related.map((item) => `declared:${item.id}`)],
      explanation: `${result.explanation} Declared assertions: ${related.map((item) => item.id).join(", ")} (not deterministic).`
    };
  });
}

export function controlVerificationClass(controlId: string): VerificationClass | undefined {
  return getControlById(controlId)?.verificationClass;
}
