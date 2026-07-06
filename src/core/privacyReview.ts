import { promises as fs } from "node:fs";
import path from "node:path";
import type { Finding } from "./finding";
import { ensureDir, pathExists } from "./paths";

export type PrivacyReviewState = "confirmed" | "likely" | "false_positive" | "needs_human_review";
export type PrivacyReviewStatus = "ok" | "needs_human_review" | "ai_error";

export type PrivacyReviewFinding = {
  id: string;
  title: string;
  file?: string;
  startLine?: number;
  entityType?: string;
  sensitivity?: string;
  reviewState: PrivacyReviewState;
  reviewedAt: string;
  reviewedBy: string;
  rationale: string;
  recommendedAction: string;
};

export type PrivacyReviewSummary = {
  total: number;
  confirmed: number;
  likely: number;
  falsePositive: number;
  needsHumanReview: number;
  regulatedIdentifiers: number;
  sensitiveAttributes: number;
  combinationRisk: number;
  generatedAt?: string;
  reviewedBy?: string;
  model?: string;
  status?: PrivacyReviewStatus;
};

export type PrivacyReviewArtifact = {
  version: 1;
  generatedAt: string;
  reviewedBy: string;
  model?: string;
  status: PrivacyReviewStatus;
  summary: PrivacyReviewSummary;
  findings: PrivacyReviewFinding[];
};

export const DEFAULT_PRIVACY_REVIEW_FILE = ".vibedoctor/privacy-review.json";

function toAbsolutePath(root: string, reviewFile: string): string {
  return path.isAbsolute(reviewFile) ? reviewFile : path.join(root, reviewFile);
}

export function summarizePrivacyReview(
  findings: PrivacyReviewFinding[],
  metadata: Pick<PrivacyReviewArtifact, "generatedAt" | "reviewedBy" | "model" | "status">
): PrivacyReviewSummary {
  return {
    total: findings.length,
    confirmed: findings.filter((finding) => finding.reviewState === "confirmed").length,
    likely: findings.filter((finding) => finding.reviewState === "likely").length,
    falsePositive: findings.filter((finding) => finding.reviewState === "false_positive").length,
    needsHumanReview: findings.filter((finding) => finding.reviewState === "needs_human_review").length,
    regulatedIdentifiers: findings.filter((finding) => finding.sensitivity === "regulated_identifier").length,
    sensitiveAttributes: findings.filter((finding) => finding.sensitivity === "high").length,
    combinationRisk: findings.filter((finding) => finding.sensitivity === "combination_risk").length,
    generatedAt: metadata.generatedAt,
    reviewedBy: metadata.reviewedBy,
    model: metadata.model,
    status: metadata.status
  };
}

export function buildPrivacyReviewArtifact(options: {
  generatedAt: string;
  reviewedBy: string;
  model?: string;
  status: PrivacyReviewStatus;
  findings: PrivacyReviewFinding[];
}): PrivacyReviewArtifact {
  return {
    version: 1,
    generatedAt: options.generatedAt,
    reviewedBy: options.reviewedBy,
    model: options.model,
    status: options.status,
    findings: options.findings,
    summary: summarizePrivacyReview(options.findings, options)
  };
}

export async function loadPrivacyReview(root: string, reviewFile: string = DEFAULT_PRIVACY_REVIEW_FILE): Promise<PrivacyReviewArtifact | undefined> {
  const reviewPath = toAbsolutePath(root, reviewFile);
  if (!(await pathExists(reviewPath))) {
    return undefined;
  }

  const parsed = JSON.parse(await fs.readFile(reviewPath, "utf8")) as Partial<PrivacyReviewArtifact>;
  if (parsed.version !== 1 || !Array.isArray(parsed.findings)) {
    return undefined;
  }

  const generatedAt = parsed.generatedAt ?? "";
  const reviewedBy = parsed.reviewedBy ?? "unknown";
  const status = parsed.status ?? "needs_human_review";
  return buildPrivacyReviewArtifact({
    generatedAt,
    reviewedBy,
    model: parsed.model,
    status,
    findings: parsed.findings.filter((finding): finding is PrivacyReviewFinding => typeof finding.id === "string")
  });
}

export async function writePrivacyReview(
  root: string,
  artifact: PrivacyReviewArtifact,
  reviewFile: string = DEFAULT_PRIVACY_REVIEW_FILE
): Promise<string> {
  const reviewPath = toAbsolutePath(root, reviewFile);
  await ensureDir(path.dirname(reviewPath));
  await fs.writeFile(reviewPath, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  return reviewPath;
}

export function mergePrivacyReviewIntoFindings(findings: Finding[], artifact: PrivacyReviewArtifact | undefined): Finding[] {
  if (!artifact) {
    return findings;
  }

  const byId = new Map(artifact.findings.map((finding) => [finding.id, finding]));
  return findings.map((finding) => {
    const review = byId.get(finding.id);
    if (!review) {
      return finding;
    }

    return {
      ...finding,
      evidence: {
        ...finding.evidence,
        reviewState: review.reviewState,
        reviewedAt: review.reviewedAt,
        reviewedBy: review.reviewedBy,
        rationale: review.rationale,
        recommendedAction: review.recommendedAction
      }
    };
  });
}
