import type { TechnicalSignalBag } from "../types";
import { fileHasGlobalAuth, lineHasAuth, PII_KEYWORD, pushSignal, windowAround } from "./shared";

/**
 * Safeguard / gap detectors with multi-line depth for logs, LLM prompts, and route auth.
 */
export function collectSafeguardSignals(
  signals: TechnicalSignalBag[],
  file: string,
  content: string,
  lines: string[]
): void {
  const globalAuth = fileHasGlobalAuth(content);

  if (/\b(localStorage|sessionStorage)\.(setItem|getItem)\b/.test(content) || /document\.cookie\s*=/.test(content)) {
    if (PII_KEYWORD.test(content)) {
      const lineIndex = lines.findIndex((line) => /localStorage|sessionStorage|document\.cookie/.test(line));
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineIndex >= 0 ? lineIndex + 1 : undefined,
        summary: "Browser storage used near personal-data keywords",
        confidence: "medium",
        tags: ["browser-storage"],
        detectionMethod: "browser-storage-pattern",
        relatedControls: ["DPDP-SEC-004"]
      });
    }
  }

  for (const [index, line] of lines.entries()) {
    const lineNumber = index + 1;
    const window = windowAround(lines, index, 3, 4);
    const deepWindow = windowAround(lines, index, 8, 10);

    // Multi-line logger: call opens here, PII args on following lines
    if (/\b(console|logger|log)\.(log|info|warn|error|debug)\s*\(/i.test(line)) {
      const logBlock = windowAround(lines, index, 0, 6);
      if (
        PII_KEYWORD.test(logBlock) &&
        !/\b(redact|mask|safe|anon|hide|hash|encrypt|obfuscate)\b/i.test(logBlock)
      ) {
        pushSignal(signals, {
          kind: "safeguard_gap",
          file,
          line: lineNumber,
          summary: "Potential PII in logger call (multi-line)",
          confidence: "medium",
          tags: ["pii-in-logs"],
          detectionMethod: "logger-multiline-pattern",
          relatedControls: ["DPDP-SEC-001"]
        });
      }
    }

    // Multi-line LLM message construction
    const llmAnchor =
      /\b(chat\.completions|completions\.create|messages\s*:\s*\[|embed(dings)?\(|pinecone|vectorStore|similaritySearch|OpenAI\b|anthropic|messages\.push)\b/i.test(
        line
      ) || /\b(role:\s*['"]user['"]|content:\s*[`'"])/i.test(line);
    if (llmAnchor && PII_KEYWORD.test(deepWindow)) {
      // Avoid pure embeddings of ticket ids without PD keywords already gated by PII_KEYWORD
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        category: "llm_prompt_embedding",
        summary: "Potential personal data in LLM prompt / embedding path",
        confidence: "medium",
        tags: ["pii-in-llm"],
        detectionMethod: "llm-prompt-multiline-pattern",
        relatedControls: ["DPDP-SEC-002"]
      });
    }

    if (/\bhttps?:\/\/[^\s"'`]+/i.test(line) && /\bhttp:\/\//i.test(line) && PII_KEYWORD.test(window)) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Cleartext HTTP URL near personal-data context",
        confidence: "medium",
        tags: ["insecure-http"],
        detectionMethod: "http-url-pattern",
        relatedControls: ["DPDP-SEC-005"]
      });
    }

    if (
      /\b(req\.query|request\.args|searchParams|querystring)\b/i.test(line) &&
      /\b(email|phone|aadhaar|pan|userId|user_id)\b/i.test(window)
    ) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Personal data identifier read from URL/query string",
        confidence: "medium",
        tags: ["pii-in-urls"],
        detectionMethod: "query-pii-pattern",
        relatedControls: ["DPDP-SEC-003"]
      });
    }

    if (
      /\bselect\s+\*|\bfindMany\s*\(\s*\)|\bfind\s*\(\s*\{\s*\}\s*\)|\.all\(\)/i.test(line) &&
      /\b(user|customer|profile|member|patient)\b/i.test(window)
    ) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Broad database selection on personal-data model",
        confidence: "medium",
        tags: ["broad-db-select"],
        detectionMethod: "broad-select-pattern",
        relatedControls: ["DPDP-MIN-002"]
      });
    }

    if (/\b(\/debug|\/dump|debug_endpoint|dumpUsers|dump_users)\b/i.test(line) && PII_KEYWORD.test(window)) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Debug/dump endpoint potentially exposing personal records",
        confidence: "high",
        tags: ["debug-exposure"],
        detectionMethod: "debug-route-pattern",
        relatedControls: ["DPDP-SEC-008"]
      });
    }

    if (
      /\b(mask|redact)\w*\s*\([^)]*\)\s*\{[^}]{0,120}\}/i.test(line) ||
      (/\b(mask|redact)\w*\s*=/.test(line) && /\bslice\s*\(\s*0\s*,\s*[1-3]\s*\)/.test(window))
    ) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Potentially weak masking implementation",
        confidence: "low",
        tags: ["weak-masking"],
        detectionMethod: "weak-mask-pattern",
        relatedControls: ["DPDP-SEC-009"]
      });
    }

    if (
      /\b(export|erase|deleteAccount|admin).*?(user|personal|customer)\b/i.test(line) ||
      /\b(user|personal|customer).*?(export|erase|delete)\b/i.test(line)
    ) {
      if (!/\b(audit|auditLog|activity_log|security_log)\b/i.test(window)) {
        pushSignal(signals, {
          kind: "safeguard_gap",
          file,
          line: lineNumber,
          summary: "Sensitive personal-data operation without nearby audit signal",
          confidence: "low",
          tags: ["missing-audit"],
          detectionMethod: "audit-gap-pattern",
          relatedControls: ["DPDP-SEC-010"]
        });
      }
    }

    if (
      /\b(track|capture|identify|setUser|set_user|people\.set)\s*\(/i.test(line) &&
      /\b(user|profile|customer|email)\b/i.test(window)
    ) {
      pushSignal(signals, {
        kind: "safeguard_gap",
        file,
        line: lineNumber,
        summary: "Possible whole-user object sent to third-party SDK",
        confidence: "medium",
        tags: ["third-party-user-object"],
        detectionMethod: "third-party-user-pattern",
        relatedControls: ["DPDP-THIRD-001"]
      });
    }

    // Express/Fastify-style routes: path may be on the same line or the next few lines
    const sameLineRoute =
      /\b(app|router|route)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(line) ||
      /@(app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i.exec(line);

    let routePath: string | undefined = sameLineRoute?.[3];
    if (
      !routePath &&
      /\b(app|router|route)\.(get|post|put|patch|delete)\s*\(\s*$/i.test(line)
    ) {
      const lookahead = lines.slice(index, Math.min(lines.length, index + 5)).join("\n");
      const multi = lookahead.match(
        /\b(app|router|route)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)['"`]/i
      );
      routePath = multi?.[3];
    }
    if (!routePath) {
      routePath = routeMatchFallback(line);
    }

    if (routePath && /user|profile|customer|account|personal|export/i.test(routePath)) {
      const routeWindow = windowAround(lines, index, 6, 6);
      if (!lineHasAuth(line, routeWindow) && !globalAuth) {
        pushSignal(signals, {
          kind: "safeguard_gap",
          file,
          line: lineNumber,
          summary: `Personal-data route without nearby auth signal: ${routePath}`,
          confidence: "low",
          tags: ["missing-route-auth"],
          detectionMethod: "route-auth-multiline-heuristic",
          relatedControls: ["DPDP-SEC-006"]
        });
      }
    }
  }
}

function routeMatchFallback(line: string): string | undefined {
  const match = line.match(/['"`]([^'"`]*(?:user|profile|customer|account|personal|export)[^'"`]*)['"`]/i);
  return match?.[1];
}
