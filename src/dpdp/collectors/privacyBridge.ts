import { detectPiiFindings } from "../../adapters/privacyDetector";
import type { ToolAdapterContext } from "../../adapters/shared";
import type { Finding } from "../../core/finding";
import { redactLikelyPii } from "../evidence";
import type { DataCategory, TechnicalSignalBag } from "../types";
import { confidenceMeetsThreshold } from "./confidence";
import { pushSignal } from "./shared";

const ENTITY_TO_CATEGORY: Record<string, DataCategory> = {
  aadhaar: "aadhaar",
  pan: "pan",
  passport: "passport",
  email: "email",
  phone: "phone",
  date_of_birth: "date_of_birth",
  address: "postal_address",
  ip_address: "ip_device_id",
  device_id: "ip_device_id",
  payment_card: "financial_payment",
  bank_account: "financial_payment",
  health_data: "health_disability",
  financial_attribute: "financial_payment",
  employment_sensitive: "employee_applicant_customer",
  precise_location: "location",
  person_linkable_id: "employee_applicant_customer",
  combination_risk: "other_personal"
};

/** Prefer DPDP confidence/mask settings when invoking the privacy detector from DPDP. */
export function withDpdpPrivacyOverrides(ctx: ToolAdapterContext): ToolAdapterContext {
  const dpdp = ctx.config.checks.dpdp;
  return {
    ...ctx,
    config: {
      ...ctx.config,
      checks: {
        ...ctx.config.checks,
        privacy: {
          ...ctx.config.checks.privacy,
          minConfidenceToReport: dpdp.minConfidenceToReport,
          maskExamples: dpdp.maskExamples
        }
      }
    }
  };
}

function sanitizeSignalSnippet(snippet: string | undefined): string | undefined {
  if (!snippet) {
    return undefined;
  }
  return redactLikelyPii(snippet);
}

/**
 * Distinguish field-name metadata from value-literal detections for hardcoded-PII evaluation.
 */
export function classifyPrivacyFindingTags(
  file: string | undefined,
  matchedPattern: string,
  detectionPath: string
): string[] {
  const tags: string[] = [];
  const pathText = detectionPath.toLowerCase();
  const pattern = matchedPattern.toLowerCase();

  const isValueLiteral =
    pathText.includes("regex") || pathText.includes("checksum") || /(-regex|luhn)/i.test(pattern);

  const isFieldMetadata =
    pathText.includes("metadata") || /-field$/i.test(pattern) || pathText.includes("combination-risk");

  if (isValueLiteral) {
    tags.push("value-literal");
  } else if (isFieldMetadata) {
    tags.push("field-metadata");
  }

  if (file && /(^|\/)(fixtures?|seeds?|samples?|mocks?|demos?|testdata)(\/|$)/i.test(file.replaceAll("\\", "/"))) {
    tags.push("fixture-path");
  }

  return tags;
}

export async function collectPrivacySignals(
  ctx: ToolAdapterContext,
  candidates: string[]
): Promise<{ privacyFindings: Finding[]; signals: TechnicalSignalBag[] }> {
  const privacyCfg = ctx.config.checks.privacy;
  const dpdpCfg = ctx.config.checks.dpdp;
  const privacyCtx = withDpdpPrivacyOverrides(ctx);
  const privacyFindings =
    privacyCfg.enabled || dpdpCfg.enabled
      ? await detectPiiFindings(privacyCtx, { fileAllowlist: candidates })
      : [];

  const signals: TechnicalSignalBag[] = [];

  for (const finding of privacyFindings) {
    if (!confidenceMeetsThreshold(finding.confidence, dpdpCfg.minConfidenceToReport)) {
      continue;
    }
    const entity = finding.evidence?.entityType ?? "other_personal";
    const category = ENTITY_TO_CATEGORY[entity] ?? "other_personal";
    const snippet = sanitizeSignalSnippet(finding.evidence?.snippet);
    const detectionMethod = finding.evidence?.matchedPattern ?? "privacy-detector";
    const detectionPath = finding.evidence?.detectionPath ?? "";
    const privacyTags = [
      "privacy-detector",
      entity,
      ...(finding.tags ?? []),
      ...classifyPrivacyFindingTags(finding.file, detectionMethod, detectionPath)
    ];
    pushSignal(signals, {
      kind: finding.evidence?.fieldPath ? "field" : "category",
      file: finding.file,
      line: finding.startLine,
      category,
      field: finding.evidence?.fieldPath,
      summary: `${finding.title} (${entity})`,
      snippet,
      confidence: finding.confidence,
      confidenceScore: finding.evidence?.confidenceScore,
      tags: privacyTags,
      detectionMethod,
      provenance: "privacy-detector",
      certainty: finding.confidence === "high" ? "confirmed" : "inferred",
      relatedControls: ["DPDP-APP-001", "DPDP-SEC-007"]
    });

    if (finding.tags.includes("logging") || finding.id.includes("unsanitized-log")) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file: finding.file,
        line: finding.startLine,
        category,
        summary: "Potential PII in logger call",
        snippet,
        confidence: finding.confidence,
        tags: ["pii-in-logs"],
        detectionMethod: "privacy-detector-log",
        relatedControls: ["DPDP-SEC-001"]
      });
    }
    if (finding.tags.includes("overfetching") || finding.id.includes("api-overfetching")) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file: finding.file,
        line: finding.startLine,
        summary: "Potential API over-fetching of personal entity",
        confidence: finding.confidence,
        tags: ["api-overfetch"],
        detectionMethod: "privacy-detector-overfetch",
        relatedControls: ["DPDP-MIN-001"]
      });
    }
    if (finding.tags.includes("retention") || finding.id.includes("missing-retention")) {
      pushSignal(signals, {
        kind: "storage",
        file: finding.file,
        line: finding.startLine,
        summary: finding.message,
        confidence: finding.confidence,
        tags: ["missing-retention", "pii-store"],
        detectionMethod: "privacy-detector-retention",
        relatedControls: ["DPDP-RET-001", "DPDP-ERA-002"]
      });
    }
  }

  return { privacyFindings, signals };
}
