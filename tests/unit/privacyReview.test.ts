import { promises as fs } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runPrivacyReviewCommand } from "../../src/cli/commands/privacyReview";
import { runScan } from "../../src/core/engine";
import type { PrivacyReviewArtifact } from "../../src/core/privacyReview";
import { createTempFixtureCopy } from "../helpers";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
  delete process.env.VIBEDOCTOR_AI_API_KEY;
  delete process.env.VIBEDOCTOR_AI_MODEL;
});

async function enableAi(root: string): Promise<void> {
  const configPath = path.join(root, "vibedoctor.yml");
  const config = await fs.readFile(configPath, "utf8");
  await fs.writeFile(configPath, config.replace("enabled: false\n      apiKeyEnv", "enabled: true\n      apiKeyEnv"), "utf8");
}

async function readReview(root: string): Promise<PrivacyReviewArtifact> {
  return JSON.parse(await fs.readFile(path.join(root, ".vibedoctor", "privacy-review.json"), "utf8")) as PrivacyReviewArtifact;
}

describe("privacy review command", () => {
  it("writes a deterministic Privacy Review artifact when AI is disabled", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const result = await runPrivacyReviewCommand(root, { refresh: true, format: "markdown" });
    const review = await readReview(root);

    expect(result.exitCode).toBe(0);
    expect(result.output).toContain("Confirmed Regulated Identifiers");
    expect(result.output).toContain("Unresolved Review Items");
    expect(review.status).toBe("needs_human_review");
    expect(review.findings.length).toBeGreaterThan(0);
    expect(review.findings.some((finding) => finding.reviewState === "confirmed")).toBe(true);
    expect(review.findings.some((finding) => finding.reviewState === "needs_human_review")).toBe(true);
  });

  it("sends masked findings to AI, stores structured decisions, and merges them back into scans", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    const scan = await runScan(root, "full");
    const candidate = scan.privacyFindings.find((finding) => finding.confidence !== "high");
    expect(candidate).toBeDefined();

    await enableAi(root);
    process.env.VIBEDOCTOR_AI_API_KEY = "test-key";
    process.env.VIBEDOCTOR_AI_MODEL = "test-model";

    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    findings: [
                      {
                        id: candidate!.id,
                        classification: "false_positive",
                        rationale: "Schema-only field name without a real value.",
                        recommended_action: "Keep reviewed unless sample data is added."
                      }
                    ]
                  })
                }
              }
            ]
          }),
          { status: 200 }
        )
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const result = await runPrivacyReviewCommand(root, { refresh: true, format: "json" });
    const body = String((fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined])[1]?.body);
    const review = await readReview(root);
    const after = await runScan(root, "full");
    const merged = after.privacyFindings.find((finding) => finding.id === candidate!.id);

    expect(result.exitCode).toBe(0);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(body).toContain("test-model");
    expect(body).not.toContain("ABCDE1234F");
    expect(body).not.toContain("rohit.sharma@example.com");
    expect(body).toContain("A****1234*");
    expect(review.findings.find((finding) => finding.id === candidate!.id)?.reviewState).toBe("false_positive");
    expect(merged?.evidence?.reviewState).toBe("false_positive");
    expect(merged?.evidence?.rationale).toBe("Schema-only field name without a real value.");
  }, 30_000);

  it("falls back to needs_human_review when AI output is malformed", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    await enableAi(root);
    process.env.VIBEDOCTOR_AI_API_KEY = "test-key";
    process.env.VIBEDOCTOR_AI_MODEL = "test-model";
    globalThis.fetch = vi.fn(
      async () => new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), { status: 200 })
    ) as typeof fetch;

    const result = await runPrivacyReviewCommand(root, { refresh: true, format: "json" });
    const review = await readReview(root);

    expect(result.exitCode).toBe(1);
    expect(review.status).toBe("ai_error");
    expect(review.summary.needsHumanReview).toBeGreaterThan(0);
  });

  it("persists an ai_error artifact when the API request fails", async () => {
    const root = await createTempFixtureCopy("pii-basic");
    await enableAi(root);
    process.env.VIBEDOCTOR_AI_API_KEY = "test-key";
    process.env.VIBEDOCTOR_AI_MODEL = "test-model";
    globalThis.fetch = vi.fn(async () => new Response("nope", { status: 500, statusText: "Server Error" })) as typeof fetch;

    const result = await runPrivacyReviewCommand(root, { refresh: true, format: "json" });
    const review = await readReview(root);

    expect(result.exitCode).toBe(1);
    expect(review.status).toBe("ai_error");
    expect(result.output).toContain("AI review request failed");
  });
});
