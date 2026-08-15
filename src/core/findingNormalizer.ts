import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileRoleClassifier } from "./fileRole";
import {
  FINDING_CATEGORIES,
  type EvidenceGrade,
  type Finding,
  type FindingSource,
  type LocationQuality
} from "./finding";

/**
 * Normalizes whatever adapters produce into a consistent finding.
 *
 * Adapters translate tool output by hand, so each one can lose a different thing:
 * one drops line numbers because its tool reports byte offsets, another emits a
 * severity string the report has no rendering for. The losses were invisible —
 * the report simply had no location, and nothing said why. This pass fills in
 * what can be recovered, records how precise each location actually is, and
 * counts what could not be recovered so the capability matrix can disclose it.
 */

export type NormalizationIssue = {
  tool: string;
  kind: "missing_location" | "unresolved_offset" | "invalid_enum" | "missing_message";
  count: number;
  detail: string;
};

export type NormalizationResult = {
  findings: Finding[];
  issues: NormalizationIssue[];
  /** Share of findings from this tool with no usable position, 0..1. */
  locationLossRate: number;
};

/**
 * Default evidence grade per source. A tool that reports what the compiler
 * proved is not making the same kind of claim as one matching a regex against
 * identifiers, and the report should not present them identically.
 */
const DEFAULT_EVIDENCE_GRADE: Partial<Record<FindingSource, EvidenceGrade>> = {
  tsc: "verified",
  pyright: "verified",
  biome: "verified",
  ruff: "verified",
  vitest: "verified",
  jest: "verified",
  "coverage.py": "verified",
  "osv-scanner": "verified",
  deptry: "verified",
  radon: "verified",
  lizard: "verified",
  jscpd: "verified",
  semgrep: "observed",
  gitleaks: "observed",
  presidio: "observed",
  knip: "observed",
  vulture: "heuristic",
  "privacy-detector": "heuristic",
  "telemetry-detector": "heuristic",
  "privacy-ai-review": "heuristic",
  "custom-leftovers": "observed",
  "custom-refactor": "verified",
  "custom-dead-chain": "heuristic",
  "flow-doctor": "verified",
  dpdp: "heuristic"
};

const VALID_CATEGORIES = new Set<string>(FINDING_CATEGORIES);
const VALID_SEVERITIES = new Set(["info", "low", "medium", "high", "critical"]);
const VALID_CONFIDENCE = new Set(["low", "medium", "high"]);

function locationQualityFor(finding: Finding): LocationQuality {
  if (!finding.file) {
    return "repository";
  }
  if (finding.startLine === undefined) {
    return "file_only";
  }
  return finding.startColumn === undefined ? "line_only" : "exact";
}

/**
 * Converts a byte offset into a 1-based line and column. Tools that report
 * offsets (Biome among them) otherwise arrive with no position at all, because
 * the report only understands lines.
 */
function offsetToPosition(content: string, offset: number): { line: number; column: number } | undefined {
  if (offset < 0 || offset > Buffer.byteLength(content, "utf8")) {
    return undefined;
  }

  // Walk by byte length so multi-byte characters do not shift the result.
  let bytes = 0;
  let line = 1;
  let column = 1;

  for (const character of content) {
    if (bytes >= offset) {
      break;
    }
    bytes += Buffer.byteLength(character, "utf8");
    if (character === "\n") {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

type FileReader = (file: string) => Promise<string | undefined>;

function createFileReader(root: string): FileReader {
  const cache = new Map<string, string | undefined>();
  return async (file) => {
    if (cache.has(file)) {
      return cache.get(file);
    }
    let content: string | undefined;
    try {
      content = await fs.readFile(path.join(root, file), "utf8");
    } catch {
      content = undefined;
    }
    cache.set(file, content);
    return content;
  };
}

export type NormalizeOptions = {
  root: string;
  tool: string;
  classifyFile: FileRoleClassifier;
  changedFiles?: string[];
};

export async function normalizeFindings(raw: Finding[], options: NormalizeOptions): Promise<NormalizationResult> {
  const issues = new Map<NormalizationIssue["kind"], NormalizationIssue>();
  const readFile = createFileReader(options.root);
  const changed = new Set(options.changedFiles ?? []);
  const findings: Finding[] = [];
  let withoutLocation = 0;

  function note(kind: NormalizationIssue["kind"], detail: string) {
    const existing = issues.get(kind);
    if (existing) {
      existing.count += 1;
      return;
    }
    issues.set(kind, { tool: options.tool, kind, count: 1, detail });
  }

  for (const item of raw) {
    const finding: Finding = { ...item };

    if (!VALID_CATEGORIES.has(finding.category)) {
      note("invalid_enum", `Unknown category "${finding.category}" was reported as maintainability.`);
      finding.category = "maintainability";
    }
    if (!VALID_SEVERITIES.has(finding.severity)) {
      note("invalid_enum", `Unknown severity "${finding.severity}" was reported as medium.`);
      finding.severity = "medium";
    }
    if (!VALID_CONFIDENCE.has(finding.confidence)) {
      note("invalid_enum", `Unknown confidence "${finding.confidence}" was reported as low.`);
      finding.confidence = "low";
    }
    if (!finding.message?.trim()) {
      note("missing_message", "A finding arrived with no message; its title was used instead.");
      finding.message = finding.title || `${options.tool} reported an issue.`;
    }

    // Recover a position from a byte offset when the tool reports offsets only.
    if (finding.file && finding.startLine === undefined && finding.evidence?.startOffset !== undefined) {
      const content = await readFile(finding.file);
      const position = content ? offsetToPosition(content, finding.evidence.startOffset) : undefined;
      if (position) {
        finding.startLine = position.line;
        finding.startColumn = position.column;
        if (finding.evidence.endOffset !== undefined && content) {
          finding.endLine = offsetToPosition(content, finding.evidence.endOffset)?.line ?? position.line;
        }
      } else {
        note(
          "unresolved_offset",
          `${options.tool} reported byte offsets that could not be mapped to lines (file unreadable or offset out of range).`
        );
      }
    }

    finding.locationQuality = locationQualityFor(finding);
    if (finding.locationQuality === "file_only" || finding.locationQuality === "repository") {
      withoutLocation += 1;
      if (finding.locationQuality === "file_only") {
        note("missing_location", `${options.tool} reported findings without a line number.`);
      }
    }

    finding.evidenceGrade ??= DEFAULT_EVIDENCE_GRADE[finding.source] ?? "observed";
    finding.fileRole ??= options.classifyFile(finding.file);
    finding.inChangedFile ??= finding.file ? changed.has(finding.file) : false;
    finding.tags = Array.from(new Set(finding.tags ?? []));

    findings.push(finding);
  }

  return {
    findings,
    issues: Array.from(issues.values()),
    locationLossRate: raw.length === 0 ? 0 : withoutLocation / raw.length
  };
}

/** Human-readable summary of what a tool's output lost, for the capability matrix. */
export function describeNormalizationIssues(issues: NormalizationIssue[]): string | undefined {
  if (issues.length === 0) {
    return undefined;
  }

  return issues.map((issue) => `${issue.detail} (${issue.count})`).join(" ");
}
