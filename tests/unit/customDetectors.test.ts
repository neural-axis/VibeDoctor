import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { runScan } from "../../src/core/engine";
import { createTempFixtureCopy } from "../helpers";

async function createTempProject(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), `vibedoctor-${prefix}-`));
}

async function writeProjectFile(root: string, file: string, content: string): Promise<void> {
  const target = path.join(root, ...file.split("/"));
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
}

const focusedDeadCodeConfig = `version: 1
paths:
  include:
    - src/**
  exclude:
    - "**/*.test.*"
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: true
    minConfidenceToReport: low
  leftovers:
    enabled: false
  refactor_readiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: false
`;

const focusedLeftoversConfig = `version: 1
paths:
  include:
    - src/**
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: false
  leftovers:
    enabled: true
    scanComments: true
    scanCommentedCode: true
    scanLegacyFallbacks: true
  refactor_readiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: false
`;

describe("custom detectors (leftovers config gates + min confidence)", () => {
  it("respects scanCommentedCode: false by suppressing 'Commented-out code' while keeping legacy flags", async () => {
    const root = await createTempFixtureCopy("stale-comments");

    // Overwrite with config that disables commented code scanning (but keeps other leftovers)
    const yml = `version: 1
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  leftovers:
    enabled: true
    scan_comments: true
    scan_commented_code: false
    scan_legacy_fallbacks: true
  refactor_readiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: false
`;
    await fs.writeFile(path.join(root, "vibedoctor.yml"), yml, "utf8");

    const scan = await runScan(root, "quick");

    const hasCommented = scan.leftovers.some((f) => f.title === "Commented-out code");
    const hasLegacyFlag = scan.leftovers.some((f) => f.title === "Legacy flag or env toggle");

    expect(hasCommented).toBe(false);
    expect(hasLegacyFlag).toBe(true);
  });

  it("minConfidenceToReport filters low-confidence dead chains when set high", async () => {
    const root = await createTempFixtureCopy("dead-code-chain");

    // Config requesting only high confidence dead code
    const yml = `version: 1
checks:
  security:
    enabled: false
  correctness:
    enabled: false
  deadCode:
    enabled: true
    minConfidenceToReport: high
  leftovers:
    enabled: false
  refactor_readiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: false
`;
    await fs.writeFile(path.join(root, "vibedoctor.yml"), yml, "utf8");

    const scan = await runScan(root, "default");

    // The fixture produces a dead-chain candidate; with high filter it may be dropped or kept depending on computed conf.
    // We assert the mechanism works without crashing and that any returned have >= high.
    const deadOnes = scan.deadCodeCandidates.filter((f) => f.source === "custom-dead-chain");
    for (const d of deadOnes) {
      expect(["high"]).toContain(d.confidence); // if any survive, must be high
    }
    // At minimum, scan succeeds and deadCodeCandidates array is present (may be 0 or 1)
    expect(Array.isArray(scan.deadCodeCandidates)).toBe(true);
  });

  it("treats src/app route files, dynamic imports, aliases, and type-only imports as live edges", async () => {
    const root = await createTempProject("next-live-graph");
    await writeProjectFile(root, "package.json", JSON.stringify({ dependencies: { next: "15.0.0" } }));
    await writeProjectFile(
      root,
      "tsconfig.json",
      JSON.stringify({ compilerOptions: { baseUrl: ".", paths: { "@/*": ["src/*"] } } })
    );
    await writeProjectFile(root, "vibedoctor.yml", focusedDeadCodeConfig);
    await writeProjectFile(
      root,
      "src/app/results/page.tsx",
      `import dynamic from "next/dynamic";

const ChatPanel = dynamic(() => import("@/components/chat/ChatPanel"));

export default function ResultsPage() {
  return <ChatPanel />;
}
`
    );
    await writeProjectFile(
      root,
      "src/components/chat/ChatPanel.tsx",
      `import type { ChatRepository } from "@/domain/repositories";

export default function ChatPanel(_props: { repository?: ChatRepository }) {
  return null;
}
`
    );
    await writeProjectFile(
      root,
      "src/domain/repositories.ts",
      `export interface ChatRepository {
  loadMessages(): Promise<string[]>;
}
`
    );

    const scan = await runScan(root, "quick");
    const deadFiles = scan.deadCodeCandidates.map((finding) => finding.file);

    expect(deadFiles).not.toContain("src/components/chat/ChatPanel.tsx");
    expect(deadFiles).not.toContain("src/domain/repositories.ts");
    expect(scan.deadCodeCandidates.filter((finding) => finding.source === "custom-dead-chain")).toHaveLength(0);
  });

  it("does not treat JSDoc or live fallback identifiers as leftovers", async () => {
    const root = await createTempProject("leftovers-live-fallback");
    await writeProjectFile(root, "vibedoctor.yml", focusedLeftoversConfig);
    await writeProjectFile(
      root,
      "src/llmClient.ts",
      `/**
 * Strips markdown code block wrappers from LLM responses.
 */
const fallbackPool = ["openai"];

export function chooseProvider(provider: string | undefined) {
  // Also check current process env as a fallback.
  if (provider === "fallback") {
    return fallbackPool[0];
  }
  return provider ?? fallbackPool[0];
}
`
    );

    const scan = await runScan(root, "quick");

    expect(scan.leftovers).toHaveLength(0);
  });
});
