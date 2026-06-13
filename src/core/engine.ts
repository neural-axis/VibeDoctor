import {
  biomeAdapter,
  coveragePyAdapter,
  deptryAdapter,
  gitleaksAdapter,
  jestAdapter,
  jscpdAdapter,
  knipAdapter,
  lizardAdapter,
  osvScannerAdapter,
  pyrightAdapter,
  radonAdapter,
  ruffAdapter,
  semgrepAdapter,
  tscAdapter,
  vitestAdapter,
  vultureAdapter
} from "../adapters";
import { customLeftoversAdapter } from "../adapters/customLeftovers";
import { customRefactorAdapter } from "../adapters/customRefactor";
import { detectDeadChains } from "../adapters/customDeadChain";
import {
  defaultAgentPolicy,
  getAllowedActions,
  getForbiddenActions,
  loadAgentPolicy,
  type AgentPolicy
} from "../agentPack/policy";
import type { ToolAdapterContext } from "../adapters/shared";
import { loadBaseline, writeBaseline } from "./baseline";
import { loadConfig } from "./config";
import { applyBaseline, dedupeFindings, type Finding, type FindingCategory } from "./finding";
import { detectProject } from "./projectDetector";
import { createScanPlan, type ScanMode } from "./scanPlanner";
import { buildScore, type ScoreBreakdown } from "./scoring";
import { runCommand, type ToolResult } from "./toolRunner";
import { severityRank } from "../rules/severityMap";

const ALL_ADAPTERS = [
  gitleaksAdapter,
  osvScannerAdapter,
  semgrepAdapter,
  tscAdapter,
  pyrightAdapter,
  biomeAdapter,
  ruffAdapter,
  deptryAdapter,
  knipAdapter,
  vultureAdapter,
  jscpdAdapter,
  lizardAdapter,
  radonAdapter,
  coveragePyAdapter,
  vitestAdapter,
  jestAdapter,
  customLeftoversAdapter,
  customRefactorAdapter
] as const;

const categoryPriority: Record<FindingCategory, number> = {
  security: 0,
  tests: 1,
  correctness: 2,
  dependencies: 3,
  dead_code: 4,
  leftovers: 5,
  refactor_readiness: 6,
  maintainability: 7,
  efficiency: 8
};

export type AgentPlanTarget = "generic" | "codex" | "copilot" | "claude" | "cursor";

export type AgentPlanTask = {
  id: string;
  title: string;
  priority: number;
  files: string[];
  instructions: string[];
  verify: string[];
  doNotTouch: string[];
  commands: string[];
};

export type AgentPlan = {
  goal: string;
  target: AgentPlanTarget;
  workflow: string[];
  rules: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  doNotTouch: string[];
  tasks: AgentPlanTask[];
};

export type ToolStatusSummary = {
  id: string;
  status: ToolResult["status"];
  message?: string;
  command?: string;
};

export type SkippedToolSummary = {
  id: string;
  status: "skipped";
  installHint?: string;
};

export type ScanOutput = {
  root: string;
  mode: ScanMode;
  score: ScoreBreakdown;
  findings: Finding[];
  topFindings: Finding[];
  blockers: Finding[];
  fixNext: Finding[];
  leftovers: Finding[];
  deadCodeCandidates: Finding[];
  refactorCandidates: Finding[];
  toolStatuses: ToolStatusSummary[];
  skippedTools: SkippedToolSummary[];
  testCommands: string[];
  agentPlan: AgentPlan;
  configPath?: string;
};

export type SafeFixResult = {
  before: ScanOutput;
  after: ScanOutput;
  results: Array<ToolResult & { id: string }>;
};

export type ExplainPayload = {
  finding?: Finding;
  suggestions: string[];
  relatedFindings: Finding[];
  skippedTools: SkippedToolSummary[];
};

type BuildScanOutputOptions = {
  root: string;
  mode: ScanMode;
  findings: Finding[];
  score: ScoreBreakdown;
  toolStatuses: ToolStatusSummary[];
  skippedTools: SkippedToolSummary[];
  testCommands: string[];
  policy?: AgentPolicy;
  target?: AgentPlanTarget;
  configPath?: string;
};

type FilterScanOptions = {
  policy?: AgentPolicy;
  target?: AgentPlanTarget;
};

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((left, right) => {
    const categoryDelta = categoryPriority[left.category] - categoryPriority[right.category];
    if (categoryDelta !== 0) {
      return categoryDelta;
    }

    const severityDelta = severityRank[right.severity] - severityRank[left.severity];
    if (severityDelta !== 0) {
      return severityDelta;
    }

    if (left.isNew !== right.isNew) {
      return left.isNew ? -1 : 1;
    }

    const fileDelta = (left.file ?? "").localeCompare(right.file ?? "");
    if (fileDelta !== 0) {
      return fileDelta;
    }

    const lineDelta = (left.startLine ?? 0) - (right.startLine ?? 0);
    if (lineDelta !== 0) {
      return lineDelta;
    }

    const titleDelta = left.title.localeCompare(right.title);
    if (titleDelta !== 0) {
      return titleDelta;
    }

    return left.id.localeCompare(right.id);
  });
}

function summarizeFindings(findings: Finding[]) {
  const ordered = sortFindings(findings);
  const blockers = ordered.filter((finding) => severityRank[finding.severity] >= severityRank.high);
  const fixNext = ordered.filter((finding) => finding.category !== "leftovers").slice(0, 3);
  const leftovers = ordered.filter((finding) => finding.category === "leftovers");
  const deadCodeCandidates = ordered.filter((finding) => finding.category === "dead_code");
  const refactorCandidates = ordered.filter((finding) => finding.category === "refactor_readiness");
  const topFindings = blockers.length > 0 ? blockers.slice(0, 5) : ordered.slice(0, 5);

  return {
    ordered,
    blockers,
    fixNext,
    leftovers,
    deadCodeCandidates,
    refactorCandidates,
    topFindings
  };
}

function dedupeStrings(items: Array<string | undefined>): string[] {
  return Array.from(
    new Set(
      items
        .map((item) => item?.trim())
        .filter((item): item is string => Boolean(item))
    )
  );
}

function buildTaskInstructions(finding: Finding): string[] {
  const categoryInstruction =
    finding.source === "gitleaks"
      ? "Move the secret to an environment variable."
      : finding.agentInstruction ??
        (finding.category === "dead_code"
          ? "Delete the code only after verifying there are no active runtime references."
          : finding.category === "leftovers"
            ? "Remove the stale path or marker after confirming it is no longer needed."
            : finding.category === "refactor_readiness"
              ? "Keep behavior stable and split the work into small, test-backed edits."
              : "Fix the issue without changing public behavior unless required.");

  return dedupeStrings([finding.message, categoryInstruction, "Do not change public behavior unless required."]);
}

function buildTaskCommands(finding: Finding, policy: AgentPolicy): string[] {
  if (!policy.agentPolicy.allowSafeFix || !finding.safeToAutofix || !finding.fixCommand) {
    return [];
  }

  return [finding.fixCommand];
}

function buildTaskDoNotTouch(policy: AgentPolicy): string[] {
  return policy.agentPolicy.allowPublicApiChange ? [] : ["Do not change public APIs without approval."];
}

function inferFindingLanguage(finding: Finding): "python" | "javascript" | "typescript" | undefined {
  if (finding.file?.endsWith(".py") || finding.tags.includes("python")) {
    return "python";
  }
  if (finding.file?.match(/\.(ts|tsx)$/) || finding.tags.includes("typescript")) {
    return "typescript";
  }
  if (finding.file?.match(/\.(js|jsx)$/) || finding.tags.includes("javascript")) {
    return "javascript";
  }
  return undefined;
}

function isPythonTestCommand(command: string): boolean {
  return /(^|\s)(uv run |poetry run |pdm run |python -m )?pytest\b|\btox\b|\bnox\b/i.test(command);
}

function isJsTestCommand(command: string): boolean {
  return /\b(npm|pnpm|yarn|bun)\b|\b(vitest|jest)\b/i.test(command);
}

function chooseTestCommand(testCommands: string[], finding: Finding): string {
  const language = inferFindingLanguage(finding);
  const commands = dedupeStrings(testCommands);

  if (language === "python") {
    return commands.find(isPythonTestCommand) ?? "pytest";
  }

  if (language === "javascript" || language === "typescript") {
    return commands.find(isJsTestCommand) ?? commands[0] ?? "npm test";
  }

  return commands[0] ?? "npm test";
}

function buildTaskVerify(policy: AgentPolicy, finding: Finding, testCommands: string[]): string[] {
  return dedupeStrings([
    policy.agentPolicy.requireTestsAfterEdit ? chooseTestCommand(testCommands, finding) : undefined,
    policy.agentPolicy.requireScanAfterEdit ? "vibedoctor scan --changed --report json" : undefined
  ]);
}

function targetScore(overall: number): number {
  return overall < 85 ? 85 : Math.min(100, overall + 5);
}

export function createAgentPlan(
  scan: Pick<ScanOutput, "findings" | "score" | "skippedTools"> & { testCommands?: string[] },
  options: { policy?: AgentPolicy; target?: AgentPlanTarget } = {}
): AgentPlan {
  const policy = options.policy ?? defaultAgentPolicy;
  const target = options.target ?? "generic";
  const ordered = sortFindings(scan.findings);
  const tasks = ordered.slice(0, 5).map<AgentPlanTask>((finding, index) => ({
    id: `task-${index + 1}`,
    title: finding.title,
    priority: index + 1,
    files: finding.file ? [finding.file] : [],
    instructions: buildTaskInstructions(finding),
    verify: buildTaskVerify(policy, finding, scan.testCommands ?? []),
    doNotTouch: buildTaskDoNotTouch(policy),
    commands: buildTaskCommands(finding, policy)
  }));

  return {
    goal: `Raise health score from ${scan.score.overall} to ${targetScore(scan.score.overall)}`,
    target,
    workflow: ["scan", "plan", "safe fix", "edit carefully", "verify", "scan again", "summarize"],
    rules: [
      "Fix blockers before cleanup work.",
      "Do not delete low-confidence dead code.",
      "Do not refactor large files without tests.",
      "Do not lower test, lint, security, or coverage thresholds."
    ],
    allowedActions: getAllowedActions(policy),
    forbiddenActions: getForbiddenActions(policy),
    doNotTouch: scan.skippedTools.map((tool) => `Do not assume ${tool.id} was fully checked because the tool was skipped.`),
    tasks
  };
}

function buildScanOutput(options: BuildScanOutputOptions): ScanOutput {
  const summary = summarizeFindings(options.findings);
  const policy = options.policy ?? defaultAgentPolicy;

  return {
    root: options.root,
    mode: options.mode,
    score: options.score,
    findings: summary.ordered,
    topFindings: summary.topFindings,
    blockers: summary.blockers,
    fixNext: summary.fixNext,
    leftovers: summary.leftovers,
    deadCodeCandidates: summary.deadCodeCandidates,
    refactorCandidates: summary.refactorCandidates,
    toolStatuses: [...options.toolStatuses].sort((left, right) => left.id.localeCompare(right.id)),
    skippedTools: [...options.skippedTools].sort((left, right) => left.id.localeCompare(right.id)),
    testCommands: options.testCommands,
    agentPlan: createAgentPlan(
      {
        findings: summary.ordered,
        score: options.score,
        skippedTools: options.skippedTools,
        testCommands: options.testCommands
      },
      { policy, target: options.target }
    ),
    configPath: options.configPath
  };
}

function firstUsefulLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function summarizeToolStatus(status: ToolResult): Pick<ToolStatusSummary, "message" | "command"> {
  if (status.status === "ok" || status.status === "skipped") {
    return {};
  }

  const rawMessage =
    status.status === "timeout"
      ? `Timed out after ${Math.round(status.durationMs / 1000)}s.`
      : firstUsefulLine(status.stderr) ?? firstUsefulLine(status.stdout) ?? `Exited with code ${status.exitCode ?? "unknown"}.`;
  const message = rawMessage.length > 300 ? `${rawMessage.slice(0, 297)}...` : rawMessage;
  return { message, command: status.command };
}

async function runAdapter(
  adapter: (typeof ALL_ADAPTERS)[number],
  ctx: ToolAdapterContext
): Promise<{ findings: Finding[]; status?: ToolResult }> {
  if (adapter.runStandalone) {
    return adapter.runStandalone(ctx);
  }

  if (adapter.buildScanCommand && adapter.parseResult) {
    const status = await runCommand(adapter.buildScanCommand(ctx), adapter.installHint);
    if (status.status === "skipped") {
      return { findings: [], status };
    }
    // Guard against brittle parser (unvalidated JSON, format drift in tsc etc.).
    // Standalone adapters already have partial internal try/catch; this covers the command+parseResult path.
    let parsed: Finding[] = [];
    try {
      parsed = adapter.parseResult(status, ctx) ?? [];
    } catch {
      parsed = [];
    }
    return { findings: parsed, status };
  }

  return {
    findings: [],
    status: {
      command: adapter.id,
      stdout: "",
      stderr: "Adapter has no scan command",
      exitCode: null,
      durationMs: 0,
      status: "skipped",
      installHint: adapter.installHint
    }
  };
}

export async function runScan(root: string, mode: ScanMode = "default"): Promise<ScanOutput> {
  const [{ config, configPath }, { policy }, project] = await Promise.all([loadConfig(root), loadAgentPolicy(root), detectProject(root)]);
  const plan = await createScanPlan(project, config, [...ALL_ADAPTERS], mode);
  const ctx = { root, project, config, scanMode: mode } as const;
  const selectedAdapters = ALL_ADAPTERS.filter((adapter) => plan.adapterIds.includes(adapter.id));

  // Run adapters concurrently for performance (independent tools; dead-chain post-process depends on aggregated findings).
  // This addresses the previous sequential for-loop bottleneck in runScan.
  const adapterResults = await Promise.all(
    selectedAdapters.map(async (adapter) => ({ adapter, result: await runAdapter(adapter, ctx) }))
  );

  const findings: Finding[] = [];
  const toolStatuses: ToolStatusSummary[] = [];
  const skippedTools: SkippedToolSummary[] = [];

  for (const { adapter, result } of adapterResults) {
    findings.push(...result.findings);

    if (!result.status) {
      continue;
    }

    if (result.status.status === "skipped") {
      skippedTools.push({
        id: adapter.id,
        status: "skipped",
        installHint: result.status.installHint ?? adapter.installHint
      });
      continue;
    }

    toolStatuses.push({ id: adapter.id, status: result.status.status, ...summarizeToolStatus(result.status) });
  }

  // Ouroboros/self-scan improvement: normalize statuses for tools that intentionally use non-zero exit for "findings reported"
  // or emit experimental warnings on otherwise-successful report formats (biome --reporter=json, knip exit-on-issues).
  // This prevents noise in "ERRORED TOOLS" while still surfacing real parse/crash errors.
  for (const ts of toolStatuses) {
    if (ts.id === "biome" && /unstable|experimental/i.test(ts.message || "")) {
      ts.status = "ok";
      ts.message = undefined;
    }
    if (ts.id === "knip" && ts.status === "error" && (ts.message || "").trim().startsWith("{")) {
      ts.status = "ok";
      ts.message = "Reported issues (debt surfaced as findings)";
    }
    if (ts.id === "vitest" && /Loaded .*vitest@.*coverage-v8/i.test(ts.message || "")) {
      // Vitest coverage adapter produces startup "Loaded ..." logs; treat as success when the dependency is available and a report was produced.
      ts.status = "ok";
      ts.message = undefined;
    }
  }

  let deadChainFindings: Finding[] = [];
  if (config.checks.deadCode.enabled) {
    const rawDead = await detectDeadChains(project, findings);
    const minConf = config.checks.deadCode.minConfidenceToReport;
    const rank: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };
    const minRank = rank[minConf];
    deadChainFindings = rawDead.filter((f) => rank[f.confidence] >= minRank);
  }
  let allFindings = dedupeFindings([...findings, ...deadChainFindings]);

  if (config.baseline.enabled) {
    const baseline = await loadBaseline(root, config.baseline.file);
    allFindings = applyBaseline(
      allFindings,
      new Set(baseline.findings.map((entry) => entry.fingerprint))
    );
  }

  allFindings = sortFindings(allFindings);
  const score = buildScore(allFindings);

  return buildScanOutput({
    root,
    mode,
    findings: allFindings,
    score,
    toolStatuses,
    skippedTools,
    testCommands: project.testCommands,
    policy,
    configPath
  });
}

export function filterScanByCategories(
  scan: ScanOutput,
  categories: FindingCategory[],
  options: FilterScanOptions = {}
): ScanOutput {
  const findings = sortFindings(scan.findings.filter((finding) => categories.includes(finding.category)));
  const score = buildScore(findings);

  return buildScanOutput({
    root: scan.root,
    mode: scan.mode,
    findings,
    score,
    toolStatuses: scan.toolStatuses,
    skippedTools: scan.skippedTools,
    testCommands: scan.testCommands,
    policy: options.policy,
    target: options.target ?? scan.agentPlan.target,
    configPath: scan.configPath
  });
}

export function buildSummaryLines(scan: ScanOutput): string[] {
  const lines = [`Health: ${scan.score.overall}/100 ${scan.score.overall >= 85 ? "✅" : "⚠️"}`, ""];

  lines.push(`Blockers: ${scan.blockers.length}`);
  lines.push(`Fix next: ${scan.fixNext.length}`);
  lines.push(`Leftovers: ${scan.leftovers.length}`);
  lines.push(`Dead code candidates: ${scan.deadCodeCandidates.length}`);
  lines.push(`Refactor candidates: ${scan.refactorCandidates.length}`);

  if (scan.blockers.length > 0) {
    lines.push("", "BLOCKERS");
    scan.blockers.forEach((finding, index) => lines.push(`${index + 1}. ${finding.message}${finding.file ? ` (${finding.file})` : ""}`));
  }

  if (scan.fixNext.length > 0) {
    lines.push("", "FIX NEXT");
    scan.fixNext.forEach((finding, index) => lines.push(`${index + 1}. ${finding.title}${finding.file ? ` (${finding.file})` : ""}`));
  }

  if (scan.leftovers.length > 0) {
    lines.push("", "LEFTOVERS");
    scan.leftovers.forEach((finding, index) => lines.push(`${index + 1}. ${finding.title}${finding.file ? ` (${finding.file})` : ""}`));
  }

  if (scan.deadCodeCandidates.length > 0) {
    lines.push("", "DEAD CHAINS");
    scan.deadCodeCandidates.forEach((finding, index) => lines.push(`${index + 1}. ${finding.message}`));
  }

  if (scan.skippedTools.length > 0) {
    lines.push("", "SKIPPED TOOLS");
    scan.skippedTools.forEach((tool, index) => lines.push(`${index + 1}. ${tool.id}${tool.installHint ? ` — ${tool.installHint}` : ""}`));
  }

  const erroredTools = scan.toolStatuses.filter((tool) => tool.status === "error" || tool.status === "timeout");
  if (erroredTools.length > 0) {
    lines.push("", "ERRORED TOOLS");
    erroredTools.forEach((tool, index) => lines.push(`${index + 1}. ${tool.id}${tool.message ? ` — ${tool.message}` : ` — ${tool.status}`}`));
  }

  lines.push("", "READY FOR AGENT", "Run:", "vibedoctor agent-plan");
  return lines;
}

export function buildExplainPayload(scan: ScanOutput, findingId: string): ExplainPayload {
  const finding = scan.findings.find((item) => item.id === findingId);

  if (!finding) {
    return {
      suggestions: ["Check the finding ID from `vibedoctor scan --report json`.", "Use `vibedoctor agent-plan` to see the current priority list."],
      relatedFindings: [],
      skippedTools: scan.skippedTools
    };
  }

  return {
    finding,
    suggestions: dedupeStrings([
      finding.agentInstruction,
      finding.fixCommand ? `Run: ${finding.fixCommand}` : undefined,
      finding.source === "gitleaks" ? "Rotate any exposed credential after removing it from source." : undefined
    ]),
    relatedFindings: scan.findings.filter(
      (candidate) =>
        candidate.id !== finding.id &&
        (candidate.file === finding.file || candidate.category === finding.category)
    ),
    skippedTools: scan.skippedTools
  };
}

export async function createBaseline(root: string): Promise<{ file: string; count: number }> {
  const [{ config }, scan] = await Promise.all([loadConfig(root), runScan(root, "full")]);
  await writeBaseline(root, config.baseline.file, scan.findings);
  return {
    file: config.baseline.file,
    count: scan.findings.length
  };
}

export async function safeFix(root: string): Promise<SafeFixResult> {
  const before = await runScan(root, "default");
  const [{ config }, project] = await Promise.all([loadConfig(root), detectProject(root)]);
  const ctx = { root, project, config, scanMode: "default" as const };
  const fixableAdapters = ALL_ADAPTERS.filter((adapter) => adapter.buildFixCommand && adapter.detect);
  const results: Array<ToolResult & { id: string }> = [];

  for (const adapter of fixableAdapters) {
    const shouldRun = await adapter.detect(project, config);
    if (!shouldRun || !adapter.buildFixCommand) {
      continue;
    }

    const result = await runCommand(adapter.buildFixCommand(ctx), adapter.installHint);
    results.push({ id: adapter.id, ...result });
  }

  const after = results.length > 0 ? await runScan(root, "default") : before;
  return { before, after, results };
}
