import type { TechnicalSignalBag } from "../types";
import { lineHasAuth, pushSignal, windowAround } from "./shared";

export function collectLifecycleSignals(
  signals: TechnicalSignalBag[],
  file: string,
  lines: string[]
): void {
  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const window = windowAround(lines, index, 3, 4);

    if (
      /\b(app|router|route|fastify|express|@app\.(get|post|put|patch|delete)|APIRouter|@router\.|graphql|resolver|webhook|upload|multer|FormData|onSubmit)\b/i.test(
        line
      ) &&
      /\b(user|email|phone|profile|customer|consent|register|signup|login)\b/i.test(window)
    ) {
      pushSignal(signals, {
        kind: "collection",
        file,
        line: lineNumber,
        summary: "Likely personal-data collection or handler surface",
        confidence: "medium",
        tags: ["collection-point"],
        detectionMethod: "route-pattern",
        relatedControls: ["DPDP-APP-001", "DPDP-NOTICE-001"]
      });
    }

    if (/\b(consent|opt[_-]?in|accepted_terms|privacy_accepted)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "consent",
        file,
        line: lineNumber,
        summary: "Consent capture signal",
        confidence: "medium",
        tags: ["consent-capture"],
        detectionMethod: "consent-pattern",
        relatedControls: ["DPDP-CONSENT-001", "DPDP-CONSENT-002"]
      });
      const metaBits = {
        timestamp: /\b(consent_at|consented_at|consent_timestamp|given_at|created_at)\b/i.test(window),
        purpose: /\b(purpose_id|purpose|processing_purpose)\b/i.test(window),
        notice: /\b(notice_version|policy_version|privacy_version)\b/i.test(window)
      };
      if (metaBits.timestamp || metaBits.purpose || metaBits.notice) {
        pushSignal(signals, {
          kind: "consent",
          file,
          line: lineNumber,
          summary: `Consent metadata signals: timestamp=${metaBits.timestamp}, purpose=${metaBits.purpose}, notice=${metaBits.notice}`,
          confidence: "medium",
          tags: [
            "consent-metadata",
            metaBits.timestamp ? "has-timestamp" : "missing-timestamp",
            metaBits.purpose ? "has-purpose" : "missing-purpose",
            metaBits.notice ? "has-notice" : "missing-notice"
          ],
          detectionMethod: "consent-metadata-pattern",
          relatedControls: ["DPDP-CONSENT-002"]
        });
      }
    }

    if (/\b(withdraw[_-]?consent|revoke[_-]?consent|opt[_-]?out|unsubscribe)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "consent",
        file,
        line: lineNumber,
        summary: "Consent withdrawal signal",
        confidence: "high",
        tags: ["consent-withdrawal"],
        detectionMethod: "withdrawal-pattern",
        relatedControls: ["DPDP-WITHDRAW-001"]
      });
    }

    if (/\b(purpose_id|processing_purpose|purpose\s*[:=])\b/i.test(line)) {
      pushSignal(signals, {
        kind: "consent",
        file,
        line: lineNumber,
        summary: "Purpose identifier signal",
        confidence: "medium",
        tags: ["purpose-binding"],
        detectionMethod: "purpose-pattern",
        relatedControls: ["DPDP-PURPOSE-001"]
      });
    }

    if (/\b(privacy[_-]?notice|notice_version|privacy[_-]?policy)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "collection",
        file,
        line: lineNumber,
        summary: "Notice / privacy policy technical signal",
        confidence: "medium",
        tags: ["notice-signal"],
        detectionMethod: "notice-pattern",
        relatedControls: ["DPDP-NOTICE-001"]
      });
    }

    if (/\b(delete[_-]?account|erase[_-]?user|hard[_-]?delete|soft[_-]?delete|destroy\(|\.delete\(|deletedAt\s*=)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "deletion",
        file,
        line: lineNumber,
        summary: "Erasure / deletion path signal",
        confidence: "medium",
        tags: ["erasure-path"],
        detectionMethod: "deletion-pattern",
        relatedControls: ["DPDP-ERA-001", "DPDP-ERA-002"]
      });
    }

    if (/\b(export[_-]?data|download[_-]?my[_-]?data|data[_-]?export|right[_-]?to[_-]?access|get[_-]?personal[_-]?data)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "rights",
        file,
        line: lineNumber,
        summary: "Data access/export rights signal",
        confidence: "medium",
        tags: ["access-export"],
        detectionMethod: "rights-pattern",
        relatedControls: ["DPDP-ACC-RIGHT-001", "DPDP-EXPORT-001", "DPDP-REQ-001"]
      });
      if (!lineHasAuth(line, window)) {
        pushSignal(signals, {
          kind: "safeguard_gap",
          file,
          line: lineNumber,
          summary: "Export/access endpoint without nearby authentication signal",
          confidence: "medium",
          tags: ["unprotected-export"],
          detectionMethod: "export-auth-scan",
          relatedControls: ["DPDP-EXPORT-001", "DPDP-SEC-006"]
        });
      }
    }

    if (/\b(correct[_-]?data|update[_-]?profile|rectif|fix[_-]?personal)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "rights",
        file,
        line: lineNumber,
        summary: "Correction / profile update signal",
        confidence: "medium",
        tags: ["correction-path"],
        detectionMethod: "correction-pattern",
        relatedControls: ["DPDP-ACC-001", "DPDP-CORR-001"]
      });
    }

    if (/\b(grievance|complaint|privacy@|dpo@|data[_-]?protection[_-]?officer)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "rights",
        file,
        line: lineNumber,
        summary: "Grievance or privacy contact signal",
        confidence: "medium",
        tags: ["grievance"],
        detectionMethod: "grievance-pattern",
        relatedControls: ["DPDP-GRIEV-001", "DPDP-SDF-001"]
      });
    }

    if (/\b(nominee|nomination|legal[_-]?heir)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "rights",
        file,
        line: lineNumber,
        summary: "Nomination-related signal",
        confidence: "medium",
        tags: ["nomination"],
        detectionMethod: "nomination-pattern",
        relatedControls: ["DPDP-NOM-001"]
      });
    }

    if (/\b(is[_-]?child|under[_-]?18|age[_-]?gate|parental[_-]?consent|guardian[_-]?consent|date_of_birth|age\s*[<>=])/i.test(line)) {
      const isGuardian = /parental|guardian/i.test(line);
      pushSignal(signals, {
        kind: "consent",
        file,
        line: lineNumber,
        summary: isGuardian ? "Guardian/parental consent signal" : "Children's data / age gate signal",
        confidence: "medium",
        tags: isGuardian ? ["guardian-consent", "childrens-data"] : ["childrens-data"],
        detectionMethod: "children-pattern",
        relatedControls: ["DPDP-CHILD-001", "DPDP-CHILD-002"]
      });
    }

    if (/\b(breach|security[_-]?incident|incident[_-]?response)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "protection",
        file,
        line: lineNumber,
        summary: "Breach / incident preparedness signal",
        confidence: "medium",
        tags: ["breach-preparedness"],
        detectionMethod: "breach-pattern",
        relatedControls: ["DPDP-BREACH-001"]
      });
    }

    if (/\b(request[_-]?id|ticket[_-]?id|rights[_-]?request|dsar)\b/i.test(line)) {
      pushSignal(signals, {
        kind: "rights",
        file,
        line: lineNumber,
        summary: "Rights request tracking signal",
        confidence: "medium",
        tags: ["rights-tracking"],
        detectionMethod: "rights-tracking-pattern",
        relatedControls: ["DPDP-REQ-001"]
      });
    }
  }
}
