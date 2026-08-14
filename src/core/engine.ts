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
  telemetryDetectorAdapter,
  tscAdapter,
  vitestAdapter,
  vultureAdapter
} from "../adapters";
import { customLeftoversAdapter } from "../adapters/customLeftovers";
import { privacyDetectorAdapter } from "../adapters/privacyDetector";
import { dpdpAdapter } from "../adapters/dpdp";
import { customRefactorAdapter } from "../adapters/customRefactor";
import { detectDeadChains } from "../adapters/customDeadChain";
import { presidioAdapter } from "../adapters/presidio";
import {
  defaultAgentPolicy,
  getAllowedActions,
  getForbiddenActions,
  loadAgentPolicy,
  type AgentPolicy
} from "../agentPack/policy";
import type { ToolAdapterContext } from "../adapters/shared";
import { loadBaseline, writeBaseline } from "./baseline";
import { loadConfig, type VibeDoctorConfig } from "./config";
import { applyBaseline, dedupeFindings, type Finding, type FindingCategory } from "./finding";
import { detectProject, type ProjectContext } from "./projectDetector";
import { createScanPlan, type ScanMode } from "./scanPlanner";
import { buildScore, type ScoreBreakdown } from "./scoring";
import { runCommand, type ToolCoverage, type ToolResult } from "./toolRunner";
import { severityRank } from "../rules/severityMap";
import {
  buildCapabilityMatrix,
  isCoverageGap,
  renderCapabilityMatrixLines,
  type CapabilityMatrix,
  type CapabilityState,
  type ToolCapability
} from "./capability";
import { createFileRoleClassifier } from "./fileRole";
import { describeNormalizationIssues, normalizeFindings, type NormalizationIssue } from "./findingNormalizer";
import { applyRelevance, renderRelevanceLines, type RelevanceReport } from "./relevance";
import { applySuppressions, loadSuppressions, renderSuppressionLines, type SuppressionReport } from "./suppressions";
import { getToolEntry, installHintFor } from "./toolRegistry";
import { isVerificationBlocking, verifyTools, type ToolVerification } from "./toolVerification";
import {
  loadPrivacyReview,
  mergePrivacyReviewIntoFindings,
  type PrivacyReviewSummary
} from "./privacyReview";

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
  privacyDetectorAdapter,
  dpdpAdapter,
  presidioAdapter,
  telemetryDetectorAdapter,
  customLeftoversAdapter,
  customRefactorAdapter
] as const;

const categoryPriority: Record<FindingCategory, number> = {
  security: 0,
  tests: 1,
  correctness: 2,
  dependencies: 3,
  privacy: 4,
  dead_code: 5,
  leftovers: 6,
  refactor_readiness: 7,
  maintainability: 8,
  efficiency: 9
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
  status: ScanExecutionStatus;
  target: AgentPlanTarget;
  workflow: string[];
  rules: string[];
  allowedActions: string[];
  forbiddenActions: string[];
  doNotTouch: string[];
  recoveryActions: RecoveryAction[];
  tasks: AgentPlanTask[];
};

export type ScanExecutionStatus = "complete" | "partial" | "invalid";

export type RecoveryAction = {
  id: string;
  tool: string;
  command: string;
  successCondition: string;
  onFailure: string;
};

export type ScanCompleteness = {
  status: ScanExecutionStatus;
  comparable: boolean;
  planned: number;
  completed: number;
  incompleteTools: string[];
  requiredIncompleteTools: string[];
  reason?: string;
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
  privacyFindings: Finding[];
  privacyReview?: PrivacyReviewSummary;
  leftovers: Finding[];
  deadCodeCandidates: Finding[];
  refactorCandidates: Finding[];
  toolStatuses: ToolStatusSummary[];
  skippedTools: SkippedToolSummary[];
  completeness: ScanCompleteness;
  recoveryActions: RecoveryAction[];
  testCommands: string[];
  agentPlan: AgentPlan;
  configPath?: string;
  /** Per-tool record of what ran, what did not, and why. */
  capabilityMatrix: CapabilityMatrix;
  /** What relevance filtering withheld, so a short report is never mistaken for a clean one. */
  relevance: RelevanceReport;
  /** Acknowledged findings, their rationales, and any that lapsed. */
  suppressions: SuppressionReport;
  /** Findings hidden by an active acknowledgement, kept for audit. */
  suppressedFindings: Finding[];
  /** Tool-by-tool proof of what resolved and ran, with paths and versions. */
  verifications: ToolVerification[];
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
  completeness: ScanCompleteness;
  testCommands: string[];
  policy?: AgentPolicy;
  target?: AgentPlanTarget;
  configPath?: string;
  privacyReview?: PrivacyReviewSummary;
  capabilityMatrix: CapabilityMatrix;
  relevance: RelevanceReport;
  suppressions: SuppressionReport;
  suppressedFindings: Finding[];
  verifications: ToolVerification[];
};

const emptyRelevanceReport: RelevanceReport = {
  enabled: false,
  perTool: [],
  totalReported: 0,
  totalSurfaced: 0,
  notes: []
};

const emptySuppressionReport: SuppressionReport = {
  file: "",
  active: [],
  expired: [],
  invalid: [],
  permanent: [],
  hits: {},
  expiredHits: {},
  unused: [],
  resurfaced: 0
};

const emptyCapabilityMatrix: CapabilityMatrix = buildCapabilityMatrix([], []);

/**
 * Fills in the reporting fields a scan produces, for callers that reconstruct a
 * `ScanOutput` from something other than a live scan — a cached report written by
 * an older version, or a test fixture. The defaults describe an unknown scan
 * rather than a clean one: an empty matrix claims no coverage.
 */
export function withReportingDefaults(partial: Partial<ScanOutput> & Pick<ScanOutput, "findings">): ScanOutput {
  return {
    root: partial.root ?? process.cwd(),
    mode: partial.mode ?? "default",
    score: partial.score ?? buildScore(partial.findings),
    findings: partial.findings,
    topFindings: partial.topFindings ?? [],
    blockers: partial.blockers ?? [],
    fixNext: partial.fixNext ?? [],
    privacyFindings: partial.privacyFindings ?? [],
    privacyReview: partial.privacyReview,
    leftovers: partial.leftovers ?? [],
    deadCodeCandidates: partial.deadCodeCandidates ?? [],
    refactorCandidates: partial.refactorCandidates ?? [],
    toolStatuses: partial.toolStatuses ?? [],
    skippedTools: partial.skippedTools ?? [],
    completeness:
      partial.completeness ?? {
        status: "partial",
        comparable: false,
        planned: 0,
        completed: 0,
        incompleteTools: [],
        requiredIncompleteTools: [],
        reason: "This result was reconstructed without capability information, so coverage is unknown."
      },
    recoveryActions: partial.recoveryActions ?? [],
    testCommands: partial.testCommands ?? [],
    agentPlan:
      partial.agentPlan ??
      createAgentPlan({
        findings: partial.findings,
        score: partial.score ?? buildScore(partial.findings),
        skippedTools: partial.skippedTools ?? []
      }),
    configPath: partial.configPath,
    capabilityMatrix: partial.capabilityMatrix ?? emptyCapabilityMatrix,
    relevance: partial.relevance ?? emptyRelevanceReport,
    suppressions: partial.suppressions ?? emptySuppressionReport,
    suppressedFindings: partial.suppressedFindings ?? [],
    verifications: partial.verifications ?? []
  };
}

export type ToolRetryOutput = {
  tool: string;
  status: ToolResult["status"];
  timeoutSeconds: number;
  findings: Finding[];
  message?: string;
  successCondition: string;
  nextAction: string;
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
  const fixNext = ordered.filter((finding) => finding.category !== "leftovers" && finding.category !== "privacy").slice(0, 3);
  const privacyFindings = ordered.filter((finding) => finding.category === "privacy");
  const leftovers = ordered.filter((finding) => finding.category === "leftovers");
  const deadCodeCandidates = ordered.filter((finding) => finding.category === "dead_code");
  const refactorCandidates = ordered.filter((finding) => finding.category === "refactor_readiness");
  const topFindings = blockers.length > 0 ? blockers.slice(0, 5) : ordered.slice(0, 5);

  return {
    ordered,
    blockers,
    fixNext,
    privacyFindings,
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
  scan: Pick<ScanOutput, "findings" | "score" | "skippedTools"> &
    Partial<Pick<ScanOutput, "toolStatuses" | "completeness" | "recoveryActions">> &
    { testCommands?: string[] },
  options: { policy?: AgentPolicy; target?: AgentPlanTarget } = {}
): AgentPlan {
  const policy = options.policy ?? defaultAgentPolicy;
  const target = options.target ?? "generic";
  const toolStatuses = scan.toolStatuses ?? [];
  const completeness = scan.completeness ?? {
    status: scan.skippedTools.length > 0 ? "partial" : "complete",
    comparable: scan.skippedTools.length === 0,
    planned: 0,
    completed: 0,
    incompleteTools: scan.skippedTools.map((tool) => tool.id),
    requiredIncompleteTools: []
  };
  const recoveryActions = scan.recoveryActions ?? buildRecoveryActions(toolStatuses, scan.skippedTools);
  const ordered = sortFindings(scan.findings);
  const tasks = (completeness.status === "invalid" ? [] : ordered.slice(0, 5)).map<AgentPlanTask>((finding, index) => ({
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
    goal:
      completeness.status === "complete"
        ? `Raise health score from ${scan.score.overall} to ${targetScore(scan.score.overall)}`
        : "Recover incomplete checks before changing code, then improve validated findings",
    status: completeness.status,
    target,
    workflow: ["scan", "validate completeness", "recover tools", "plan", "safe fix", "edit carefully", "verify", "scan again", "summarize"],
    rules: [
      "Fix blockers before cleanup work.",
      "Do not delete low-confidence dead code.",
      "Do not refactor large files without tests.",
      "Do not lower test, lint, security, or coverage thresholds."
    ],
    allowedActions: getAllowedActions(policy),
    forbiddenActions: getForbiddenActions(policy),
    doNotTouch: [
      ...scan.skippedTools.map((tool) => `Do not assume ${tool.id} was fully checked because the tool was skipped.`),
      ...toolStatuses
        .filter((tool) => tool.status === "timeout" || tool.status === "error")
        .map((tool) => `Do not treat the health score as complete because ${tool.id} ${tool.status === "timeout" ? "timed out" : "failed"}.`)
    ],
    recoveryActions,
    tasks
  };
}

function buildScanOutput(options: BuildScanOutputOptions): ScanOutput {
  const summary = summarizeFindings(options.findings);
  const policy = options.policy ?? defaultAgentPolicy;
  const recoveryActions = buildRecoveryActions(options.toolStatuses, options.skippedTools);

  return {
    root: options.root,
    mode: options.mode,
    score: options.score,
    findings: summary.ordered,
    topFindings: summary.topFindings,
    blockers: summary.blockers,
    fixNext: summary.fixNext,
    privacyFindings: summary.privacyFindings,
    privacyReview: options.privacyReview,
    leftovers: summary.leftovers,
    deadCodeCandidates: summary.deadCodeCandidates,
    refactorCandidates: summary.refactorCandidates,
    toolStatuses: [...options.toolStatuses].sort((left, right) => left.id.localeCompare(right.id)),
    skippedTools: [...options.skippedTools].sort((left, right) => left.id.localeCompare(right.id)),
    completeness: options.completeness,
    recoveryActions,
    testCommands: options.testCommands,
    agentPlan: createAgentPlan(
      {
        findings: summary.ordered,
        score: options.score,
        toolStatuses: options.toolStatuses,
        skippedTools: options.skippedTools,
        completeness: options.completeness,
        recoveryActions,
        testCommands: options.testCommands
      },
      { policy, target: options.target }
    ),
    configPath: options.configPath,
    capabilityMatrix: options.capabilityMatrix,
    relevance: options.relevance,
    suppressions: options.suppressions,
    suppressedFindings: options.suppressedFindings,
    verifications: options.verifications
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

// Tools that intentionally use a non-zero exit for "findings reported" or emit
// experimental warnings on otherwise-successful runs. Shared by runScan and
// retryTool so a tool never "fails" in one path while "succeeding" in the other.
function forgiveKnownToolQuirks(
  toolId: string,
  result: ToolResult,
  findingsCount = 0
): { status: "ok"; message?: string } | undefined {
  if (result.status !== "error") {
    return undefined;
  }

  if (findingsCount > 0) {
    return { status: "ok", message: "Reported issues (debt surfaced as findings)" };
  }

  const output = `${result.stderr}\n${result.stdout}`;
  if (toolId === "biome" && /unstable|experimental/i.test(output)) {
    return { status: "ok" };
  }
  if (toolId === "knip" && result.stdout.trim().startsWith("{")) {
    return { status: "ok", message: "Reported issues (debt surfaced as findings)" };
  }
  if (toolId === "vitest" && /Loaded .*vitest@.*coverage-v8/i.test(output)) {
    return { status: "ok" };
  }
  if (toolId === "osv-scanner" && result.stdout.trim().startsWith("{")) {
    return { status: "ok", message: "Reported vulnerabilities as findings" };
  }
  return undefined;
}

type AdapterRun = {
  findings: Finding[];
  status?: ToolResult;
  /** Set when a parser threw, so "ran fine with no findings" is never implied. */
  parseError?: string;
  timeoutSeconds?: number;
};

/**
 * Narrows a context to a subset of files. A tool that cannot finish the whole
 * repository within its budget can still cover the code being changed, and
 * partial coverage that says so is worth more than no coverage at all.
 */
function narrowContextToFiles(ctx: ToolAdapterContext, files: string[]): ToolAdapterContext {
  return {
    ...ctx,
    project: { ...ctx.project, projectFiles: files }
  };
}

function commandText(command: { cmd: string; args: string[] }): string {
  return [command.cmd, ...command.args].join(" ");
}

/** A verification miss is still a result DPDP can reuse instead of launching the same missing tool again. */
function skippedForVerification(
  adapter: (typeof ALL_ADAPTERS)[number],
  verification: ToolVerification
): AdapterRun {
  return {
    findings: [],
    status: {
      command: adapter.id,
      stdout: "",
      stderr: verification.reason,
      exitCode: null,
      durationMs: 0,
      status: "skipped",
      installHint: verification.remediation ?? adapter.installHint
    }
  };
}

async function runAdapter(
  adapter: (typeof ALL_ADAPTERS)[number],
  ctx: ToolAdapterContext,
  deadline?: number
): Promise<AdapterRun> {
  if (adapter.runStandalone) {
    return adapter.runStandalone(ctx);
  }

  if (!adapter.buildScanCommand || !adapter.parseResult) {
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

  const { runtime } = ctx.config;
  const configuredSeconds = runtime.toolTimeouts[adapter.id] ?? runtime.defaultTimeoutSeconds;
  // A wall-clock ceiling for the whole scan has to bound each tool too, or the
  // slowest tool decides how long the scan takes regardless of the budget.
  const budgetSeconds = deadline ? Math.max(1, Math.round((deadline - Date.now()) / 1000)) : configuredSeconds;
  const timeoutSeconds = Math.min(configuredSeconds, budgetSeconds);

  const command = adapter.buildScanCommand(ctx);
  command.timeoutMs = timeoutSeconds * 1000;
  let status = await runCommand(command, adapter.installHint);

  if (status.status === "timeout" && runtime.onTimeout === "scoped_retry") {
    const scoped = await retryWithNarrowedScope(adapter, ctx, timeoutSeconds);
    if (scoped) {
      status = scoped;
    }
  }

  if (status.status === "skipped") {
    return { findings: [], status, timeoutSeconds };
  }

  // Guard against brittle parsers (unvalidated JSON, format drift in tsc etc.).
  // A parse failure is reported rather than swallowed: a tool that ran but whose
  // output could not be read has not actually checked anything.
  try {
    return { findings: adapter.parseResult(status, ctx) ?? [], status, timeoutSeconds };
  } catch (error) {
    return {
      findings: [],
      status,
      parseError: `Could not parse ${adapter.id} output: ${error instanceof Error ? error.message : String(error)}`,
      timeoutSeconds
    };
  }
}

/**
 * Reruns a timed-out tool over the changed files only. Skipped when narrowing
 * produces the same command line, since a tool that ignores the target list
 * would simply time out again.
 */
async function retryWithNarrowedScope(
  adapter: (typeof ALL_ADAPTERS)[number],
  ctx: ToolAdapterContext,
  originalTimeoutSeconds: number
): Promise<ToolResult | undefined> {
  const changed = ctx.project.changedFiles.filter((file) => ctx.project.projectFiles.includes(file));
  if (changed.length === 0 || !adapter.buildScanCommand) {
    return undefined;
  }

  const original = commandText(adapter.buildScanCommand(ctx));
  const narrowedCtx = narrowContextToFiles(ctx, changed);
  const narrowed = adapter.buildScanCommand(narrowedCtx);

  if (commandText(narrowed) === original) {
    return undefined;
  }

  narrowed.timeoutMs = Math.max(1, ctx.config.runtime.scopedRetryTimeoutSeconds) * 1000;
  const result = await runCommand(narrowed, adapter.installHint);

  const coverage: ToolCoverage = {
    scope: "scoped",
    detail: `Timed out after ${originalTimeoutSeconds}s over the full repository; rescanned ${changed.length} changed file(s) instead.`,
    targetsRequested: ctx.project.projectFiles.length,
    targetsScanned: changed.length
  };

  return result.status === "timeout"
    ? // Even the narrowed run did not finish. Report the original timeout rather
      // than a second one, and say the fallback was attempted.
      {
        ...result,
        coverage: {
          scope: "none",
          detail: `Timed out after ${originalTimeoutSeconds}s, and a scoped retry over ${changed.length} changed file(s) also timed out.`,
          targetsRequested: ctx.project.projectFiles.length,
          targetsScanned: 0
        }
      }
    : { ...result, coverage };
}

/**
 * Resolves each selected tool before the scan trusts it.
 *
 * Without this, a missing tool only revealed itself as an ENOENT mid-scan —
 * indistinguishable from a tool that ran and found nothing, and with no record of
 * which binary was even looked for. This runs at `resolve` depth: it locates the
 * executable and checks runtime compatibility without spawning a probe per tool,
 * because the scan is about to invoke each tool anyway. `vibedoctor setup` does
 * the same work at `execute` depth, where there is no later run to rely on.
 */
async function verifySelectedTools(
  root: string,
  adapterIds: string[],
  config: VibeDoctorConfig
): Promise<Map<string, ToolVerification>> {
  const entries = adapterIds.map(getToolEntry).filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

  if (!config.runtime.verifyToolsBeforeScan || entries.length === 0) {
    return new Map();
  }

  const verifications = await verifyTools(entries, root, "resolve");
  return new Map(verifications.map((verification) => [verification.id, verification]));
}

/** Derives the capability state for a tool that was selected and attempted. */
function stateForRun(
  id: string,
  run: AdapterRun,
  verification: ToolVerification | undefined,
  findingsCount: number
): CapabilityState {
  if (verification && isVerificationBlocking(verification)) {
    return verification.state === "incompatible_runtime" ? "runtime_incompatible" : "not_installed";
  }

  const status = run.status;
  if (!status) {
    // Built-in checks report no process status; reaching here means they ran.
    return "completed";
  }

  if (status.status === "skipped") {
    return "not_installed";
  }
  if (status.status === "timeout") {
    return status.coverage?.scope === "scoped" ? "partial" : "timed_out";
  }
  if (run.parseError) {
    return "failed";
  }
  if (status.status === "error") {
    return forgiveKnownToolQuirks(id, status, findingsCount) ? "completed" : "failed";
  }

  return status.coverage && status.coverage.scope !== "full" ? "partial" : "completed";
}

function reasonForCapability(
  id: string,
  state: CapabilityState,
  run: AdapterRun,
  verification: ToolVerification | undefined,
  normalizationNote: string | undefined
): { reason: string; remediation?: string } {
  if (verification && isVerificationBlocking(verification)) {
    return { reason: verification.reason, remediation: verification.remediation };
  }

  switch (state) {
    case "completed": {
      const where = verification?.resolvedPath ?? run.status?.resolvedPath;
      const version = verification?.version ? ` ${verification.version}` : "";
      const base = where ? `Ran${version} at ${where}.` : `Completed${version}.`;
      return { reason: normalizationNote ? `${base} ${normalizationNote}` : base };
    }
    case "partial":
      return {
        reason: run.status?.coverage?.detail ?? "Covered only part of the requested scope.",
        remediation: `Raise runtime.tool_timeouts.${id} in vibedoctor.yml, or run \`vibedoctor tool retry ${id}\` with a longer budget.`
      };
    case "timed_out":
      return {
        reason:
          run.status?.coverage?.detail ??
          `Exceeded its ${run.timeoutSeconds ?? "configured"}s budget and was stopped, so this check did not run.`,
        remediation: `Raise runtime.tool_timeouts.${id} in vibedoctor.yml, scan fewer paths, or run \`vibedoctor scan --changed\` for a diff-scoped run.`
      };
    case "failed":
      return {
        reason: run.parseError ?? summarizeToolStatus(run.status!).message ?? "Failed while running.",
        remediation: `Run \`vibedoctor tool retry ${id}\` to see the full output.`
      };
    case "not_installed":
      return {
        reason: `${id} is not installed or could not be found on PATH, so this check did not run.`,
        remediation: run.status?.installHint ?? (getToolEntry(id) ? installHintFor(getToolEntry(id)!) : `Install ${id}.`)
      };
    case "runtime_incompatible":
      return {
        reason: `${id} cannot run under the active runtime.`,
        remediation: `Upgrade the runtime or add ${id} to runtime.deferred_tools to defer it deliberately.`
      };
    default:
      return { reason: "Did not run." };
  }
}

export async function runScan(root: string, mode: ScanMode = "default"): Promise<ScanOutput> {
  const [{ config, configPath }, { policy }] = await Promise.all([loadConfig(root), loadAgentPolicy(root)]);
  const project = await detectProject(root, config.paths.exclude);
  const plan = await createScanPlan(project, config, [...ALL_ADAPTERS], mode);
  const ctx = { root, project, config, scanMode: mode } as const;
  const selectedAdapters = ALL_ADAPTERS.filter((adapter) => plan.adapterIds.includes(adapter.id));
  const verifications = await verifySelectedTools(root, plan.adapterIds, config);

  // A tool that failed verification is not launched: doing so produces a
  // confusing process error in place of the clear reason we already have.
  const runnableAdapters = selectedAdapters.filter((adapter) => {
    const verification = verifications.get(adapter.id);
    return !verification || !isVerificationBlocking(verification);
  });

  const deadline =
    config.runtime.totalBudgetSeconds > 0 ? Date.now() + config.runtime.totalBudgetSeconds * 1000 : undefined;

  const independentAdapters = runnableAdapters.filter((adapter) => adapter.id !== "dpdp");

  // Run independent adapters once. DPDP follows so it can reuse optional scanner
  // findings/status instead of launching duplicate Semgrep and Presidio processes.
  const adapterResults: Array<{ adapter: (typeof ALL_ADAPTERS)[number]; result: AdapterRun }> = await Promise.all(
    independentAdapters.map(async (adapter) => ({ adapter, result: await runAdapter(adapter, ctx, deadline) }))
  );

  if (runnableAdapters.some((adapter) => adapter.id === "dpdp")) {
    const blockedShares = selectedAdapters
      .filter((adapter) => adapter.id !== "dpdp" && !runnableAdapters.includes(adapter))
      .map((adapter) => {
        const verification = verifications.get(adapter.id);
        return verification ? ([adapter.id, skippedForVerification(adapter, verification)] as const) : undefined;
      })
      .filter((entry): entry is readonly [string, AdapterRun] => Boolean(entry));
    const sharedToolResults = Object.fromEntries([
      ...adapterResults.map(({ adapter, result }) => [adapter.id, result] as const),
      ...blockedShares
    ]);
    const dpdpCtx: ToolAdapterContext = { ...ctx, sharedToolResults };
    adapterResults.push({ adapter: dpdpAdapter, result: await runAdapter(dpdpAdapter, dpdpCtx, deadline) });
  }

  const classifyFile = createFileRoleClassifier(config.relevance.fileRoles);
  const findings: Finding[] = [];
  const capabilities: ToolCapability[] = [];
  const normalizationIssues: NormalizationIssue[] = [];

  for (const { adapter, result } of adapterResults) {
    // Normalize per tool so location loss and enum drift are attributed to the
    // tool that caused them rather than averaged across the whole scan.
    const normalized = await normalizeFindings(result.findings, {
      root,
      tool: adapter.id,
      classifyFile,
      changedFiles: project.changedFiles
    });
    normalizationIssues.push(...normalized.issues);
    findings.push(...normalized.findings);

    const verification = verifications.get(adapter.id);
    const state = stateForRun(adapter.id, result, verification, normalized.findings.length);
    const { reason, remediation } = reasonForCapability(
      adapter.id,
      state,
      result,
      verification,
      describeNormalizationIssues(normalized.issues)
    );

    capabilities.push({
      id: adapter.id,
      category: adapter.category,
      state,
      planned: true,
      applicable: true,
      discovered: verification ? verification.state === "verified" : result.status?.status !== "skipped",
      executed: Boolean(result.status) || state === "completed",
      resolvedPath: verification?.resolvedPath ?? result.status?.resolvedPath ?? verification?.interpreterPath,
      version: verification?.version,
      command: result.status?.command,
      durationMs: result.status?.durationMs,
      timeoutSeconds: result.timeoutSeconds,
      coverage: result.status?.coverage,
      findingsReported: normalized.findings.length,
      // Filled in once relevance and suppressions have run.
      findingsSurfaced: normalized.findings.length,
      reason,
      remediation,
      trust: "authoritative"
    });
  }

  // Tools that failed verification never launched, so record them from the
  // verification result alone.
  for (const adapter of selectedAdapters) {
    if (runnableAdapters.includes(adapter)) {
      continue;
    }
    const verification = verifications.get(adapter.id)!;
    const state: CapabilityState = verification.state === "incompatible_runtime" ? "runtime_incompatible" : "not_installed";
    capabilities.push({
      id: adapter.id,
      category: adapter.category,
      state,
      planned: true,
      applicable: true,
      discovered: verification.state !== "not_found",
      executed: false,
      resolvedPath: verification.resolvedPath ?? verification.interpreterPath,
      version: verification.version,
      findingsReported: 0,
      findingsSurfaced: 0,
      reason: verification.reason,
      remediation: verification.remediation,
      trust: "absent"
    });
  }

  for (const excluded of plan.excluded) {
    const adapter = ALL_ADAPTERS.find((candidate) => candidate.id === excluded.id);
    capabilities.push({
      id: excluded.id,
      category: adapter?.category ?? "maintainability",
      state: excluded.state,
      planned: false,
      applicable: excluded.state !== "not_applicable",
      discovered: false,
      executed: false,
      findingsReported: 0,
      findingsSurfaced: 0,
      reason: excluded.reason,
      remediation:
        excluded.state === "deferred"
          ? `Remove ${excluded.id} from runtime.deferred_tools to run it again.`
          : excluded.state === "not_selected"
            ? "Run `vibedoctor scan --full` to include it."
            : undefined,
      trust: "authoritative"
    });
  }

  let deadChainFindings: Finding[] = [];
  if (config.checks.deadCode.enabled) {
    const rawDead = await detectDeadChains(project, findings, config);
    const minConf = config.checks.deadCode.minConfidenceToReport;
    const rank: Record<"low" | "medium" | "high", number> = { low: 0, medium: 1, high: 2 };
    const minRank = rank[minConf];
    deadChainFindings = rawDead.filter((f) => rank[f.confidence] >= minRank);
  }

  let allFindings = dedupeFindings([...findings, ...deadChainFindings]);

  // Baseline first, so novelty is known before ranking; then acknowledgements,
  // which may reclassify a finding as resurfaced; then relevance, which ranks and
  // caps what is left.
  if (config.baseline.enabled) {
    const baseline = await loadBaseline(root, config.baseline.file);
    allFindings = applyBaseline(allFindings, new Set(baseline.findings.map((entry) => entry.fingerprint)));
  }

  const suppressionsResult = config.suppressions.enabled
    ? applySuppressions(allFindings, await loadSuppressions(root, config.suppressions.file), {
        requireExpiry: config.suppressions.requireExpiry
      })
    : { findings: allFindings, suppressed: [] as Finding[], report: { ...emptySuppressionReport, file: config.suppressions.file } };

  const relevanceResult = await applyRelevance(suppressionsResult.findings, {
    root,
    config: config.relevance
  });

  allFindings = relevanceResult.findings;

  const privacyReview = await loadPrivacyReview(root, config.output.privacyReview);
  allFindings = mergePrivacyReviewIntoFindings(allFindings, privacyReview);
  allFindings = sortFindings(allFindings);

  // Record what actually reached the report per tool, so "installed" and
  // "completed" and "reported something you can read" stay separate facts.
  const surfacedBySource = new Map<string, number>();
  for (const finding of allFindings) {
    surfacedBySource.set(finding.source, (surfacedBySource.get(finding.source) ?? 0) + 1);
  }
  for (const capability of capabilities) {
    capability.findingsSurfaced = surfacedBySource.get(capability.id) ?? 0;
    capability.trust =
      capability.state === "completed" ||
      capability.state === "not_applicable" ||
      capability.state === "disabled" ||
      capability.state === "not_selected"
        ? "authoritative"
        : capability.state === "partial"
          ? "partial"
          : "absent";
  }

  const capabilityMatrix = buildCapabilityMatrix(capabilities, config.runtime.requiredTools);
  const { toolStatuses, skippedTools, completeness } = deriveLegacyStatuses(capabilityMatrix, config);
  const score = buildScore(allFindings);

  return buildScanOutput({
    root,
    mode,
    findings: allFindings,
    score,
    toolStatuses,
    skippedTools,
    completeness,
    testCommands: project.testCommands,
    policy,
    configPath,
    privacyReview: privacyReview?.summary,
    capabilityMatrix,
    relevance: relevanceResult.report,
    suppressions: suppressionsResult.report,
    suppressedFindings: suppressionsResult.suppressed,
    verifications: Array.from(verifications.values())
  });
}

/**
 * Projects the capability matrix onto the older `toolStatuses` / `skippedTools` /
 * `completeness` shapes, which the reporters, agent plan, and MCP tools consume.
 * The matrix is the source of truth; these are views of it.
 */
function deriveLegacyStatuses(
  matrix: CapabilityMatrix,
  config: VibeDoctorConfig
): { toolStatuses: ToolStatusSummary[]; skippedTools: SkippedToolSummary[]; completeness: ScanCompleteness } {
  const toolStatuses: ToolStatusSummary[] = [];
  const skippedTools: SkippedToolSummary[] = [];

  for (const tool of matrix.tools) {
    if (tool.state === "not_installed" || tool.state === "runtime_incompatible" || tool.state === "deferred") {
      skippedTools.push({ id: tool.id, status: "skipped", installHint: tool.remediation });
      continue;
    }
    if (tool.state === "not_applicable" || tool.state === "disabled" || tool.state === "not_selected") {
      continue;
    }

    toolStatuses.push({
      id: tool.id,
      status: tool.state === "timed_out" ? "timeout" : tool.state === "failed" ? "error" : "ok",
      message: tool.state === "completed" ? undefined : tool.reason,
      command: tool.command
    });
  }

  const gaps = matrix.tools.filter(isCoverageGap).map((tool) => tool.id);
  const planned = matrix.tools.filter((tool) => tool.planned).length;

  return {
    toolStatuses,
    skippedTools,
    completeness: {
      status:
        gaps.length === 0
          ? "complete"
          : matrix.requiredGaps.length > 0 || config.runtime.failOnIncompleteScan
            ? "invalid"
            : "partial",
      comparable: gaps.length === 0,
      planned,
      completed: Math.max(0, planned - gaps.length),
      incompleteTools: gaps,
      requiredIncompleteTools: matrix.requiredGaps,
      reason: gaps.length > 0 ? `${gaps.length} of ${planned} planned checks did not fully complete.` : undefined
    }
  };
}

export async function retryTool(root: string, toolId: string, timeoutSeconds?: number): Promise<ToolRetryOutput> {
  const { config } = await loadConfig(root);
  const project = await detectProject(root, config.paths.exclude);
  const adapter = ALL_ADAPTERS.find((candidate) => candidate.id === toolId);
  if (!adapter || !adapter.buildScanCommand || !adapter.parseResult) {
    return {
      tool: toolId,
      status: "skipped",
      timeoutSeconds: timeoutSeconds ?? config.runtime.defaultTimeoutSeconds,
      findings: [],
      message: `Tool ${toolId} is unknown or does not support isolated retry.`,
      successCondition: `${toolId} completes with status ok`,
      nextAction: "Run vibedoctor scan --full --report agent-json and request human review if the tool remains incomplete."
    };
  }

  const ctx = { root, project, config, scanMode: "full" } as const;
  const seconds = timeoutSeconds ?? Math.max(
    config.runtime.defaultTimeoutSeconds,
    (config.runtime.toolTimeouts[toolId] ?? config.runtime.defaultTimeoutSeconds) * 2
  );
  const command = adapter.buildScanCommand(ctx);
  command.timeoutMs = seconds * 1000;
  const result = await runCommand(command, adapter.installHint);
  let parseError: string | undefined;
  let findings: Finding[] = [];
  if (result.status !== "skipped") {
    try {
      findings = adapter.parseResult(result, ctx) ?? [];
    } catch (error) {
      // A run that produced unparseable output is not a success; report it so
      // agents do not mistake "ok with zero findings" for a clean result.
      parseError = `Could not parse ${toolId} output: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
  const forgiven = forgiveKnownToolQuirks(toolId, result, findings.length);
  const status = parseError ? "error" : forgiven?.status ?? result.status;
  const summary = summarizeToolStatus(result);
  return {
    tool: toolId,
    status,
    timeoutSeconds: seconds,
    findings,
    message: parseError ?? forgiven?.message ?? summary.message,
    successCondition: `${toolId} completes with status ok`,
    nextAction:
      status === "ok"
        ? "Run vibedoctor scan --full --report agent-json to produce a comparable health result."
        : `Keep the scan partial and disclose missing ${toolId} coverage before changing risky code.`
  };
}

function buildRecoveryActions(
  toolStatuses: ToolStatusSummary[],
  skippedTools: SkippedToolSummary[] = []
): RecoveryAction[] {
  const failed = toolStatuses
    .filter((tool) => tool.status === "timeout" || tool.status === "error")
    .map((tool) => ({
      id: `recover-${tool.id}`,
      tool: tool.id,
      command: `vibedoctor tool retry ${tool.id}`,
      successCondition: `${tool.id} completes with status ok`,
      onFailure: `Keep the scan partial, disclose missing ${tool.id} coverage, and request human review before risky changes.`
    }));
  const skipped = skippedTools.map((tool) => ({
    id: `recover-${tool.id}`,
    tool: tool.id,
    command: "vibedoctor setup --include recommended",
    successCondition: `${tool.id} is installed and completes on the next scan`,
    onFailure: `${(tool.installHint ?? `Install ${tool.id}`).replace(/[.,;:]$/, "")}, then rerun the scan; otherwise disclose missing ${tool.id} coverage.`
  }));
  return [...failed, ...skipped];
}

function categoryScopeNote(categories: FindingCategory[]): string {
  return `Counted across the whole scan, not only the ${categories.join(", ")} findings shown here.`;
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
    completeness: scan.completeness,
    testCommands: scan.testCommands,
    policy: options.policy,
    target: options.target ?? scan.agentPlan.target,
    configPath: scan.configPath,
    privacyReview: scan.privacyReview,
    // The matrix describes the scan, not the filtered view, so it carries over
    // unchanged apart from the surfaced counts, which now reflect the filter.
    capabilityMatrix: {
      ...scan.capabilityMatrix,
      tools: scan.capabilityMatrix.tools.map((tool) => ({
        ...tool,
        findingsSurfaced: findings.filter((finding) => finding.source === tool.id).length
      }))
    },
    // Filtering and acknowledgement counts were computed over the whole scan and
    // cannot be re-attributed here (a withheld finding is no longer around to be
    // categorised), so they are carried over and labelled as scan-wide rather
    // than presented as totals for the categories on screen.
    relevance: { ...scan.relevance, scopeNote: categoryScopeNote(categories) },
    suppressions: { ...scan.suppressions, scopeNote: categoryScopeNote(categories) },
    suppressedFindings: scan.suppressedFindings.filter((finding) => categories.includes(finding.category)),
    verifications: scan.verifications
  });
}

export function buildSummaryLines(scan: ScanOutput): string[] {
  const lines = [
    `Health: ${scan.score.overall}/100 — ${scan.completeness.status.toUpperCase()} ${scan.score.overall >= 85 ? "✅" : "⚠️"}`,
    `Scan coverage: ${scan.completeness.completed}/${scan.completeness.planned} checks completed`,
    ...(scan.completeness.comparable ? [] : ["This score is not comparable to a complete scan."]),
    ""
  ];

  lines.push(`Blockers: ${scan.blockers.length}`);
  lines.push(`Fix next: ${scan.fixNext.length}`);
  lines.push(`Privacy Review findings: ${scan.privacyFindings.length}`);
  const dpdpFindings = scan.privacyFindings.filter((finding) => finding.source === "dpdp");
  if (dpdpFindings.length > 0) {
    lines.push(`DPDP technical findings: ${dpdpFindings.length} (not legal compliance)`);
  }
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

  if (scan.privacyFindings.length > 0) {
    lines.push("", "PRIVACY REVIEW FINDINGS");
    scan.privacyFindings
      .slice(0, 5)
      .forEach((finding, index) =>
        lines.push(`${index + 1}. ${finding.title}${finding.file ? ` (${finding.file}${finding.startLine ? `:${finding.startLine}` : ""})` : ""}`)
      );
  }

  if (dpdpFindings.length > 0) {
    lines.push("", "DPDP TECHNICAL FINDINGS (not legal compliance)");
    dpdpFindings
      .slice(0, 5)
      .forEach((finding, index) =>
        lines.push(`${index + 1}. ${finding.title}${finding.file ? ` (${finding.file}${finding.startLine ? `:${finding.startLine}` : ""})` : ""}`)
      );
    lines.push("Artifacts: .vibedoctor/dpdp/ · Command: vibedoctor dpdp report --markdown");
  }

  if (scan.leftovers.length > 0) {
    lines.push("", "LEFTOVERS");
    scan.leftovers.forEach((finding, index) => lines.push(`${index + 1}. ${finding.title}${finding.file ? ` (${finding.file})` : ""}`));
  }

  if (scan.deadCodeCandidates.length > 0) {
    lines.push("", "DEAD CHAINS");
    scan.deadCodeCandidates.forEach((finding, index) => lines.push(`${index + 1}. ${finding.message}`));
  }

  // One table replaces the old "skipped tools" and "errored tools" lists. Those
  // could not distinguish a tool that was never applicable from one that timed
  // out mid-scan, and said nothing about how much of the repository was covered.
  const matrixLines = renderCapabilityMatrixLines(scan.capabilityMatrix);
  if (matrixLines.length > 0) {
    lines.push("", "TOOL COVERAGE", ...matrixLines);
  }

  const relevanceLines = renderRelevanceLines(scan.relevance);
  if (relevanceLines.length > 0) {
    lines.push("", "REPORT FILTERING", ...relevanceLines);
  }

  const suppressionLines = renderSuppressionLines(scan.suppressions);
  if (suppressionLines.length > 0) {
    lines.push("", "ACKNOWLEDGED", ...suppressionLines);
  }

  if (scan.recoveryActions.length > 0) {
    lines.push("", "RECOVER BEFORE EDITING");
    scan.recoveryActions.forEach((action, index) => lines.push(`${index + 1}. ${action.command} — success: ${action.successCondition}`));
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
  const { config } = await loadConfig(root);
  const project = await detectProject(root, config.paths.exclude);
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
