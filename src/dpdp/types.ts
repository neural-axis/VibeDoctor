import type { Confidence, Severity } from "../core/finding";

/** Verification classes for DPDP controls. */
export const VERIFICATION_CLASSES = [
  "DETERMINISTIC",
  "TECHNICAL_SIGNAL",
  "DECLARED_EVIDENCE",
  "HUMAN_REVIEW"
] as const;

export type VerificationClass = (typeof VERIFICATION_CLASSES)[number];

/** Control result statuses. Absence of evidence must never become VERIFIED. */
export const CONTROL_STATUSES = [
  "VERIFIED",
  "VIOLATED",
  "PARTIAL",
  "NOT_OBSERVED",
  "NEEDS_CONTEXT",
  "NOT_APPLICABLE",
  "SKIPPED",
  "ERROR"
] as const;

export type ControlStatus = (typeof CONTROL_STATUSES)[number];

export const CONTROL_DOMAINS = [
  "applicability_and_inventory",
  "notice",
  "consent",
  "withdrawal",
  "purpose_limitation",
  "data_minimisation",
  "accuracy",
  "security_safeguards",
  "breach_preparedness",
  "retention",
  "erasure",
  "data_principal_access",
  "correction",
  "grievance_handling",
  "nomination",
  "childrens_data",
  "guardian_consent",
  "processors_and_recipients",
  "cross_border_signals",
  "significant_data_fiduciary",
  "exemptions_and_applicability"
] as const;

export type ControlDomain = (typeof CONTROL_DOMAINS)[number];

export const EVIDENCE_KINDS = [
  "personal_data_category",
  "field_or_column",
  "collection_source",
  "processing_operation",
  "transformation",
  "storage_location",
  "log_or_telemetry",
  "external_recipient",
  "protection_control",
  "retention_mechanism",
  "deletion_path",
  "rights_endpoint",
  "consent_signal",
  "policy_declaration",
  "safeguard_gap",
  "declared_assertion",
  "skip_or_capability"
] as const;

export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

export type ObservationCertainty = "confirmed" | "inferred" | "declared";

export type DataCategory =
  | "aadhaar"
  | "pan"
  | "passport"
  | "voter_id"
  | "driving_licence"
  | "name"
  | "email"
  | "phone"
  | "postal_address"
  | "date_of_birth"
  | "age"
  | "financial_payment"
  | "health_disability"
  | "biometric_identity"
  | "location"
  | "ip_device_id"
  | "cookie_ad_id"
  | "credentials_auth"
  | "employee_applicant_customer"
  | "free_text_personal"
  | "llm_prompt_embedding"
  | "other_personal"
  | "unknown";

export type LegalSourceRef = {
  id: string;
  title: string;
  version: string;
  citation: string;
  notificationId?: string;
  publishedAt?: string;
  effectiveSchedule?: string[];
  sourceStatus?: "enacted" | "notified" | "corrigendum";
  sections?: string[];
  url?: string;
};

export type ControlDefinition = {
  id: string;
  title: string;
  domain: ControlDomain;
  technicalIntent: string;
  legalSourceIds: string[];
  legalCitations: string[];
  applicability: {
    when: string;
    requiresPersonalData?: boolean;
    requiresChildren?: boolean;
    requiresSdf?: boolean;
    requiresProcessors?: boolean;
    requiresCrossBorder?: boolean;
  };
  verificationClass: VerificationClass;
  evidenceRequirements: string[];
  /** Stable evaluator key; when absent, only human/declared evaluation applies. */
  evaluatorId?: string;
  possibleStatuses: ControlStatus[];
  severityRules: {
    defaultSeverity: Severity;
    violatedSeverity: Severity;
    partialSeverity?: Severity;
  };
  limitations: string[];
  remediation: string;
  humanReviewQuestions: string[];
  sourceVersion: string;
};

export type EvidenceItem = {
  id: string;
  kind: EvidenceKind;
  dataCategory?: DataCategory;
  file?: string;
  line?: number;
  endLine?: number;
  symbol?: string;
  field?: string;
  source?: string;
  destination?: string;
  detectionMethod: string;
  confidence: Confidence;
  confidenceScore?: number;
  provenance: "deterministic" | "technical_signal" | "declared" | "presidio" | "semgrep" | "privacy-detector";
  relatedControls: string[];
  certainty: ObservationCertainty;
  /** Masked/classified summary only — never raw PII. */
  summary: string;
  /** Optional redacted snippet. */
  snippet?: string;
  tags: string[];
};

export type DeclaredAssertion = {
  id: string;
  statement: string;
  source: string;
  suppliedRole: string;
  date: string;
  relatedControls: string[];
  verificationStatus: "unverified" | "partially_corroborated" | "contradicted" | "supported_by_signal";
};

export type DpdpContext = {
  version: number;
  organization: {
    processesPersonalData: "true" | "false" | "unknown";
    isSignificantDataFiduciary: "true" | "false" | "unknown";
    processesChildrenData: "true" | "false" | "unknown";
    hasCrossBorderTransfer: "true" | "false" | "unknown";
    industry?: string;
    notes?: string;
  };
  purposes?: string[];
  processors?: string[];
  policies?: Array<{ name: string; path?: string; version?: string }>;
};

export type ControlResult = {
  controlId: string;
  title: string;
  domain: ControlDomain;
  status: ControlStatus;
  verificationClass: VerificationClass;
  confidence: Confidence;
  severity: Severity;
  evidenceIds: string[];
  explanation: string;
  limitations: string[];
  remediation?: string;
  humanReviewQuestion?: string;
  isNew: boolean;
  applicable: boolean;
};

/** Node kinds in the personal-data processing graph (classified labels only — never raw PII). */
export const DATA_MAP_NODE_KINDS = [
  "category",
  "field",
  "collection",
  "store",
  "external",
  "lifecycle",
  "safeguard_gap",
  "control",
  "evidence"
] as const;

export type DataMapNodeKind = (typeof DATA_MAP_NODE_KINDS)[number];

export const DATA_MAP_EDGE_RELATIONS = [
  "instance_of",
  "collected_at",
  "stored_in",
  "sent_to",
  "protected_by",
  "lifecycle_of",
  "related_control",
  "evidenced_by",
  "co_located"
] as const;

export type DataMapEdgeRelation = (typeof DATA_MAP_EDGE_RELATIONS)[number];

export type DataMapNode = {
  id: string;
  kind: DataMapNodeKind;
  /** Classified label only (category name, store kind, control id, etc.). Never raw PII. */
  label: string;
  category?: DataCategory;
  file?: string;
  line?: number;
  evidenceIds?: string[];
};

export type DataMapEdge = {
  id: string;
  from: string;
  to: string;
  relation: DataMapEdgeRelation;
};

export type PersonalDataMapGraph = {
  nodes: DataMapNode[];
  edges: DataMapEdge[];
};

export type PersonalDataMap = {
  version: 1;
  generatedAt: string;
  disclaimer: string;
  categories: Array<{ category: DataCategory; count: number; evidenceIds: string[] }>;
  collectionPoints: Array<{ id: string; kind: string; file?: string; line?: number; summary: string; evidenceIds: string[] }>;
  stores: Array<{ id: string; kind: string; file?: string; summary: string; evidenceIds: string[] }>;
  externalRecipients: Array<{ id: string; name: string; kind: string; file?: string; summary: string; evidenceIds: string[] }>;
  lifecycleSignals: Array<{ id: string; kind: string; file?: string; line?: number; summary: string; evidenceIds: string[] }>;
  safeguardGaps: Array<{ id: string; kind: string; file?: string; line?: number; summary: string; evidenceIds: string[] }>;
  relatedControls: string[];
  /** Lightweight processing graph; safe for agents. Existing flat lists remain for compat. */
  graph: PersonalDataMapGraph;
};

export type ControlMatrix = {
  version: 1;
  generatedAt: string;
  disclaimer: string;
  legalSourceVersion: string;
  controls: ControlResult[];
  summary: ControlStatusCounts;
};

export type ControlStatusCounts = {
  verified: number;
  violated: number;
  partial: number;
  notObserved: number;
  needsContext: number;
  notApplicable: number;
  skipped: number;
  error: number;
  humanReview: number;
  unresolved: number;
};

export type EvidenceLedger = {
  version: 1;
  generatedAt: string;
  disclaimer: string;
  evidence: EvidenceItem[];
  declared: DeclaredAssertion[];
};

export type DpdpScores = {
  /** Technical readiness only — not legal compliance. */
  technicalPostureScore: number;
  evidenceCompletenessPercent: number;
  openRiskBySeverity: Record<Severity, number>;
  statusCounts: ControlStatusCounts;
  labels: {
    /**
     * Names the figure and, when supporting scanners did not run, says so in the
     * label itself — a posture number quoted without its coverage caveat is the
     * thing that overstates the evidence.
     */
    technicalPosture: string;
    evidenceCompleteness: "Evidence completeness (technical observability)";
    openRisk: "Open technical risk counts by severity";
  };
};

export type ReviewQueueItem = {
  controlId: string;
  title: string;
  domain: ControlDomain;
  audience: "developer" | "security" | "product" | "legal" | "operations" | "founder";
  question: string;
  status: ControlStatus;
  severity: Severity;
};

export type DpdpScanMode = "default" | "changed" | "full";

export type DpdpCapabilityStatus = {
  id: string;
  status: "available" | "skipped" | "error";
  message?: string;
  /**
   * Which decision produced this status. "Skipped" previously covered opting
   * out, having nothing in scope, and not being installed — three situations with
   * nothing in common, so a user could not tell whether a scanner they had
   * installed was actually contributing evidence.
   */
  cause?:
    | "opted_out"
    | "disabled"
    | "quick_mode"
    | "nothing_in_scope"
    | "not_installed"
    | "not_applicable"
    | "failed"
    | "timed_out"
    | "ran";
  /** What to change to make this capability available. */
  remediation?: string;
  /** Absolute path or interpreter that answered, when the capability did run. */
  resolvedVia?: string;
  /** How many signals this capability contributed to the evidence ledger. */
  signalsContributed?: number;
};

export type DpdpScanResult = {
  version: 1;
  generatedAt: string;
  root: string;
  mode: DpdpScanMode;
  disclaimer: string;
  scores: DpdpScores;
  dataMap: PersonalDataMap;
  controlMatrix: ControlMatrix;
  evidenceLedger: EvidenceLedger;
  reviewQueue: ReviewQueueItem[];
  fixNext: Array<{ controlId: string; title: string; severity: Severity; remediation: string; evidenceIds: string[] }>;
  capabilities: DpdpCapabilityStatus[];
  findings: import("../core/finding").Finding[];
  legalSourceVersion: string;
  context: DpdpContext;
  baselineApplied: boolean;
};

export type TechnicalSignalBag = {
  id: string;
  kind: string;
  file?: string;
  line?: number;
  symbol?: string;
  field?: string;
  category?: DataCategory;
  summary: string;
  snippet?: string;
  confidence: Confidence;
  confidenceScore?: number;
  tags: string[];
  relatedControls?: string[];
  certainty?: ObservationCertainty;
  detectionMethod: string;
  provenance?: EvidenceItem["provenance"];
};
