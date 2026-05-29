import path from "node:path";
import { filterPaths, readTextIfExists } from "../core/paths";
import { LEFTOVER_NAME_PATTERNS, LEFTOVER_PATTERNS } from "../rules/leftoverPatterns";
import type { Finding } from "../core/finding";
import type { ToolAdapter } from "./shared";

type MatchInfo = {
  group: string;
  pattern: string;
  file: string;
  line: number;
  lineText: string;
  confidence?: "low" | "medium" | "high";
  severity?: "low" | "medium";
  instruction?: string;
};

const COMMENT_PREFIX = {
  ".ts": "//",
  ".tsx": "//",
  ".js": "//",
  ".jsx": "//",
  ".py": "#"
} as const;

function looksLikeCommentedCode(text: string): boolean {
  return /\b(const|let|var|function|class|return|def|import|from)\b/.test(text);
}

function shouldIgnoreComment(commentText: string): boolean {
  return /^changelog\b|^release notes?\b|^copyright\b/i.test(commentText.trim());
}

function findCommentMatches(file: string, content: string): MatchInfo[] {
  const extension = path.extname(file) as keyof typeof COMMENT_PREFIX;
  const commentPrefix = COMMENT_PREFIX[extension];
  if (!commentPrefix) {
    return [];
  }

  const matches: MatchInfo[] = [];
  const lines = content.split(/\r?\n/);

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith(commentPrefix) || trimmed.startsWith("/*") || trimmed.startsWith("*");
    if (!isComment) {
      continue;
    }

    const commentText = trimmed.replace(/^\/\//, "").replace(/^#/, "").replace(/^\/\*/, "").replace(/^\*/, "").trim();
    if (shouldIgnoreComment(commentText)) {
      continue;
    }
    const lower = commentText.toLowerCase();

    for (const [group, patterns] of Object.entries(LEFTOVER_PATTERNS)) {
      for (const pattern of patterns) {
        if (lower.includes(pattern)) {
          matches.push({
            group,
            pattern,
            file,
            line: index + 1,
            lineText: commentText,
            confidence: "medium",
            severity: "low"
          });
        }
      }
    }

    if (looksLikeCommentedCode(commentText)) {
      matches.push({
        group: "commented-code",
        pattern: "commented code",
        file,
        line: index + 1,
        lineText: commentText,
        confidence: "high",
        severity: "low"
      });
    }
  }

  return matches;
}

function findNameMatches(file: string, content: string): MatchInfo[] {
  const lines = content.split(/\r?\n/);
  const matches: MatchInfo[] = [];

  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    if (!/\b(function|class|const|let|var|export|def)\b/.test(lower)) {
      continue;
    }

    for (const pattern of LEFTOVER_NAME_PATTERNS) {
      if (new RegExp(`\\b${pattern}[a-z0-9_]*`, "i").test(line)) {
        matches.push({
          group: "name-signal",
          pattern,
          file,
          line: index + 1,
          lineText: line.trim(),
          confidence: "medium",
          severity: "low"
        });
      }
    }
  }

  return matches;
}

function findFallbackMatches(file: string, content: string): MatchInfo[] {
  const lines = content.split(/\r?\n/);
  const matches: MatchInfo[] = [];

  for (const [index, line] of lines.entries()) {
    const lower = line.toLowerCase();
    const hasFallbackSignal = lower.includes("legacy") || lower.includes("fallback") || lower.includes("compat") || lower.includes("oldflow");
    const hasControlFlow = /(if|else|catch|except|return|try)/.test(lower);
    if (hasFallbackSignal && hasControlFlow) {
      const envGuardMatch = line.match(/\b([A-Z][A-Z0-9_]*(?:LEGACY|OLD|FALLBACK|COMPAT|V1)[A-Z0-9_]*)\b/);
      matches.push({
        group: "fallback-branch",
        pattern: lower.includes("legacy") ? "legacy branch" : "fallback branch",
        file,
        line: index + 1,
        lineText: line.trim(),
        confidence: envGuardMatch ? "medium" : "high",
        severity: "medium",
        instruction: envGuardMatch
          ? `Verify whether ${envGuardMatch[1]} is still a supported flag. If not, remove the fallback and update tests.`
          : "Verify the fallback is still required; if not, remove it and update tests."
      });
    }
  }

  return matches;
}

function findFlagMatches(file: string, content: string): MatchInfo[] {
  const lines = content.split(/\r?\n/);
  const matches: MatchInfo[] = [];

  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    const envMatch = trimmed.match(/\b([A-Z][A-Z0-9_]*(?:LEGACY|OLD|FALLBACK|COMPAT|DEPRECATED|PREVIOUS|V1)[A-Z0-9_]*)\b/);
    const featureFlagMatch = trimmed.match(/\b(?:legacy|old|fallback|compat|deprecated|previous)[A-Z][A-Za-z0-9]+\b/);
    const signal = envMatch?.[1] ?? featureFlagMatch?.[0];

    if (!signal) {
      continue;
    }

    matches.push({
      group: "flag-signal",
      pattern: signal,
      file,
      line: index + 1,
      lineText: trimmed,
      confidence: "medium",
      severity: "low",
      instruction: `Confirm whether ${signal} is still an active environment variable or feature flag. Remove dead fallback wiring if not.`
    });
  }

  return matches;
}

export const customLeftoversAdapter: ToolAdapter = {
  id: "custom-leftovers",
  category: "leftovers",
  async detect(_project, config) {
    return config.checks.leftovers.enabled;
  },
  async runStandalone(ctx) {
    const candidates = filterPaths(ctx.project.projectFiles, ctx.config.paths.include, ctx.config.paths.exclude).filter((file) =>
      /\.(ts|tsx|js|jsx|py)$/.test(file)
    );
    const findings: Finding[] = [];

    for (const file of candidates) {
      const content = await readTextIfExists(path.join(ctx.root, file));
      if (!content) {
        continue;
      }

      const matches = [
        ...(ctx.config.checks.leftovers.scanComments ? findCommentMatches(file, content) : []),
        ...findNameMatches(file, content),
        ...findFlagMatches(file, content),
        ...(ctx.config.checks.leftovers.scanLegacyFallbacks ? findFallbackMatches(file, content) : [])
      ];

      for (const match of matches) {
        findings.push({
          id: `leftover:${file}:${match.line}:${match.pattern}`,
          source: "custom-leftovers",
          category: "leftovers",
          severity: match.severity ?? (match.group === "fallback-branch" ? "medium" : "low"),
          confidence: match.confidence ?? (match.group === "commented-code" ? "high" : "medium"),
          title:
            match.group === "commented-code"
              ? "Commented-out code"
              : match.group === "fallback-branch"
                ? "Legacy fallback path appears present"
                : match.group === "flag-signal"
                  ? "Legacy flag or env toggle"
                : "Legacy or temporary marker",
          message: match.lineText,
          file,
          startLine: match.line,
          isNew: true,
          isAutofixable: false,
          safeToAutofix: false,
          agentInstruction: match.instruction ??
            (match.group === "fallback-branch"
              ? "Verify the fallback is still required; if not, remove it and update tests."
              : "Confirm the legacy note is still needed. Delete stale comments or code after verifying behavior."),
          tags: ["leftovers", match.group],
          evidence: {
            snippet: match.lineText,
            matchedPattern: match.pattern
          },
          scoreImpact: 0
        });
      }
    }

    return { findings };
  },
  installHint: "Built-in detector. No external install needed."
};
