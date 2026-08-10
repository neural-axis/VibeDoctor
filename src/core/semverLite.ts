/**
 * Minimal semver comparison and range satisfaction.
 *
 * VibeDoctor needs to answer one question in several places: "is the runtime we
 * are about to hand a tool new enough for what that tool declares it needs?".
 * The declared requirement comes from arbitrary package metadata
 * (`engines.node`, `requires-python`), so it can use any of the common range
 * shapes. Pulling in the full `semver` package for that would add a runtime
 * dependency to a CLI that currently has three; this covers the shapes real
 * engine fields use and reports "unknown" instead of guessing on anything else.
 */

export type SemVersion = {
  major: number;
  minor: number;
  patch: number;
  prerelease?: string;
};

const VERSION_PATTERN = /(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:[-+]([0-9A-Za-z.-]+))?/;

export function parseVersion(value: string | undefined): SemVersion | undefined {
  if (!value) {
    return undefined;
  }

  const match = VERSION_PATTERN.exec(value.trim());
  if (!match) {
    return undefined;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2] ?? 0),
    patch: Number(match[3] ?? 0),
    prerelease: match[4]
  };
}

export function formatVersion(version: SemVersion): string {
  const base = `${version.major}.${version.minor}.${version.patch}`;
  return version.prerelease ? `${base}-${version.prerelease}` : base;
}

export function compareVersions(left: SemVersion, right: SemVersion): number {
  if (left.major !== right.major) {
    return left.major - right.major;
  }
  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }
  if (left.patch !== right.patch) {
    return left.patch - right.patch;
  }
  // A prerelease sorts below its own release (1.0.0-rc < 1.0.0).
  if (left.prerelease && !right.prerelease) {
    return -1;
  }
  if (!left.prerelease && right.prerelease) {
    return 1;
  }
  return 0;
}

type Comparator = {
  operator: ">=" | ">" | "<=" | "<" | "=";
  version: SemVersion;
};

function comparatorsFor(token: string): Comparator[] | undefined {
  const trimmed = token.trim().replace(/^v/, "");
  if (!trimmed || trimmed === "*" || trimmed === "latest") {
    return [];
  }

  const caret = /^\^\s*(.+)$/.exec(trimmed);
  if (caret) {
    const version = parseVersion(caret[1]);
    if (!version) {
      return undefined;
    }
    const upper: SemVersion =
      version.major > 0
        ? { major: version.major + 1, minor: 0, patch: 0 }
        : version.minor > 0
          ? { major: 0, minor: version.minor + 1, patch: 0 }
          : { major: 0, minor: version.minor, patch: version.patch + 1 };
    return [
      { operator: ">=", version },
      { operator: "<", version: upper }
    ];
  }

  const tilde = /^~\s*(.+)$/.exec(trimmed);
  if (tilde) {
    const version = parseVersion(tilde[1]);
    if (!version) {
      return undefined;
    }
    return [
      { operator: ">=", version },
      { operator: "<", version: { major: version.major, minor: version.minor + 1, patch: 0 } }
    ];
  }

  const explicit = /^(>=|<=|>|<|=)\s*(.+)$/.exec(trimmed);
  if (explicit) {
    const version = parseVersion(explicit[2]);
    if (!version) {
      return undefined;
    }
    return [{ operator: explicit[1] as Comparator["operator"], version }];
  }

  const exact = parseVersion(trimmed);
  return exact ? [{ operator: ">=", version: exact }] : undefined;
}

function satisfiesComparator(version: SemVersion, comparator: Comparator): boolean {
  const delta = compareVersions(version, comparator.version);
  switch (comparator.operator) {
    case ">=":
      return delta >= 0;
    case ">":
      return delta > 0;
    case "<=":
      return delta <= 0;
    case "<":
      return delta < 0;
    case "=":
      return delta === 0;
  }
}

/**
 * Returns `undefined` when the range uses syntax this module does not model, so
 * callers can report "could not verify" rather than a false pass or fail.
 */
export function satisfiesRange(version: SemVersion, range: string | undefined): boolean | undefined {
  if (!range || !range.trim()) {
    return true;
  }

  const alternatives = range.split("||");
  let anyUnderstood = false;

  for (const alternative of alternatives) {
    const tokens = alternative.trim().split(/\s+/).filter(Boolean);
    const comparators: Comparator[] = [];
    let understood = true;

    for (const token of tokens) {
      const parsed = comparatorsFor(token);
      if (!parsed) {
        understood = false;
        break;
      }
      comparators.push(...parsed);
    }

    if (!understood) {
      continue;
    }

    anyUnderstood = true;
    if (comparators.every((comparator) => satisfiesComparator(version, comparator))) {
      return true;
    }
  }

  return anyUnderstood ? false : undefined;
}

/** The lowest version that could satisfy the range, for "you need at least X" messages. */
export function minimumSatisfying(range: string | undefined): string | undefined {
  if (!range) {
    return undefined;
  }

  const candidates = range
    .split("||")
    .flatMap((alternative) => alternative.trim().split(/\s+/).filter(Boolean))
    .flatMap((token) => comparatorsFor(token) ?? [])
    .filter((comparator) => comparator.operator === ">=" || comparator.operator === ">")
    .map((comparator) => comparator.version);

  if (candidates.length === 0) {
    return undefined;
  }

  return formatVersion(candidates.sort(compareVersions)[0]);
}
