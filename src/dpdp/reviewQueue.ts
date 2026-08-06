import type { ControlDomain, ControlResult, ReviewQueueItem } from "./types";

function audienceFor(domain: ControlDomain): ReviewQueueItem["audience"] {
  switch (domain) {
    case "security_safeguards":
    case "breach_preparedness":
      return "security";
    case "notice":
    case "consent":
    case "withdrawal":
    case "purpose_limitation":
    case "childrens_data":
    case "guardian_consent":
      return "product";
    case "processors_and_recipients":
    case "cross_border_signals":
    case "significant_data_fiduciary":
    case "exemptions_and_applicability":
      return "legal";
    case "retention":
    case "erasure":
    case "grievance_handling":
    case "nomination":
      return "operations";
    case "applicability_and_inventory":
    case "data_minimisation":
    case "accuracy":
    case "data_principal_access":
    case "correction":
      return "developer";
    default:
      return "founder";
  }
}

export function buildReviewQueue(controls: ControlResult[]): ReviewQueueItem[] {
  return controls
    .filter(
      (control) =>
        control.applicable &&
        (control.status === "NEEDS_CONTEXT" ||
          control.status === "PARTIAL" ||
          control.verificationClass === "HUMAN_REVIEW" ||
          control.verificationClass === "DECLARED_EVIDENCE")
    )
    .map((control) => ({
      controlId: control.controlId,
      title: control.title,
      domain: control.domain,
      audience: audienceFor(control.domain),
      question: control.humanReviewQuestion ?? control.explanation,
      status: control.status,
      severity: control.severity
    }))
    .sort((left, right) => left.audience.localeCompare(right.audience) || left.controlId.localeCompare(right.controlId));
}

export function renderReviewQueueMarkdown(items: ReviewQueueItem[]): string {
  const lines = [
    "# DPDP Review Queue",
    "",
    "This queue lists unresolved organisational, legal, and product questions.",
    "It is part of a **DPDP technical readiness** assessment — not legal certification.",
    "",
    "Do not re-ask questions already answered by deterministic evidence in the control matrix.",
    ""
  ];

  const byAudience = new Map<string, ReviewQueueItem[]>();
  for (const item of items) {
    const list = byAudience.get(item.audience) ?? [];
    list.push(item);
    byAudience.set(item.audience, list);
  }

  for (const audience of ["developer", "security", "product", "legal", "operations", "founder"]) {
    const group = byAudience.get(audience);
    if (!group || group.length === 0) {
      continue;
    }
    lines.push(`## ${audience.charAt(0).toUpperCase()}${audience.slice(1)}`);
    lines.push("");
    for (const item of group) {
      lines.push(`- **${item.controlId}** (${item.status}, ${item.severity}): ${item.question}`);
    }
    lines.push("");
  }

  if (items.length === 0) {
    lines.push("_No human-review items queued from the latest scan._");
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}
