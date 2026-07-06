import { promises as fs } from "node:fs";
import path from "node:path";
import { ensureOutputArtifacts, getConfig } from "./shared";
import { runScan, type ScanOutput } from "../../core/engine";
import type { Finding } from "../../core/finding";
import { pathExists } from "../../core/paths";
import {
  buildPrivacyReviewArtifact,
  type PrivacyReviewArtifact,
  type PrivacyReviewFinding,
  type PrivacyReviewState,
  writePrivacyReview
} from "../../core/privacyReview";

type PrivacyReviewOptions = {
  refresh?: boolean;
  format?: "json" | "markdown";
};

type ReviewFindingPayload = {
  id: string;
  title: string;
  file?: string;
  startLine?: number;
  confidence: Finding["confidence"];
  entityType?: string;
  sensitivity?: string;
  maskedValue?: string;
  snippet?: string;
  rawSnippet?: string;
  reasons?: string[];
};

type CommandPayload = PrivacyReviewArtifact & {
  reviewPath: string;
  message?: string;
};

type AiFindingDecision = {
  id?: unknown;
  classification?: unknown;
  reviewState?: unknown;
  rationale?: unknown;
  recommended_action?: unknown;
  recommendedAction?: unknown;
};

type AiReviewResponse = {
  findings?: unknown;
};

type ChatCompletionResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

const VALID_REVIEW_STATES = new Set<PrivacyReviewState>(["confirmed", "likely", "false_positive", "needs_human_review"]);

async function loadOrRefreshScan(root: string, refresh: boolean): Promise<ScanOutput> {
  const { config } = await getConfig(root);
  const reportPath = path.join(root, config.output.json);

  if (!refresh && (await pathExists(reportPath))) {
    const parsed = JSON.parse(await fs.readFile(reportPath, "utf8")) as Partial<ScanOutput>;
    if (Array.isArray(parsed.findings)) {
      const privacyFindings = parsed.privacyFindings ?? parsed.findings.filter((finding) => finding.category === "privacy");
      return {
        ...(parsed as ScanOutput),
        privacyFindings
      };
    }
  }

  const scan = await runScan(root, "full");
  await ensureOutputArtifacts(root, config, scan);
  return scan;
}

function needsAiReview(finding: Finding): boolean {
  if (finding.category !== "privacy") {
    return false;
  }
  if (["confirmed", "likely", "false_positive"].includes(finding.evidence?.reviewState ?? "")) {
    return false;
  }
  return finding.evidence?.reviewState === "needs_human_review" || finding.confidence !== "high";
}

async function readRawSnippet(root: string, finding: Finding): Promise<string | undefined> {
  if (!finding.file || !finding.startLine) {
    return undefined;
  }

  const absolutePath = path.join(root, finding.file);
  const content = await fs.readFile(absolutePath, "utf8").catch(() => undefined);
  if (!content) {
    return undefined;
  }

  return content.split(/\r?\n/)[finding.startLine - 1]?.trim();
}

async function buildReviewFindings(root: string, findings: Finding[], includeRawValues: boolean): Promise<ReviewFindingPayload[]> {
  const payload: ReviewFindingPayload[] = [];
  for (const finding of findings.filter(needsAiReview).slice(0, 50)) {
    payload.push({
      id: finding.id,
      title: finding.title,
      file: finding.file,
      startLine: finding.startLine,
      confidence: finding.confidence,
      entityType: finding.evidence?.entityType,
      sensitivity: finding.evidence?.sensitivity,
      maskedValue: finding.evidence?.maskedValue,
      snippet: finding.evidence?.snippet,
      rawSnippet: includeRawValues ? await readRawSnippet(root, finding) : undefined,
      reasons: finding.evidence?.reasons
    });
  }
  return payload;
}

function buildPrompt(findings: ReviewFindingPayload[], includeRawValues: boolean): string {
  return [
    "Review these VibeDoctor Privacy Review findings.",
    "Classify each finding as one of: confirmed, likely, false_positive, needs_human_review.",
    "Return strict JSON with this shape: {\"findings\":[{\"id\":\"...\",\"classification\":\"...\",\"rationale\":\"...\",\"recommended_action\":\"...\"}]}",
    includeRawValues
      ? "Raw source snippets may be included because repository config explicitly allowed raw value review."
      : "Only masked snippets are included. Do not ask for raw values unless needed for human review.",
    JSON.stringify({ findings }, null, 2)
  ].join("\n\n");
}

async function callAiReview(baseUrl: string, apiKey: string, model: string, findings: ReviewFindingPayload[], includeRawValues: boolean): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model,
      temperature: 0,
      messages: [
        {
          role: "system",
          content: "You review privacy scanner findings. Be conservative, concise, and return only valid JSON."
        },
        {
          role: "user",
          content: buildPrompt(findings, includeRawValues)
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(`AI review request failed: ${response.status} ${response.statusText}`);
  }

  const json = (await response.json()) as ChatCompletionResponse;
  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("AI review response did not include message content.");
  }
  return content;
}

function parseAiJson(content: string): AiReviewResponse {
  const trimmed = content.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)?.[1];
  return JSON.parse(fenced ?? trimmed) as AiReviewResponse;
}

function normalizeAiState(value: unknown): PrivacyReviewState | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase().replaceAll("-", "_") as PrivacyReviewState;
  return VALID_REVIEW_STATES.has(normalized) ? normalized : undefined;
}

function findingFallbackState(finding: Finding): PrivacyReviewState {
  if (finding.confidence === "high") {
    return "confirmed";
  }
  return "needs_human_review";
}

function defaultRecommendedAction(state: PrivacyReviewState, finding: Finding): string {
  if (state === "false_positive") {
    return "Keep as reviewed false positive unless the source data changes.";
  }
  if (state === "needs_human_review") {
    return "Review with a human before treating this as confirmed personal data.";
  }
  if (finding.evidence?.sensitivity === "regulated_identifier" || finding.evidence?.sensitivity === "high") {
    return "Remove, anonymize, or move this data into a controlled fixture or secret store.";
  }
  return "Verify whether this personal data belongs in the repository and mask it where possible.";
}

function buildFallbackDecision(finding: Finding, reviewedAt: string, reviewedBy: string, rationale?: string): PrivacyReviewFinding {
  const reviewState = findingFallbackState(finding);
  return {
    id: finding.id,
    title: finding.title,
    file: finding.file,
    startLine: finding.startLine,
    entityType: finding.evidence?.entityType,
    sensitivity: finding.evidence?.sensitivity,
    reviewState,
    reviewedAt,
    reviewedBy,
    rationale:
      rationale ??
      (reviewState === "confirmed"
        ? "High-confidence deterministic Privacy Review finding."
        : "Finding needs human review because deterministic evidence was not high-confidence."),
    recommendedAction: defaultRecommendedAction(reviewState, finding)
  };
}

function buildAiDecisions(
  findings: Finding[],
  reviewCandidates: ReviewFindingPayload[],
  content: string,
  reviewedAt: string,
  reviewedBy: string
): PrivacyReviewFinding[] {
  const parsed = parseAiJson(content);
  if (!Array.isArray(parsed.findings)) {
    throw new Error("AI review JSON did not contain a findings array.");
  }

  const candidateIds = new Set(reviewCandidates.map((finding) => finding.id));
  const byId = new Map<string, AiFindingDecision>();
  for (const item of parsed.findings as AiFindingDecision[]) {
    if (typeof item.id === "string" && candidateIds.has(item.id)) {
      byId.set(item.id, item);
    }
  }

  return findings.map((finding) => {
    const ai = byId.get(finding.id);
    if (!ai) {
      return buildFallbackDecision(finding, reviewedAt, reviewedBy);
    }

    const reviewState = normalizeAiState(ai.classification ?? ai.reviewState);
    if (!reviewState) {
      return buildFallbackDecision(finding, reviewedAt, reviewedBy, "AI review returned an unsupported classification.");
    }

    return {
      id: finding.id,
      title: finding.title,
      file: finding.file,
      startLine: finding.startLine,
      entityType: finding.evidence?.entityType,
      sensitivity: finding.evidence?.sensitivity,
      reviewState,
      reviewedAt,
      reviewedBy,
      rationale: typeof ai.rationale === "string" && ai.rationale.trim() ? ai.rationale.trim() : "AI review did not provide a rationale.",
      recommendedAction:
        typeof (ai.recommendedAction ?? ai.recommended_action) === "string" && String(ai.recommendedAction ?? ai.recommended_action).trim()
          ? String(ai.recommendedAction ?? ai.recommended_action).trim()
          : defaultRecommendedAction(reviewState, finding)
    };
  });
}

function buildErroredDecisions(findings: Finding[], reviewedAt: string, reviewedBy: string, message: string): PrivacyReviewFinding[] {
  return findings.map((finding) =>
    finding.confidence === "high"
      ? buildFallbackDecision(finding, reviewedAt, reviewedBy)
      : buildFallbackDecision(finding, reviewedAt, reviewedBy, message)
  );
}

function renderFindingLine(finding: PrivacyReviewFinding): string {
  const location = finding.file ? ` (${finding.file}${finding.startLine ? `:${finding.startLine}` : ""})` : "";
  return `- ${finding.title}${location}: ${finding.rationale} Action: ${finding.recommendedAction}`;
}

function renderGroup(title: string, findings: PrivacyReviewFinding[]): string[] {
  if (findings.length === 0) {
    return [`## ${title}`, "", "- None", ""];
  }
  return [`## ${title}`, "", ...findings.map(renderFindingLine), ""];
}

function renderMarkdown(payload: CommandPayload): string {
  const findings = payload.findings;
  const falsePositives = findings.filter((finding) => finding.reviewState === "false_positive");
  const unresolved = findings.filter((finding) => finding.reviewState === "needs_human_review");
  const confirmedRegulated = findings.filter(
    (finding) => finding.reviewState === "confirmed" && finding.sensitivity === "regulated_identifier"
  );
  const sensitiveAttributes = findings.filter(
    (finding) => finding.sensitivity === "high" && finding.reviewState !== "false_positive"
  );
  const combinationRisk = findings.filter(
    (finding) => finding.sensitivity === "combination_risk" && finding.reviewState !== "false_positive"
  );

  const lines = [
    "# VibeDoctor Privacy Review",
    "",
    `Status: ${payload.status}`,
    `Review file: ${payload.reviewPath}`,
    `Reviewed findings: ${payload.summary.total}`,
    `Needs human review: ${payload.summary.needsHumanReview}`,
    `False positives: ${payload.summary.falsePositive}`,
    ""
  ];
  if (payload.model) {
    lines.push(`Model: ${payload.model}`, "");
  }
  if (payload.message) {
    lines.push(payload.message, "");
  }

  lines.push(
    ...renderGroup("Confirmed Regulated Identifiers", confirmedRegulated),
    ...renderGroup("Sensitive Attributes", sensitiveAttributes),
    ...renderGroup("Combination-Risk Fields", combinationRisk),
    ...renderGroup("Likely False Positives", falsePositives),
    ...renderGroup("Unresolved Review Items", unresolved)
  );

  return `${lines.join("\n").trimEnd()}\n`;
}

export async function runPrivacyReviewCommand(root: string, options: PrivacyReviewOptions = {}): Promise<{ output: string; exitCode: number }> {
  const { config } = await getConfig(root);
  const scan = await loadOrRefreshScan(root, options.refresh === true);
  const aiConfig = config.checks.privacy.ai;
  const reviewedAt = new Date().toISOString();
  const reviewCandidates = await buildReviewFindings(root, scan.privacyFindings ?? [], aiConfig.includeRawValues);
  const allPrivacyFindings = scan.privacyFindings ?? [];

  let status: PrivacyReviewArtifact["status"] = reviewCandidates.length > 0 ? "needs_human_review" : "ok";
  let reviewedBy = "privacy-detector";
  let model: string | undefined;
  let message: string | undefined;
  let decisions: PrivacyReviewFinding[] = allPrivacyFindings.map((finding) => buildFallbackDecision(finding, reviewedAt, reviewedBy));
  let exitCode = 0;

  if (reviewCandidates.length > 0 && aiConfig.enabled) {
    const apiKey = process.env[aiConfig.apiKeyEnv];
    model = process.env[aiConfig.modelEnv];
    const baseUrl = process.env[aiConfig.baseUrlEnv] ?? "https://api.openai.com/v1";

    if (!apiKey || !model) {
      status = "ai_error";
      exitCode = 1;
      message = `Missing AI review configuration. Set ${aiConfig.apiKeyEnv} and ${aiConfig.modelEnv}.`;
      decisions = buildErroredDecisions(allPrivacyFindings, reviewedAt, reviewedBy, message);
    } else {
      reviewedBy = `privacy-ai-review:${model}`;
      try {
        const content = await callAiReview(baseUrl, apiKey, model, reviewCandidates, aiConfig.includeRawValues);
        decisions = buildAiDecisions(allPrivacyFindings, reviewCandidates, content, reviewedAt, reviewedBy);
        status = decisions.some((finding) => finding.reviewState === "needs_human_review") ? "needs_human_review" : "ok";
      } catch (error) {
        status = "ai_error";
        exitCode = 1;
        message = error instanceof Error ? error.message : String(error);
        decisions = buildErroredDecisions(allPrivacyFindings, reviewedAt, reviewedBy, message);
      }
    }
  } else if (reviewCandidates.length > 0) {
    message = "AI review is disabled. Medium- and low-confidence findings were left as needs_human_review.";
  } else {
    message = "No medium- or low-confidence Privacy Review findings need AI review.";
  }

  const artifact = buildPrivacyReviewArtifact({
    generatedAt: reviewedAt,
    reviewedBy,
    model,
    status,
    findings: decisions
  });
  const reviewPath = await writePrivacyReview(root, artifact, config.output.privacyReview);
  const mergedScan = await runScan(root, "full");
  await ensureOutputArtifacts(root, config, mergedScan);
  const payload: CommandPayload = {
    ...artifact,
    reviewPath,
    message
  };

  return {
    output: options.format === "markdown" ? renderMarkdown(payload) : `${JSON.stringify(payload, null, 2)}\n`,
    exitCode
  };
}
