/**
 * Decides whether a string is plausibly a credential.
 *
 * Secret scanners match on assignment shape, so any identifier whose name ends
 * in `key`, `token`, or `secret` can be reported as a critical leak — including
 * ordinary map keys like `format_key` or `thread_key`. Reporting those at
 * critical severity trains users to ignore the secrets category entirely, which
 * costs more than the occasional missed finding. This evaluates the matched text
 * itself: a real credential is high-entropy and structureless, while an
 * identifier is short, lowercase, and made of dictionary-shaped words.
 */

export type CredentialAssessment = {
  /** Best guess at what the matched text is. */
  verdict: "credential" | "identifier" | "placeholder" | "unknown";
  /** Shannon entropy in bits per character. */
  entropy: number;
  /** Why the verdict was reached, for the report. */
  reason: string;
};

/** Prefixes that are self-identifying credentials regardless of entropy. */
const KNOWN_CREDENTIAL_PREFIXES = [
  "sk-",
  "pk-",
  "rk_",
  "ghp_",
  "gho_",
  "ghu_",
  "ghs_",
  "ghr_",
  "github_pat_",
  "glpat-",
  "xox",
  "AKIA",
  "ASIA",
  "AIza",
  "ya29.",
  "SG.",
  "dop_v1_",
  "shpat_",
  "npm_",
  "hf_",
  "-----BEGIN"
];

/** Values that exist to be replaced, not protected. */
const PLACEHOLDER_PATTERNS = [
  /^(?:x{3,}|\*{3,}|\.{3,}|-{3,})$/i,
  /^(?:your|my|the)[-_ ]?(?:api[-_ ]?)?(?:key|token|secret|password)$/i,
  /^(?:changeme|change[-_ ]me|replace[-_ ]me|todo|tbd|none|null|undefined|empty|example|sample|dummy|test|fake|foo|bar|baz)$/i,
  /^(?:REDACTED|MASKED|HIDDEN|SECRET|PASSWORD|API[-_]?KEY)$/i,
  /^\$\{?[A-Z0-9_]+\}?$/,
  /^<[^>]+>$/,
  /^\{\{.*\}\}$/,
  /^process\.env\./,
  /^os\.(?:environ|getenv)/
];

/** Shapes a programmer writes deliberately: identifiers, paths, dotted names. */
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9]*(?:[_-][a-z0-9]+)*$/;
const CAMEL_CASE_PATTERN = /^[a-z][a-zA-Z0-9]*$/;
const DOTTED_PATH_PATTERN = /^[a-zA-Z_][\w-]*(?:[./][\w-]+)+$/;

export function shannonEntropy(value: string): number {
  if (value.length === 0) {
    return 0;
  }

  const counts = new Map<string, number>();
  for (const character of value) {
    counts.set(character, (counts.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of counts.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }

  return entropy;
}

/**
 * Splits on case and separator boundaries. An identifier made entirely of short
 * word-like segments is a name; a credential is not decomposable that way.
 */
function wordSegments(value: string): string[] {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(/[\s_\-./]+/)
    .filter(Boolean);
}

function looksLikeWords(value: string): boolean {
  const segments = wordSegments(value);
  if (segments.length === 0) {
    return false;
  }
  // Every segment alphabetic and of pronounceable length.
  return segments.every((segment) => /^[A-Za-z]{2,14}$/.test(segment));
}

const MIN_CREDENTIAL_LENGTH = 16;
const CREDENTIAL_ENTROPY_THRESHOLD = 3.2;

export function assessCredential(value: string | undefined): CredentialAssessment {
  const trimmed = value?.trim().replace(/^["'`]|["'`]$/g, "") ?? "";

  if (!trimmed) {
    return { verdict: "unknown", entropy: 0, reason: "No matched value was available to evaluate." };
  }

  if (KNOWN_CREDENTIAL_PREFIXES.some((prefix) => trimmed.startsWith(prefix))) {
    return {
      verdict: "credential",
      entropy: shannonEntropy(trimmed),
      reason: "Value carries a recognised credential prefix."
    };
  }

  if (PLACEHOLDER_PATTERNS.some((pattern) => pattern.test(trimmed))) {
    return {
      verdict: "placeholder",
      entropy: shannonEntropy(trimmed),
      reason: "Value is a placeholder or an environment-variable reference, not a literal credential."
    };
  }

  const entropy = shannonEntropy(trimmed);

  if (trimmed.length < MIN_CREDENTIAL_LENGTH && (IDENTIFIER_PATTERN.test(trimmed) || CAMEL_CASE_PATTERN.test(trimmed))) {
    return {
      verdict: "identifier",
      entropy,
      reason: `Value is a ${trimmed.length}-character identifier ("${trimmed}"), too short and too structured to be a credential.`
    };
  }

  if (DOTTED_PATH_PATTERN.test(trimmed) && entropy < CREDENTIAL_ENTROPY_THRESHOLD) {
    return {
      verdict: "identifier",
      entropy,
      reason: "Value is a dotted or path-like name rather than an opaque token."
    };
  }

  if (looksLikeWords(trimmed) && entropy < CREDENTIAL_ENTROPY_THRESHOLD) {
    return {
      verdict: "identifier",
      entropy,
      reason: `Value decomposes into dictionary-shaped words (entropy ${entropy.toFixed(2)} bits/char).`
    };
  }

  if (entropy < CREDENTIAL_ENTROPY_THRESHOLD && trimmed.length < 32) {
    return {
      verdict: "identifier",
      entropy,
      reason: `Entropy ${entropy.toFixed(2)} bits/char over ${trimmed.length} characters is below what a generated credential shows.`
    };
  }

  return {
    verdict: "credential",
    entropy,
    reason: `Entropy ${entropy.toFixed(2)} bits/char over ${trimmed.length} characters is consistent with a generated credential.`
  };
}

/** Masks a value for reporting, keeping enough to recognise it. */
export function maskValue(value: string | undefined): string | undefined {
  if (!value) {
    return undefined;
  }
  const trimmed = value.trim();
  if (trimmed.length <= 8) {
    return `${trimmed.slice(0, 2)}${"*".repeat(Math.max(0, trimmed.length - 2))}`;
  }
  return `${trimmed.slice(0, 4)}${"*".repeat(6)}${trimmed.slice(-2)}`;
}

/**
 * Pulls the candidate secret out of a source line. Scanners often redact their
 * own output, so the line the finding points at is the only place left to look.
 */
export function extractAssignedValue(line: string | undefined): string | undefined {
  if (!line) {
    return undefined;
  }

  // Quoted literal on the right of an assignment, mapping, or argument.
  const quoted = /(?::|=|=>|,)\s*(?:r|b|f|u)?(["'`])((?:(?!\1).){3,})\1/.exec(line);
  if (quoted) {
    return quoted[2];
  }

  // Bare value after an assignment (env files, YAML, INI).
  const bare = /^[\s#-]*[A-Za-z_][\w.-]*\s*[:=]\s*([^\s"'#]{3,})\s*$/.exec(line);
  if (bare) {
    return bare[1];
  }

  // Any long quoted literal anywhere on the line.
  const anyQuoted = /(["'`])((?:(?!\1).){8,})\1/.exec(line);
  return anyQuoted?.[2];
}
