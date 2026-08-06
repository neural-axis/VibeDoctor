import { confidenceFromScore, maskPiiValue } from "./privacyDetector";
import type { Finding, Confidence } from "../core/finding";
import { filterPaths } from "../core/paths";
import { runCommand, type ToolResult } from "../core/toolRunner";
import type { ToolAdapter, ToolAdapterContext } from "./shared";

type PresidioJsonFinding = {
  file: string;
  line?: number;
  entityType: string;
  score: number;
  value: string;
};

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 0,
  medium: 1,
  high: 2
};

const PRESIDIO_EXTENSIONS = /\.(ts|tsx|js|jsx|py|json|jsonl|ya?ml|toml|md|txt|log|csv|tsv|sql|graphql|gql)$/i;

const PRESIDIO_SCRIPT = String.raw`
import json
import os
import pathlib
import sys

try:
    from presidio_analyzer import AnalyzerEngine
except Exception as exc:
    sys.stderr.write(f"presidio_analyzer is not installed: {exc}\n")
    sys.exit(2)

root = pathlib.Path(sys.argv[1])
files = json.loads(os.environ.get("VIBEDOCTOR_PRESIDIO_FILES", "[]"))
max_file_bytes = int(os.environ.get("VIBEDOCTOR_PRESIDIO_MAX_FILE_BYTES", "1048576"))
analyzer = AnalyzerEngine()
out = []

for rel in files:
    candidate = root / rel
    try:
        if candidate.stat().st_size > max_file_bytes:
            continue
        text = candidate.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        continue

    for item in analyzer.analyze(text=text, language="en"):
        value = text[item.start:item.end]
        out.append({
            "file": rel,
            "line": text.count("\n", 0, item.start) + 1,
            "entityType": item.entity_type.lower(),
            "score": float(item.score),
            "value": value,
        })

print(json.dumps(out))
`;

function passesConfidenceThreshold(score: number, minimum: Confidence): boolean {
  return CONFIDENCE_RANK[confidenceFromScore(score)] >= CONFIDENCE_RANK[minimum];
}

function normalizeStatus(status: ToolResult): ToolResult {
  if (status.status === "error" && /presidio_analyzer is not installed|No module named ['"]presidio_analyzer/i.test(status.stderr)) {
    return {
      ...status,
      status: "skipped",
      installHint: "Install Presidio in the project environment: python -m pip install presidio-analyzer"
    };
  }
  return status;
}

function sensitivityForPresidio(entityType: string): string {
  if (/credit_card|iban|crypto|passport|aadhaar|pan|bank/.test(entityType)) {
    return "regulated_identifier";
  }
  if (/medical|patient|health|location/.test(entityType)) {
    return "high";
  }
  if (/phone|ip|date_time|id/.test(entityType)) {
    return "moderate";
  }
  return "low";
}

function toFinding(item: PresidioJsonFinding, ctx: ToolAdapterContext): Finding {
  const entityType = item.entityType.toLowerCase();
  const sensitivity = sensitivityForPresidio(entityType);
  const confidence = confidenceFromScore(item.score);
  const maskedValue = maskPiiValue(item.value, entityType, ctx.config.checks.privacy.maskExamples);

  return {
    id: `privacy-presidio:${item.file}:${item.line ?? 0}:${entityType}:${maskedValue}`,
    source: "presidio",
    category: "privacy",
    severity: sensitivity === "low" ? "low" : "medium",
    confidence,
    title: `PII detected: ${entityType}`,
    message: `${entityType} detected by Presidio with ${confidence} confidence.`,
    file: item.file,
    startLine: item.line,
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    agentInstruction: "Review this Presidio privacy finding before treating it as confirmed PII.",
    tags: ["privacy", entityType, sensitivity],
    evidence: {
      detector: "presidio",
      entityType,
      sensitivity,
      maskedValue,
      fieldPath: item.line ? `${item.file}:${item.line}` : item.file,
      matchedPattern: entityType,
      detectionPath: "presidio",
      confidenceScore: Number(item.score.toFixed(2)),
      coverageConfidence: 0.75,
      reviewState: item.score >= 0.85 ? "confirmed" : "needs_human_review",
      reasons: ["Presidio analyzer returned this entity span"]
    },
    scoreImpact: 0
  };
}

export const presidioAdapter: ToolAdapter = {
  id: "presidio",
  category: "privacy",
  async detect(_project, config) {
    // This adapter belongs to the normal privacy scan. DPDP has an independent
    // opt-out switch and invokes/reuses this adapter through its collector.
    return config.checks.privacy.enabled && config.checks.privacy.presidio.enabled;
  },
  async runStandalone(ctx) {
    const files = filterPaths(ctx.project.projectFiles, ctx.config.paths.include, ctx.config.paths.exclude)
      .filter((file) => PRESIDIO_EXTENSIONS.test(file))
      .slice(0, 500);

    const status = normalizeStatus(
      await runCommand(
        {
          cmd: "python",
          args: ["-c", PRESIDIO_SCRIPT, ctx.root],
          cwd: ctx.root,
          timeoutMs: 120_000,
          env: {
            VIBEDOCTOR_PRESIDIO_FILES: JSON.stringify(files),
            VIBEDOCTOR_PRESIDIO_MAX_FILE_BYTES: String(ctx.config.checks.privacy.maxFileBytes)
          }
        },
        "Install Presidio in the project environment: python -m pip install presidio-analyzer"
      )
    );

    if (status.status !== "ok") {
      return { findings: [], status };
    }

    let raw: PresidioJsonFinding[] = [];
    try {
      raw = JSON.parse(status.stdout.trim() || "[]") as PresidioJsonFinding[];
    } catch {
      return {
        findings: [],
        status: {
          ...status,
          status: "error",
          stderr: "Presidio output was not valid JSON."
        }
      };
    }

    return {
      findings: raw
        .filter((item) => passesConfidenceThreshold(item.score, ctx.config.checks.privacy.minConfidenceToReport))
        .map((item) => toFinding(item, ctx)),
      status
    };
  },
  installHint:
    "Optional privacy scanner (on by default). Install: python -m pip install presidio-analyzer. Opt out of normal privacy scans with checks.privacy.presidio.enabled: false."
};
