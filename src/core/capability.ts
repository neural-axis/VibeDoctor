import type { FindingCategory } from "./finding";
import type { ToolCoverage } from "./toolRunner";

/**
 * The capability matrix: one row per tool VibeDoctor considered, recording what
 * actually happened to it.
 *
 * The previous model had two lists — `toolStatuses` and `skippedTools` — which
 * could not express the distinctions that matter. A tool that was installed but
 * never ran, a tool that ran but only over part of the repo, and a tool that was
 * never applicable all collapsed into "skipped". Reports built on that could say
 * a tool was installed while its findings were absent, with no way to tell which
 * link in the chain broke. Each facet below is recorded independently, and
 * `state` is derived from them rather than asserted.
 */

export type CapabilityState =
  /** Ran to completion over the full requested scope. */
  | "completed"
  /** Ran, but covered less than the requested scope (scoped fallback after a timeout). */
  | "partial"
  /** Exceeded its time budget and was killed. */
  | "timed_out"
  /** Ran and failed, or produced output that could not be parsed. */
  | "failed"
  /** Not present on PATH. */
  | "not_installed"
  /** Present, but the runtime cannot run it. */
  | "runtime_incompatible"
  /** Deliberately deferred by configuration. */
  | "deferred"
  /** Turned off by configuration. */
  | "disabled"
  /** Nothing in this repository for it to analyse. */
  | "not_applicable"
  /** Excluded by the current scan mode (for example a full-scan-only tool in quick mode). */
  | "not_selected";

/** Whether findings from this tool can be trusted as covering the repository. */
export type CapabilityTrust = "authoritative" | "partial" | "absent";

export type ToolCapability = {
  id: string;
  category: FindingCategory;
  state: CapabilityState;

  /** Selected for this scan mode. */
  planned: boolean;
  /** There is something in this repository for the tool to analyse. */
  applicable: boolean;
  /** Found on PATH (or importable, for module-driven tools). */
  discovered: boolean;
  /** Started at least once. */
  executed: boolean;

  resolvedPath?: string;
  version?: string;
  /** Exact command line that ran, so any row can be reproduced by hand. */
  command?: string;

  durationMs?: number;
  timeoutSeconds?: number;
  coverage?: ToolCoverage;

  /** Findings the tool reported, before relevance filtering and suppressions. */
  findingsReported: number;
  /** Findings that reached the report. Differs from reported whenever filters ran. */
  findingsSurfaced: number;

  /** Why this row ended in this state. Always populated. */
  reason: string;
  /** What to do about it, when there is something to do. */
  remediation?: string;

  trust: CapabilityTrust;
};

const COMPLETE_STATES = new Set<CapabilityState>(["completed"]);
const RAN_STATES = new Set<CapabilityState>(["completed", "partial", "timed_out", "failed"]);

export function trustForState(state: CapabilityState): CapabilityTrust {
  if (COMPLETE_STATES.has(state)) {
    return "authoritative";
  }
  if (state === "partial") {
    return "partial";
  }
  // "not_applicable", "disabled" and "not_selected" are deliberate: there is no
  // missing coverage to disclose, so they do not weaken the report.
  if (state === "not_applicable" || state === "disabled" || state === "not_selected") {
    return "authoritative";
  }
  return "absent";
}

/**
 * States that mean "this check did not happen and you should know". Deliberate
 * exclusions are not gaps; a tool that timed out or is missing is.
 */
export function isCoverageGap(capability: ToolCapability): boolean {
  return capability.trust === "absent" || capability.trust === "partial";
}

export function didRun(capability: ToolCapability): boolean {
  return RAN_STATES.has(capability.state);
}

export type CapabilityMatrix = {
  tools: ToolCapability[];
  counts: Record<CapabilityState, number>;
  /** Tools whose absence or partial coverage limits what the report can claim. */
  gaps: string[];
  /** Gaps for tools the config marks required. */
  requiredGaps: string[];
  /** True when every planned tool completed over full scope. */
  fullCoverage: boolean;
};

const EMPTY_COUNTS: Record<CapabilityState, number> = {
  completed: 0,
  partial: 0,
  timed_out: 0,
  failed: 0,
  not_installed: 0,
  runtime_incompatible: 0,
  deferred: 0,
  disabled: 0,
  not_applicable: 0,
  not_selected: 0
};

export function buildCapabilityMatrix(tools: ToolCapability[], requiredTools: string[]): CapabilityMatrix {
  const sorted = [...tools].sort((left, right) => left.id.localeCompare(right.id));
  const counts = { ...EMPTY_COUNTS };
  for (const tool of sorted) {
    counts[tool.state] += 1;
  }

  const gaps = sorted.filter(isCoverageGap).map((tool) => tool.id);
  const required = new Set(requiredTools);

  return {
    tools: sorted,
    counts,
    gaps,
    requiredGaps: gaps.filter((id) => required.has(id)),
    fullCoverage: sorted.every((tool) => !isCoverageGap(tool))
  };
}

const STATE_LABELS: Record<CapabilityState, string> = {
  completed: "completed",
  partial: "partial",
  timed_out: "timed out",
  failed: "failed",
  not_installed: "not installed",
  runtime_incompatible: "runtime mismatch",
  deferred: "deferred",
  disabled: "disabled",
  not_applicable: "not applicable",
  not_selected: "not selected"
};

export function capabilityStateLabel(state: CapabilityState): string {
  return STATE_LABELS[state];
}

function formatDuration(durationMs: number | undefined): string {
  if (durationMs === undefined) {
    return "";
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`;
}

/**
 * Renders the matrix as aligned text. Every row states what happened, why, and
 * what to do — including the findings-reported vs findings-surfaced split, so a
 * tool that ran but had everything filtered out cannot look like a tool that
 * found nothing.
 */
export function renderCapabilityMatrixLines(matrix: CapabilityMatrix): string[] {
  if (matrix.tools.length === 0) {
    return [];
  }

  const rows = matrix.tools.map((tool) => ({
    id: tool.id,
    state: capabilityStateLabel(tool.state),
    findings:
      tool.findingsReported === tool.findingsSurfaced
        ? String(tool.findingsSurfaced)
        : `${tool.findingsSurfaced} of ${tool.findingsReported}`,
    time: formatDuration(tool.durationMs),
    detail: tool.reason
  }));

  const idWidth = Math.max(4, ...rows.map((row) => row.id.length));
  const stateWidth = Math.max(6, ...rows.map((row) => row.state.length));
  const findingsWidth = Math.max(8, ...rows.map((row) => row.findings.length));
  const timeWidth = Math.max(4, ...rows.map((row) => row.time.length));

  const lines = [
    `${"TOOL".padEnd(idWidth)}  ${"STATE".padEnd(stateWidth)}  ${"FINDINGS".padEnd(findingsWidth)}  ${"TIME".padEnd(timeWidth)}  DETAIL`
  ];

  for (const row of rows) {
    lines.push(
      `${row.id.padEnd(idWidth)}  ${row.state.padEnd(stateWidth)}  ${row.findings.padEnd(findingsWidth)}  ${row.time.padEnd(timeWidth)}  ${row.detail}`
    );
  }

  const remediations = matrix.tools.filter((tool) => tool.remediation && isCoverageGap(tool));
  if (remediations.length > 0) {
    lines.push("");
    lines.push("TO RESTORE COVERAGE");
    for (const tool of remediations) {
      lines.push(`- ${tool.id}: ${tool.remediation}`);
    }
  }

  return lines;
}
