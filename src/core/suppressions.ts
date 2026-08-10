import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { Minimatch } from "minimatch";
import { fingerprintFinding, type Finding, type FindingSuppression } from "./finding";

/**
 * Acknowledgement of findings that are known and accepted, with a reason and an
 * expiry date.
 *
 * The only existing lever was the baseline, which answers "was this here
 * before?" and nothing else. There was no way to say "this is a synthetic
 * fixture", "we accept this risk until the Q3 migration", or "this is a false
 * positive because the identifier is a cache key, not a credential" — so the
 * same rejected findings came back every scan and users learned to ignore whole
 * categories. A suppression here must carry a rationale, and one with an expiry
 * stops hiding its findings the day it lapses rather than quietly living forever.
 */

export const SUPPRESSIONS_FILE = ".vibedoctor/suppressions.yml";

export type SuppressionClassification = "false_positive" | "accepted_risk" | "deferred" | "fixture";

export type SuppressionMatch = {
  /** Finding sources this rule applies to. */
  tools?: string[];
  /** Glob patterns against repository-relative paths. */
  paths?: string[];
  /** Finding titles / rule ids, matched case-insensitively as substrings. */
  rules?: string[];
  categories?: string[];
  /** Exact fingerprints, for pinning a single finding. */
  fingerprints?: string[];
};

export type SuppressionRule = {
  id: string;
  reason: string;
  classification: SuppressionClassification;
  owner?: string;
  /** ISO date. Absent means a permanent exemption, which reports call out. */
  expiresAt?: string;
  match: SuppressionMatch;
};

export type InvalidSuppression = {
  id: string;
  problem: string;
};

export type SuppressionReport = {
  file: string;
  /** Rules in force. */
  active: SuppressionRule[];
  /** Rules past their expiry date; their findings are shown again. */
  expired: SuppressionRule[];
  /** Rules that could not be loaded, with the reason. Never silently dropped. */
  invalid: InvalidSuppression[];
  /** Rules with no expiry date, which never lapse on their own. */
  permanent: string[];
  /** How many findings each active rule hid this scan. */
  hits: Record<string, number>;
  /**
   * How many findings each lapsed rule would have hidden. Counted separately
   * from `hits` because these findings are shown, not suppressed; folding them
   * together let a report claim the same finding was both hidden and resurfaced.
   */
  expiredHits: Record<string, number>;
  /** Rules that matched nothing, so they can be cleaned up. */
  unused: string[];
  /** Findings that reappeared because a suppression lapsed. */
  resurfaced: number;
  /**
   * Set when these counts cover more findings than the report they appear in
   * (a category-filtered view), so they are not mistaken for the filtered slice.
   */
  scopeNote?: string;
};

const VALID_CLASSIFICATIONS = new Set<SuppressionClassification>([
  "false_positive",
  "accepted_risk",
  "deferred",
  "fixture"
]);

const MIN_REASON_LENGTH = 12;

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return typeof value === "string" ? [value] : undefined;
  }
  const items = value.filter((item): item is string => typeof item === "string");
  return items.length > 0 ? items : undefined;
}

function parseRule(raw: unknown, index: number): SuppressionRule | InvalidSuppression {
  if (typeof raw !== "object" || raw === null) {
    return { id: `#${index + 1}`, problem: "Entry is not a mapping." };
  }

  const record = raw as Record<string, unknown>;
  const id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : `#${index + 1}`;
  const reason = typeof record.reason === "string" ? record.reason.trim() : "";

  // A suppression without a stated reason is indistinguishable from forgetting
  // why something was hidden, which is the problem this file exists to solve.
  if (reason.length < MIN_REASON_LENGTH) {
    return {
      id,
      problem: `A reason of at least ${MIN_REASON_LENGTH} characters is required explaining why this is acceptable.`
    };
  }

  const classification = record.classification ?? record.kind;
  if (typeof classification !== "string" || !VALID_CLASSIFICATIONS.has(classification as SuppressionClassification)) {
    return {
      id,
      problem: `classification must be one of ${Array.from(VALID_CLASSIFICATIONS).join(", ")}.`
    };
  }

  const rawMatch = (record.match ?? record.matches ?? {}) as Record<string, unknown>;
  const match: SuppressionMatch = {
    tools: asStringArray(rawMatch.tools ?? rawMatch.sources ?? rawMatch.tool),
    paths: asStringArray(rawMatch.paths ?? rawMatch.path ?? rawMatch.files),
    rules: asStringArray(rawMatch.rules ?? rawMatch.rule ?? rawMatch.titles),
    categories: asStringArray(rawMatch.categories ?? rawMatch.category),
    fingerprints: asStringArray(rawMatch.fingerprints ?? rawMatch.fingerprint ?? record.fingerprints)
  };

  // Without at least one criterion the rule would hide the entire report.
  if (!match.tools && !match.paths && !match.rules && !match.categories && !match.fingerprints) {
    return {
      id,
      problem: "At least one match criterion (tools, paths, rules, categories, or fingerprints) is required."
    };
  }

  const expiresRaw = record.expires ?? record.expiresAt ?? record.expires_at;
  let expiresAt: string | undefined;
  if (expiresRaw !== undefined && expiresRaw !== null) {
    const parsed = expiresRaw instanceof Date ? expiresRaw : new Date(String(expiresRaw));
    if (Number.isNaN(parsed.getTime())) {
      return { id, problem: `expires must be a date (got "${String(expiresRaw)}").` };
    }
    expiresAt = parsed.toISOString().slice(0, 10);
  }

  return {
    id,
    reason,
    classification: classification as SuppressionClassification,
    owner: typeof record.owner === "string" ? record.owner : undefined,
    expiresAt,
    match
  };
}

function isInvalid(value: SuppressionRule | InvalidSuppression): value is InvalidSuppression {
  return "problem" in value;
}

export type LoadedSuppressions = {
  file: string;
  rules: SuppressionRule[];
  invalid: InvalidSuppression[];
};

export async function loadSuppressions(root: string, file: string = SUPPRESSIONS_FILE): Promise<LoadedSuppressions> {
  const absolute = path.join(root, file);
  let content: string;
  try {
    content = await fs.readFile(absolute, "utf8");
  } catch {
    return { file, rules: [], invalid: [] };
  }

  let parsed: unknown;
  try {
    parsed = file.endsWith(".json") ? JSON.parse(content) : YAML.parse(content);
  } catch (error) {
    return {
      file,
      rules: [],
      invalid: [{ id: file, problem: `Could not parse: ${error instanceof Error ? error.message : String(error)}` }]
    };
  }

  const record = (parsed ?? {}) as Record<string, unknown>;
  const entries = record.suppressions ?? record.acknowledgements ?? record.rules;
  if (!Array.isArray(entries)) {
    return entries === undefined
      ? { file, rules: [], invalid: [] }
      : { file, rules: [], invalid: [{ id: file, problem: "`suppressions` must be a list." }] };
  }

  const parsedRules = entries.map(parseRule);
  return {
    file,
    rules: parsedRules.filter((rule): rule is SuppressionRule => !isInvalid(rule)),
    invalid: parsedRules.filter(isInvalid)
  };
}

type CompiledRule = {
  rule: SuppressionRule;
  pathMatchers?: Minimatch[];
  expired: boolean;
};

function compile(rule: SuppressionRule, now: Date): CompiledRule {
  return {
    rule,
    pathMatchers: rule.match.paths?.map((pattern) => new Minimatch(pattern, { dot: true })),
    expired: rule.expiresAt !== undefined && new Date(`${rule.expiresAt}T23:59:59Z`).getTime() < now.getTime()
  };
}

function matches(compiled: CompiledRule, finding: Finding, fingerprint: string): boolean {
  const { match } = compiled.rule;

  // Every declared criterion must hold, so rules narrow rather than widen. A
  // fingerprint is a criterion like any other: when it is listed alongside a
  // path or tool, a fingerprint that collides or goes stale must not be able to
  // suppress something the rest of the rule excludes.
  if (match.fingerprints && !match.fingerprints.includes(fingerprint)) {
    return false;
  }
  if (match.tools && !match.tools.includes(finding.source)) {
    return false;
  }
  if (match.categories && !match.categories.includes(finding.category)) {
    return false;
  }
  if (compiled.pathMatchers) {
    const file = finding.file;
    if (!file || !compiled.pathMatchers.some((matcher) => matcher.match(file))) {
      return false;
    }
  }
  if (match.rules) {
    const haystack = `${finding.title} ${finding.evidence?.toolRawId ?? ""}`.toLowerCase();
    if (!match.rules.some((rule) => haystack.includes(rule.toLowerCase()))) {
      return false;
    }
  }

  // A rule with no criteria at all would match everything; parsing rejects those,
  // and this guards against one slipping through.
  return Boolean(match.tools || match.categories || match.paths || match.rules || match.fingerprints);
}

export type ApplySuppressionsResult = {
  /** Findings that survived. Suppressed findings are removed, not hidden in place. */
  findings: Finding[];
  /** Suppressed findings, kept so reports can show what was acknowledged. */
  suppressed: Finding[];
  report: SuppressionReport;
};

export type ApplySuppressionsOptions = {
  now?: Date;
  /**
   * Reject acknowledgements with no expiry date rather than letting them hide
   * findings forever. Rejected rules appear in `invalid` with the reason.
   */
  requireExpiry?: boolean;
};

/**
 * Applies suppressions to findings. Expired rules do not suppress; instead their
 * findings are marked `resurfaced` so a lapsed acknowledgement is visible rather
 * than being mistaken for a new regression.
 */
export function applySuppressions(
  findings: Finding[],
  loaded: LoadedSuppressions,
  options: ApplySuppressionsOptions = {}
): ApplySuppressionsResult {
  const now = options.now ?? new Date();

  // Enforced here rather than at parse time because whether a permanent
  // acknowledgement is acceptable is a policy question the config answers.
  const invalid = [...loaded.invalid];
  const usable: SuppressionRule[] = [];
  for (const rule of loaded.rules) {
    if (options.requireExpiry && !rule.expiresAt) {
      invalid.push({
        id: rule.id,
        problem: "An expiry date is required (suppressions.require_expiry is on), so this rule was not applied."
      });
      continue;
    }
    usable.push(rule);
  }

  const compiled = usable.map((rule) => compile(rule, now));
  const hits: Record<string, number> = {};
  const expiredHits: Record<string, number> = {};
  const kept: Finding[] = [];
  const suppressed: Finding[] = [];
  let resurfaced = 0;

  for (const finding of findings) {
    const fingerprint = fingerprintFinding(finding);
    const hit = compiled.find((candidate) => matches(candidate, finding, fingerprint));

    if (!hit) {
      kept.push(finding);
      continue;
    }

    const tally = hit.expired ? expiredHits : hits;
    tally[hit.rule.id] = (tally[hit.rule.id] ?? 0) + 1;

    const suppression: FindingSuppression = {
      ruleId: hit.rule.id,
      classification: hit.rule.classification,
      reason: hit.rule.reason,
      owner: hit.rule.owner,
      expiresAt: hit.rule.expiresAt,
      expired: hit.expired
    };

    if (hit.expired) {
      resurfaced += 1;
      kept.push({
        ...finding,
        suppression,
        baselineState: "resurfaced",
        // Surface the lapse in the message itself; a report reader should not
        // have to cross-reference the suppressions file to understand why this
        // reappeared.
        message: `${finding.message} (suppression "${hit.rule.id}" expired ${hit.rule.expiresAt})`
      });
      continue;
    }

    suppressed.push({ ...finding, suppression });
  }

  const active = compiled.filter((candidate) => !candidate.expired).map((candidate) => candidate.rule);
  const expired = compiled.filter((candidate) => candidate.expired).map((candidate) => candidate.rule);

  return {
    findings: kept,
    suppressed,
    report: {
      file: loaded.file,
      active,
      expired,
      invalid,
      permanent: active.filter((rule) => !rule.expiresAt).map((rule) => rule.id),
      hits,
      expiredHits,
      // A lapsed rule that matched is still in use, so it is not dead weight to
      // clean up — only a rule that matched nothing is.
      unused: usable.filter((rule) => !hits[rule.id] && !expiredHits[rule.id]).map((rule) => rule.id),
      resurfaced
    }
  };
}

export function renderSuppressionLines(report: SuppressionReport): string[] {
  const lines: string[] = [];
  const suppressedTotal = Object.values(report.hits).reduce((sum, count) => sum + count, 0);

  if (suppressedTotal > 0) {
    lines.push(`Suppressed: ${suppressedTotal} finding(s) via ${Object.keys(report.hits).length} acknowledgement(s)`);
    if (report.scopeNote) {
      lines.push(`- ${report.scopeNote}`);
    }
    for (const [ruleId, count] of Object.entries(report.hits)) {
      const rule = report.active.find((candidate) => candidate.id === ruleId);
      const expiry = rule?.expiresAt ? `expires ${rule.expiresAt}` : "no expiry";
      lines.push(`- ${ruleId}: ${count} finding(s) — ${rule?.reason ?? "reason unavailable"} (${expiry})`);
    }
  }

  if (report.expired.length > 0) {
    lines.push(
      `Expired acknowledgements: ${report.expired
        .map((rule) => {
          const count = report.expiredHits[rule.id] ?? 0;
          return `${rule.id} (${rule.expiresAt}${count > 0 ? `, ${count} finding(s) shown again` : ""})`;
        })
        .join(", ")} — their findings are no longer hidden.`
    );
  }

  if (report.invalid.length > 0) {
    lines.push(`Rejected acknowledgements in ${report.file}:`);
    for (const invalid of report.invalid) {
      lines.push(`- ${invalid.id}: ${invalid.problem}`);
    }
  }

  if (report.permanent.length > 0) {
    lines.push(`Permanent acknowledgements (no expiry): ${report.permanent.join(", ")}`);
  }

  if (report.unused.length > 0) {
    lines.push(`Acknowledgements that matched nothing: ${report.unused.join(", ")}`);
  }

  return lines;
}

export const SUPPRESSIONS_TEMPLATE = `# VibeDoctor acknowledgements.
#
# Each entry hides findings that are known and accepted. A reason is required,
# and an expiry date is strongly recommended: when it passes, the findings come
# back marked "resurfaced" instead of staying hidden indefinitely.
version: 1
suppressions:
  # - id: fixture-credentials
  #   reason: Synthetic credentials in test fixtures, never used against real systems.
  #   classification: fixture      # false_positive | accepted_risk | deferred | fixture
  #   owner: platform-team
  #   expires: 2026-12-31
  #   match:
  #     tools: [gitleaks]
  #     paths: ["fixtures/**"]
`;
