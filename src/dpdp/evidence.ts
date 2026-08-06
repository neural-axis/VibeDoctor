import { createHash } from "node:crypto";
import type { EvidenceItem, ObservationCertainty, TechnicalSignalBag } from "./types";

export function stableEvidenceId(parts: Array<string | number | undefined>): string {
  const payload = parts.map((part) => String(part ?? "")).join("|");
  return `ev-${createHash("sha1").update(payload).digest("hex").slice(0, 16)}`;
}

export function evidenceFromSignal(
  signal: TechnicalSignalBag,
  relatedControls: string[] = signal.relatedControls ?? []
): EvidenceItem {
  return {
    id: signal.id.startsWith("ev-") ? signal.id : stableEvidenceId([signal.kind, signal.file, signal.line, signal.summary]),
    kind: mapSignalKind(signal.kind),
    dataCategory: signal.category,
    file: signal.file,
    line: signal.line,
    symbol: signal.symbol,
    field: signal.field,
    detectionMethod: signal.detectionMethod,
    confidence: signal.confidence,
    confidenceScore: signal.confidenceScore,
    provenance: signal.provenance ?? "deterministic",
    relatedControls,
    certainty: signal.certainty ?? defaultCertainty(signal),
    summary: signal.summary,
    snippet: signal.snippet,
    tags: signal.tags
  };
}

function defaultCertainty(signal: TechnicalSignalBag): ObservationCertainty {
  if (signal.provenance === "declared") {
    return "declared";
  }
  if (signal.confidence === "high") {
    return "confirmed";
  }
  return "inferred";
}

function mapSignalKind(kind: string): EvidenceItem["kind"] {
  switch (kind) {
    case "category":
    case "personal_data_category":
      return "personal_data_category";
    case "field":
    case "column":
    case "field_or_column":
      return "field_or_column";
    case "collection":
    case "collection_source":
      return "collection_source";
    case "storage":
    case "storage_location":
      return "storage_location";
    case "log":
    case "telemetry":
    case "log_or_telemetry":
      return "log_or_telemetry";
    case "external":
    case "external_recipient":
      return "external_recipient";
    case "retention":
    case "retention_mechanism":
      return "retention_mechanism";
    case "deletion":
    case "deletion_path":
      return "deletion_path";
    case "rights":
    case "rights_endpoint":
      return "rights_endpoint";
    case "consent":
    case "consent_signal":
      return "consent_signal";
    case "safeguard_gap":
      return "safeguard_gap";
    case "protection":
    case "protection_control":
      return "protection_control";
    case "declared":
    case "declared_assertion":
      return "declared_assertion";
    case "skip":
    case "capability":
      return "skip_or_capability";
    default:
      return "processing_operation";
  }
}

/**
 * Ensure no raw PII-like tokens leak into serialized evidence.
 * Always fail-closed for regulated identifiers and common contact PII,
 * even when `checks.dpdp.maskExamples` is false.
 */
export function sanitizeEvidenceForOutput(item: EvidenceItem): EvidenceItem {
  return {
    ...item,
    summary: redactLikelyPii(item.summary),
    snippet: item.snippet ? redactLikelyPii(item.snippet) : undefined
  };
}

/** Fail-closed redaction for artifact/report output. */
export function redactLikelyPii(value: string): string {
  let text = value;
  // Redact labelled literals first so names, addresses and identifiers that do
  // not have a universally reliable standalone shape never reach artifacts.
  text = text.replace(
    /\b(name|full_?name|first_?name|last_?name|address|passport|voter_?id|driv(?:ing|er)_?licen[cs]e|date_?of_?birth|dob|medical|health|biometric|api_?key|password|secret|token)\b(\s*[:=]\s*)["'`]([^"'`\r\n]+)["'`]/gi,
    (_match, label: string, separator: string) => `${label}${separator}"[redacted]"`
  );
  text = text.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[email]");
  text = text.replace(/\b[A-Z]{5}[0-9]{4}[A-Z]\b/gi, "[pan]");
  text = text.replace(/\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g, "[aadhaar]");
  text = text.replace(/\b[A-Z][0-9]{7}\b/gi, "[passport]");
  text = text.replace(/\b[A-Z]{3}[0-9]{7}\b/gi, "[voter-id]");
  text = text.replace(/\b[A-Z]{2}[ -]?[0-9]{2}[ -]?[0-9A-Z]{7,13}\b/gi, "[driving-licence]");
  text = text.replace(/\b(?:\d[ -]?){13,19}\b/g, "[card]");
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[ip-address]");
  text = text.replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[jwt]");
  text = text.replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*\b/gi, "Bearer [token]");
  text = text.replace(/(?:\+\d{1,3}[-.\s]?)?(?:\(?\d{3,5}\)?[-.\s]?){2,}\d{3,4}/g, (match) => {
    const digits = match.replace(/\D/g, "");
    return digits.length >= 10 && digits.length <= 14 ? "[phone]" : match;
  });
  return text.slice(0, 2_000);
}
