import type { AgentPlan, RecoveryAction, ScanCompleteness, ScanOutput, ToolStatusSummary } from "./engine";
import type { EvidenceGrade, Finding, FindingCategory, Severity, Confidence } from "./finding";
import { correlateFindings, inferRootCause, type FindingLocation, type RootCauseGroup } from "./findingCorrelator";
import { rankFindings } from "./riskRanker";

export type AgentIssue = {
  id: string;
  ruleId: string;
  title: string;
  severity: Severity;
  confidence: Confidence;
  evidenceGrade: EvidenceGrade;
  category: FindingCategory;
  locations: FindingLocation[];
  impact: string;
  likelyRootCause: string;
  supportingEngines: string[];
  recommendedRepair: string;
  verificationGuidance: string;
};

export type AgentDiagnosisSummary = {
  score: number;
  mode: ScanOutput["mode"];
  planned: number;
  completed: number;
  findingCount: number;
  blockerCount: number;
  topIssueCount: number;
};

export type AgentDiagnosis = {
  completeness: ScanCompleteness;
  summary: AgentDiagnosisSummary;
  topIssues: AgentIssue[];
  rootCauseGroups: RootCauseGroup[];
  toolStatuses: ToolStatusSummary[];
  recoveryActions: RecoveryAction[];
  recommendedOrder: string[];
  agentPlan: AgentPlan;
};

function describeImpact(finding: Finding): string {
  if (finding.category === "security") {
    return "Credentials or vulnerable dependencies can be exploited if this reaches a shared or deployed tree.";
  }
  if (finding.source === "flow-doctor") {
    return "A request or error path does not match the implemented contract, so the feature can fail at runtime.";
  }
  if (finding.category === "correctness" || finding.category === "tests") {
    return "Type, lint, or test evidence indicates the code may not behave as written.";
  }
  if (finding.category === "privacy") {
    return "Personal data may be handled without a visible control.";
  }
  if (finding.category === "dead_code" || finding.category === "leftovers") {
    return "Unused or leftover code increases review cost and hides real defects.";
  }
  return finding.message;
}

function recommendedRepair(finding: Finding): string {
  if (finding.remediation?.steps.length) {
    return finding.remediation.steps.join(" ");
  }
  if (finding.agentInstruction) {
    return finding.agentInstruction;
  }
  if (finding.fixCommand) {
    return `Apply: ${finding.fixCommand}`;
  }
  return finding.message;
}

function verificationGuidance(finding: Finding, testCommands: string[]): string {
  const test = testCommands[0];
  const parts = [
    finding.file ? `Re-read ${finding.file}${finding.startLine ? `:${finding.startLine}` : ""} after the edit.` : undefined,
    test ? `Run \`${test}\`.` : undefined,
    "Run `vibedoctor scan --changed --report agent-json` and confirm this finding id is gone."
  ];
  return parts.filter(Boolean).join(" ");
}

export function findingToAgentIssue(finding: Finding, testCommands: string[] = []): AgentIssue {
  return {
    id: finding.id,
    ruleId: finding.evidence?.toolRawId ?? finding.title,
    title: finding.title,
    severity: finding.severity,
    confidence: finding.confidence,
    evidenceGrade: finding.evidenceGrade ?? "observed",
    category: finding.category,
    locations: [{ file: finding.file, startLine: finding.startLine, endLine: finding.endLine }],
    impact: describeImpact(finding),
    likelyRootCause: inferRootCause(finding),
    supportingEngines: Array.from(new Set([finding.source, ...(finding.corroboratedBy ?? [])])),
    recommendedRepair: recommendedRepair(finding),
    verificationGuidance: verificationGuidance(finding, testCommands)
  };
}

export function buildAgentDiagnosis(scan: ScanOutput): AgentDiagnosis {
  const ranked = rankFindings(scan.findings);
  const groups = correlateFindings(ranked);
  const topFindings = ranked.slice(0, 8);
  const topIssues = topFindings.map((finding) => {
    const group = groups.find((candidate) => candidate.findingIds.includes(finding.id));
    const issue = findingToAgentIssue(finding, scan.testCommands);
    if (group) {
      issue.supportingEngines = group.supportingEngines;
      issue.likelyRootCause = group.likelyRootCause;
      issue.locations = group.locations;
    }
    return issue;
  });

  const recommendedOrder = topIssues.map((issue) => issue.id);

  return {
    completeness: scan.completeness,
    summary: {
      score: scan.score.overall,
      mode: scan.mode,
      planned: scan.completeness.planned,
      completed: scan.completeness.completed,
      findingCount: scan.findings.length,
      blockerCount: scan.blockers.length,
      topIssueCount: topIssues.length
    },
    topIssues,
    rootCauseGroups: groups,
    toolStatuses: scan.toolStatuses,
    recoveryActions: scan.recoveryActions,
    recommendedOrder,
    agentPlan: scan.agentPlan
  };
}
