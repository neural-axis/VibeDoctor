import type { Finding } from "../core/finding";
import { normalizeFilePath } from "../core/finding";
import { adapterTargets, type ToolAdapter } from "./shared";

type BiomePosition = { line?: number; column?: number };

/**
 * Biome's JSON reporter has changed shape across versions, and the adapter only
 * understood one of them: it read `description`, `location.path.file`, and
 * `location.span.start.line`, none of which the current reporter emits. Every
 * Biome finding therefore arrived with no file, no line, and a placeholder
 * message. All the shapes below are accepted so a version bump degrades a field
 * rather than the whole check.
 */
type BiomeDiagnostic = {
  category?: string;
  severity?: "info" | "warn" | "error" | "hint" | "fatal";
  /** Current reporter. May be plain text or an array of markup chunks. */
  message?: string | Array<{ content?: string } | string>;
  /** Older reporter. */
  description?: string;
  location?: {
    /** String in current versions; an object in older ones. */
    path?: string | { file?: string };
    /** Current reporter, zero-based. */
    start?: BiomePosition;
    end?: BiomePosition;
    /** Older reporters: either a byte-offset pair or a nested line/column pair. */
    span?: [number, number] | { start?: BiomePosition; end?: BiomePosition };
  };
  tags?: string[];
  advices?: unknown;
};

type BiomeReport = {
  diagnostics?: BiomeDiagnostic[];
};

/**
 * Biome writes Windows paths into JSON strings without escaping the separator,
 * producing output that is not valid JSON (`"src\core\finding.ts"`). Parsing
 * threw, and the engine swallowed the error, so Biome silently contributed
 * nothing on every Windows repository.
 *
 * The repair is confined to the `path` field. A blanket pass over the whole
 * document would corrupt diagnostic text, because `\n` and `\t` are both real
 * escapes there and plausible path segments here (`\node_modules`, `\test`) —
 * only in a path is a backslash unambiguously a separator.
 */
function repairPathSeparators(raw: string): string {
  return raw.replace(/("path"\s*:\s*")((?:[^"\\]|\\.)*)(")/g, (_match, open, value: string, close) => {
    return `${open}${value.replaceAll("\\", "\\\\")}${close}`;
  });
}

/** Last resort: escape any backslash that does not begin a valid JSON escape. */
function repairInvalidEscapes(raw: string): string {
  return raw.replace(/\\(?!["\\/bfnrtu])/g, "\\\\");
}

function parseBiomeOutput(stdout: string): BiomeDiagnostic[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  // Each fallback assumes more than the last, so the least invasive repair that
  // works is the one that gets used.
  for (const candidate of [trimmed, repairPathSeparators(trimmed), repairInvalidEscapes(trimmed)]) {
    try {
      return (JSON.parse(candidate) as BiomeReport).diagnostics ?? [];
    } catch {
      continue;
    }
  }

  // Let the caller record a parse failure; a tool whose output cannot be read
  // has not checked anything, and must not look like a clean run.
  throw new SyntaxError("Biome output was not valid JSON, even after repairing path separators.");
}

function readMessage(item: BiomeDiagnostic): string | undefined {
  if (typeof item.message === "string") {
    return item.message;
  }

  if (Array.isArray(item.message)) {
    const text = item.message
      .map((chunk) => (typeof chunk === "string" ? chunk : (chunk.content ?? "")))
      .join("")
      .trim();
    if (text) {
      return text;
    }
  }

  return item.description;
}

function readFile(item: BiomeDiagnostic): string | undefined {
  const path = item.location?.path;
  return typeof path === "string" ? path : path?.file;
}

function mapSeverity(level: BiomeDiagnostic["severity"]): Finding["severity"] {
  if (level === "fatal") {
    return "high";
  }
  if (level === "error") {
    return "medium";
  }
  if (level === "warn") {
    return "low";
  }
  return "info";
}

type BiomeLocation = {
  startLine?: number;
  endLine?: number;
  startColumn?: number;
  startOffset?: number;
  endOffset?: number;
};

/** Biome reports zero-based line and column numbers; editors and reports use one-based. */
function toOneBased(value: number | undefined): number | undefined {
  return typeof value === "number" ? value + 1 : undefined;
}

function readLocation(location: BiomeDiagnostic["location"]): BiomeLocation {
  if (!location) {
    return {};
  }

  if (location.start) {
    return {
      startLine: toOneBased(location.start.line),
      endLine: toOneBased(location.end?.line ?? location.start.line),
      startColumn: toOneBased(location.start.column)
    };
  }

  const span = location.span;
  if (!span) {
    return {};
  }

  if (Array.isArray(span)) {
    const [start, end] = span;
    return {
      startOffset: typeof start === "number" ? start : undefined,
      endOffset: typeof end === "number" ? end : undefined
    };
  }

  return {
    startLine: toOneBased(span.start?.line),
    endLine: toOneBased(span.end?.line),
    startColumn: toOneBased(span.start?.column)
  };
}

/**
 * Biome's rule categories double as its rule identifiers, and the safe-fix
 * boundary follows the rule group: formatting and simple lint rules are safe to
 * apply unattended, while `suspicious`/`security` rules generally need a human.
 */
function isSafeToAutofix(category: string | undefined): boolean {
  if (!category) {
    return false;
  }
  return /^(?:format|lint\/(?:style|complexity|correctness|performance|nursery))/.test(category);
}

export const biomeAdapter: ToolAdapter = {
  id: "biome",
  category: "correctness",
  async detect(project) {
    return project.languages.includes("javascript") || project.languages.includes("typescript");
  },
  buildScanCommand(ctx) {
    const targets = adapterTargets(ctx, /\.(?:js|jsx|ts|tsx|json|jsonc)$/i);
    return {
      cmd: "biome",
      args: ["check", ...targets, "--reporter=json"],
      cwd: ctx.root,
      timeoutMs: 180_000
    };
  },
  parseResult(result, ctx) {
    return parseBiomeOutput(result.stdout).map((item, index) => {
      const rawFile = readFile(item);
      const file = normalizeFilePath(rawFile, ctx.root);
      const location = readLocation(item.location);
      const safeToAutofix = isSafeToAutofix(item.category);

      return {
        id: `biome:${file ?? "unknown"}:${location.startOffset ?? location.startLine ?? index}:${item.category ?? index}`,
        source: "biome",
        category: "correctness",
        severity: mapSeverity(item.severity),
        confidence: "high",
        title: item.category ?? "biome",
        message: readMessage(item) ?? "Biome reported an issue.",
        file,
        startLine: location.startLine,
        endLine: location.endLine,
        startColumn: location.startColumn,
        isNew: true,
        isAutofixable: true,
        safeToAutofix,
        // Point the fix at the file that needs it rather than the whole
        // repository, so applying one finding's fix cannot rewrite unrelated code.
        fixCommand: file ? `biome check ${file} --write` : "biome check . --write",
        agentInstruction: safeToAutofix
          ? "Apply Biome's safe write mode for this file."
          : "Review this rule before applying Biome's fix; it can change behaviour.",
        tags: ["javascript", "typescript", ...(item.tags ?? [])],
        evidence: {
          toolRawId: item.category,
          // Offsets are converted to line and column during normalization, which
          // is where every tool's position model is reconciled.
          startOffset: location.startOffset,
          endOffset: location.endOffset
        },
        scoreImpact: 0
      } satisfies Finding;
    });
  },
  buildFixCommand(ctx) {
    const targets = adapterTargets(ctx, /\.(?:js|jsx|ts|tsx|json|jsonc)$/i);
    return {
      cmd: "biome",
      args: ["check", ...targets, "--write"],
      cwd: ctx.root,
      timeoutMs: 180_000
    };
  },
  installHint: "Install Biome with: npm install -D @biomejs/biome"
};
