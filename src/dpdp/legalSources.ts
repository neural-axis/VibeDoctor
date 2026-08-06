import type { LegalSourceRef } from "./types";

/**
 * Versioned offline legal-source baseline for reproducible DPDP technical scans.
 * Agent reviews must verify current official sources at review time; this manifest
 * is not proof of current law and is not legal advice.
 */
export const LEGAL_SOURCE_MANIFEST_VERSION = "2025.2-final-corrigendum";

export const LEGAL_SOURCES: LegalSourceRef[] = [
  {
    id: "DPDP-ACT-2023",
    title: "Digital Personal Data Protection Act, 2023",
    version: "2023",
    citation: "Act No. 22 of 2023 (India)",
    notificationId: "Act No. 22 of 2023",
    publishedAt: "2023-08-11",
    sourceStatus: "enacted",
    sections: [
      "Section 2 (definitions)",
      "Section 3 (application)",
      "Section 4 (grounds for processing)",
      "Section 5 (notice)",
      "Section 6 (consent)",
      "Section 7 (certain legitimate uses)",
      "Section 8 (general obligations of Data Fiduciary)",
      "Section 9 (processing of personal data of children)",
      "Section 10 (Additional obligations of Significant Data Fiduciary)",
      "Section 11 (Right to access information about personal data)",
      "Section 12 (Right to correction and erasure)",
      "Section 13 (Right of grievance redressal)",
      "Section 14 (Right to nominate)",
      "Section 16 (Transfer of personal data outside India)",
      "Section 17 (exemptions)"
    ],
    url: "https://www.meity.gov.in/static/uploads/2024/06/2bf1f0e9f04e6fb4f8fef35e82c42aa5.pdf"
  },
  {
    id: "DPDP-RULES-2025",
    title: "Digital Personal Data Protection Rules, 2025",
    version: "2025-final",
    citation: "G.S.R. 846(E), dated 13 November 2025",
    notificationId: "G.S.R. 846(E)",
    publishedAt: "2025-11-14",
    sourceStatus: "notified",
    effectiveSchedule: [
      "Rules 1, 2 and 17-21: on Gazette publication",
      "Rule 4: one year after Gazette publication",
      "Rules 3, 5-16, 22 and 23: eighteen months after Gazette publication"
    ],
    sections: [
      "Notice requirements",
      "Consent manager related provisions",
      "Security safeguards",
      "Retention and erasure timelines",
      "Breach intimation",
      "Significant Data Fiduciary obligations",
      "Children's data processing",
      "Cross-border transfer conditions"
    ],
    url: "https://www.meity.gov.in/static/uploads/2025/11/53450e6e5dc0bfa85ebd78686cadad39.pdf"
  },
  {
    id: "DPDP-CORRIGENDUM",
    title: "DPDP corrigendum / rectification notifications",
    version: "2025-12",
    citation: "G.S.R. 892(E), corrigendum to G.S.R. 846(E)",
    notificationId: "G.S.R. 892(E)",
    publishedAt: "2025-12-12",
    sourceStatus: "corrigendum",
    sections: ["Corrections to the final Digital Personal Data Protection Rules, 2025"],
    url: "https://www.meity.gov.in/documents/act-and-policies/digital-personal-data-protection-rules-2025-gDOxUjMtQWa"
  },
  {
    id: "DPDP-ENFORCEMENT-NOTIFICATION",
    title: "DPDP enforcement / commencement notification",
    version: "2025-11",
    citation: "G.S.R. 843(E), dated 13 November 2025",
    notificationId: "G.S.R. 843(E)",
    publishedAt: "2025-11-14",
    sourceStatus: "notified",
    effectiveSchedule: [
      "Specified institutional provisions: on Gazette publication",
      "Section 6(9) and section 27(1)(d): one year after Gazette publication",
      "Core processing, rights and obligation provisions: eighteen months after Gazette publication"
    ],
    sections: ["Phased commencement of the Digital Personal Data Protection Act, 2023"],
    url: "https://www.meity.gov.in/static/uploads/2025/11/c56ceae6c383460ca69577428d36828b.pdf"
  }
];

export function getLegalSource(id: string): LegalSourceRef | undefined {
  return LEGAL_SOURCES.find((source) => source.id === id);
}

export function formatLegalCitations(sourceIds: string[], sections: string[]): string[] {
  return [
    ...sourceIds.map((id) => {
      const source = getLegalSource(id);
      return source ? `${source.title} (${source.version})` : id;
    }),
    ...sections
  ];
}
