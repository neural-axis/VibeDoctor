import type { Finding, FindingCategory, Severity } from "./finding";
import { severityRank } from "../rules/severityMap";

export type FindingLocation = {
  file?: string;
  startLine?: number;
  endLine?: number;
};

export type RootCauseGroup = {
  id: string;
  title: string;
  severity: Severity;
  category: FindingCategory;
  findingIds: string[];
  supportingEngines: string[];
  likelyRootCause: string;
  locations: FindingLocation[];
};

function locationKey(finding: Finding): string | undefined {
  if (!finding.file || finding.startLine === undefined) {
    return undefined;
  }
  return `${finding.file}:${finding.startLine}`;
}

function token(finding: Finding): string {
  return (finding.evidence?.toolRawId ?? finding.title).toLowerCase().replace(/\s+/g, " ").trim();
}

function sameProblem(left: Finding, right: Finding): boolean {
  if (left.id === right.id) {
    return true;
  }
  const corroborated =
    left.corroboratedBy?.includes(right.source) || right.corroboratedBy?.includes(left.source);
  if (left.category !== right.category) {
    return Boolean(corroborated && left.file && left.file === right.file);
  }
  if (left.file && left.file === right.file) {
    const lineClose =
      left.startLine !== undefined &&
      right.startLine !== undefined &&
      Math.abs(left.startLine - right.startLine) <= 2;
    if (lineClose) {
      return true;
    }
    if (token(left) && token(left) === token(right)) {
      return true;
    }
  }
  if (corroborated) {
    return left.file === right.file;
  }
  return false;
}

function pickCanonical(findings: Finding[]): Finding {
  return [...findings].sort((left, right) => {
    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }
    return left.id.localeCompare(right.id);
  })[0];
}

export function inferRootCause(finding: Finding): string {
  if (finding.source === "gitleaks") {
    return "A secret or credential-like value is committed in source.";
  }
  if (finding.source === "osv-scanner") {
    return "A declared dependency has a known advisory.";
  }
  if (finding.source === "flow-doctor") {
    return finding.message;
  }
  if (finding.source === "tsc" || finding.source === "pyright") {
    return "The type checker rejected this location.";
  }
  if (finding.category === "tests") {
    return "A test suite reported a failure.";
  }
  return finding.message;
}

export function correlateFindings(findings: Finding[]): RootCauseGroup[] {
  const remaining = [...findings];
  const groups: Finding[][] = [];

  while (remaining.length > 0) {
    const seed = remaining.shift()!;
    const group = [seed];
    for (let index = remaining.length - 1; index >= 0; index -= 1) {
      if (group.some((member) => sameProblem(member, remaining[index]))) {
        group.push(remaining.splice(index, 1)[0]);
      }
    }
    groups.push(group);
  }

  return groups
    .map((members, index) => {
      const canonical = pickCanonical(members);
      const engines = Array.from(new Set(members.map((member) => member.source))).sort();
      const locations = members
        .map((member) => ({ file: member.file, startLine: member.startLine, endLine: member.endLine }))
        .filter((location, locationIndex, all) => {
          const key = `${location.file ?? ""}:${location.startLine ?? ""}`;
          return all.findIndex((candidate) => `${candidate.file ?? ""}:${candidate.startLine ?? ""}` === key) === locationIndex;
        })
        .sort((left, right) => `${left.file}:${left.startLine ?? 0}`.localeCompare(`${right.file}:${right.startLine ?? 0}`));

      return {
        id: `rcg-${String(index + 1).padStart(3, "0")}`,
        title: canonical.title,
        severity: canonical.severity,
        category: canonical.category,
        findingIds: members.map((member) => member.id).sort(),
        supportingEngines: engines,
        likelyRootCause: inferRootCause(canonical),
        locations
      } satisfies RootCauseGroup;
    })
    .sort((left, right) => {
      const severityDelta = severityRank[right.severity] - severityRank[left.severity];
      if (severityDelta !== 0) {
        return severityDelta;
      }
      return left.id.localeCompare(right.id);
    });
}

export function locationKeyForTests(finding: Finding): string | undefined {
  return locationKey(finding);
}
