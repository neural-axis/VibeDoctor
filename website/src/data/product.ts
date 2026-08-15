/**
 * Verified product facts for the marketing site.
 * Sourced from package.json, README, CLI --help, and src/ as of @neuralaxis/vibedoctor@0.2.1.
 * Do not invent capabilities here.
 */

export const product = {
  name: "VibeDoctor",
  package: "@neuralaxis/vibedoctor",
  version: "0.2.1",
  license: "GPL-3.0-or-later",
  tagline: "Give VibeDoctor a repository. It figures out what applies, runs the diagnosis, and tells you or your coding agent what to fix first.",
  cliTagline: "Brutally simple repo health diagnosis.",
  description:
    "Health diagnosis and fix planning for JS, TS, Python, and mixed repositories.",
  maker: "NeuralAxis",
  productIndex: "01",
  node: ">=18"
} as const;

export const links = {
  github: "https://github.com/neural-axis/VibeDoctor",
  npm: "https://www.npmjs.com/package/@neuralaxis/vibedoctor",
  issues: "https://github.com/neural-axis/VibeDoctor/issues",
  neuralaxis: "https://neuralaxis.ai",
  benki: "https://benki.tech"
} as const;

export const commands = {
  scan: "npx @neuralaxis/vibedoctor scan",
  scanAgentJson: "npx @neuralaxis/vibedoctor scan --report agent-json",
  scanChanged: "npx @neuralaxis/vibedoctor scan --changed",
  scanQuick: "npx @neuralaxis/vibedoctor scan --quick",
  scanFull: "npx @neuralaxis/vibedoctor scan --full",
  setup: "npx @neuralaxis/vibedoctor setup",
  setupApply: "npx @neuralaxis/vibedoctor setup --apply",
  init: "npx @neuralaxis/vibedoctor init",
  agentPlan: "npx @neuralaxis/vibedoctor agent-plan --format markdown",
  verify: "npx @neuralaxis/vibedoctor verify",
  fixSafe: "npx @neuralaxis/vibedoctor fix --safe",
  explain: "npx @neuralaxis/vibedoctor explain <finding-id>",
  mcp: "npx @neuralaxis/vibedoctor mcp",
  agentInit: "npx @neuralaxis/vibedoctor agent init --targets all",
  agentDoctor: "npx @neuralaxis/vibedoctor agent doctor --targets all",
  agentPlugin: "npx @neuralaxis/vibedoctor agent plugin --targets all --force",
  privacyReview: "npx @neuralaxis/vibedoctor privacy-review --refresh --format markdown",
  dpdpScan: "npx @neuralaxis/vibedoctor dpdp scan --full",
  dpdpInit: "npx @neuralaxis/vibedoctor dpdp init",
  globalInstall: "npm install -g @neuralaxis/vibedoctor",
  toolRetry: "npx @neuralaxis/vibedoctor tool retry semgrep --timeout 600",
  reportHtml: "npx @neuralaxis/vibedoctor report --html",
  baseline: "npx @neuralaxis/vibedoctor baseline create"
} as const;

export const languages = ["JavaScript", "TypeScript", "Python", "Mixed repositories"] as const;

export const categories = [
  {
    id: "security",
    label: "Security",
    looksFor: "Secrets, insecure patterns, known-vulnerable dependencies."
  },
  {
    id: "correctness",
    label: "Correctness",
    looksFor: "Type and lint failures from TypeScript, Pyright, Ruff, Biome, and similar local tools."
  },
  {
    id: "dead_code",
    label: "Dead code",
    looksFor: "Unused files, exports, isolated file clusters, and dead chains."
  },
  {
    id: "leftovers",
    label: "Leftovers",
    looksFor: "Stale TODOs, commented-out code, fallback flags, and half-removed features."
  },
  {
    id: "maintainability",
    label: "Maintainability",
    looksFor: "Duplication and complexity signals that bury later work."
  },
  {
    id: "dependencies",
    label: "Dependencies",
    looksFor: "Missing, unused, and vulnerable packages from lockfiles and manifests."
  },
  {
    id: "tests",
    label: "Tests",
    looksFor: "Failing suites and coverage signals from Vitest, Jest, and coverage.py."
  },
  {
    id: "privacy",
    label: "Privacy",
    looksFor: "Regulated identifiers, personal-data fields, and risky combinations."
  },
  {
    id: "efficiency",
    label: "Efficiency",
    looksFor: "Complexity and size hotspots used for refactor planning."
  },
  {
    id: "refactor_readiness",
    label: "Refactor readiness",
    looksFor: "Large or tangled files that need tests before a safe split."
  }
] as const;

export const tools = [
  { id: "custom-leftovers", ecosystem: "built-in", langs: "any", role: "Stale TODOs, commented-out code, fallbacks, AI leftovers." },
  { id: "custom-dead-chain", ecosystem: "built-in", langs: "any", role: "Isolated file clusters after external dead-code tools report candidates." },
  { id: "custom-refactor", ecosystem: "built-in", langs: "any", role: "Large or complex files that need tests before refactor work." },
  { id: "privacy-detector", ecosystem: "built-in", langs: "any", role: "Personal-data and Privacy Review signals. Stays on the machine." },
  { id: "telemetry-detector", ecosystem: "built-in", langs: "JS / TS", role: "Optional telemetry opt-out signal for frameworks that collect it." },
  { id: "flow-doctor", ecosystem: "built-in", langs: "JS / TS / Python", role: "Structural flow checks: route/handler wiring, swallowed errors, high-confidence unreachable handlers." },
  { id: "tsc", ecosystem: "npm", langs: "TypeScript", role: "TypeScript correctness." },
  { id: "biome", ecosystem: "npm", langs: "JS / TS", role: "Lint and safe formatting." },
  { id: "knip", ecosystem: "npm", langs: "JS / TS", role: "Unused files, exports, and dependencies." },
  { id: "jscpd", ecosystem: "npm", langs: "JS / TS", role: "Duplication for refactor planning." },
  { id: "ruff", ecosystem: "python", langs: "Python", role: "Lint and safe-fix signal." },
  { id: "pyright", ecosystem: "python", langs: "Python", role: "Type correctness." },
  { id: "vulture", ecosystem: "python", langs: "Python", role: "Dead-code signal." },
  { id: "deptry", ecosystem: "python", langs: "Python", role: "Dependency hygiene." },
  { id: "radon", ecosystem: "python", langs: "Python", role: "Complexity." },
  { id: "coverage.py", ecosystem: "python", langs: "Python", role: "Coverage." },
  { id: "gitleaks", ecosystem: "managed", langs: "any", role: "Secret detection. VibeDoctor can provision a pinned copy." },
  { id: "osv-scanner", ecosystem: "managed", langs: "any", role: "Known-vulnerability detection from lockfiles. VibeDoctor can provision a pinned copy." },
  { id: "semgrep", ecosystem: "manual", langs: "any", role: "Additional security and correctness rules." },
  { id: "lizard", ecosystem: "manual", langs: "any", role: "Function-level complexity and size." },
  { id: "presidio", ecosystem: "manual", langs: "any", role: "Optional external PII analyzer. Skipped if missing." },
  { id: "vitest / jest", ecosystem: "npm", langs: "JS / TS", role: "Test failure signal." }
] as const;

export const completeness = [
  {
    status: "COMPLETE",
    meaning: "All required checks completed.",
    action: "Work through the ranked findings."
  },
  {
    status: "PARTIAL",
    meaning: "Some checks were skipped, failed, or timed out.",
    action: "Follow recoveryActions. Do not rely on the score alone."
  },
  {
    status: "INVALID",
    meaning: "Not enough trustworthy evidence for an authoritative result.",
    action: "Recover the required scanners and scan again before editing."
  }
] as const;

export const exitCodes = [
  { code: "0", meaning: "The scan completed and configured gates passed." },
  { code: "1", meaning: "One or more configured health gates failed." },
  { code: "2", meaning: "Required checks were incomplete." }
] as const;

export const evidenceGrades = [
  { id: "verified", meaning: "A code path was followed and the claim holds." },
  { id: "observed", meaning: "A concrete match exists at a real location; its meaning is inferred." },
  { id: "heuristic", meaning: "Inferred from names, patterns, or shape rather than behaviour." },
  { id: "unproven", meaning: "Neither presence nor absence could be established from the code." }
] as const;

export const toolStates = [
  "completed",
  "partial",
  "timed out",
  "failed",
  "not installed",
  "runtime mismatch",
  "deferred",
  "disabled",
  "not applicable",
  "not selected"
] as const;

export const agentTargets = ["codex", "copilot", "claude", "cursor"] as const;
export const pluginTargets = ["codex", "claude"] as const;

export const mcpTools = [
  { name: "vibedoctor_scan_changed", does: "Run VibeDoctor on changed files and return normalized findings." },
  { name: "vibedoctor_scan_full", does: "Run a full repository scan." },
  { name: "vibedoctor_get_report", does: "Retrieve the current normalized report." },
  { name: "vibedoctor_explain_finding", does: "Explain a single finding by ID." },
  { name: "vibedoctor_fix_safe", does: "Apply supported safe tool fixes." },
  { name: "vibedoctor_get_agent_plan", does: "Return the current repair plan in JSON or markdown." },
  { name: "vibedoctor_verify", does: "Re-run a changed-scope scan after edits." },
  { name: "vibedoctor_dpdp_scan", does: "Run a DPDP technical-readiness scan." },
  { name: "vibedoctor_dpdp_scan_changed", does: "Collect DPDP evidence from changed files." },
  { name: "vibedoctor_dpdp_get_data_map", does: "Return the personal-data map." },
  { name: "vibedoctor_dpdp_get_control_matrix", does: "Return the control matrix." },
  { name: "vibedoctor_dpdp_get_review_queue", does: "Return questions that require human review." },
  { name: "vibedoctor_dpdp_explain_control", does: "Explain a control or finding." },
  { name: "vibedoctor_dpdp_get_evidence", does: "Return the evidence ledger." },
  { name: "vibedoctor_dpdp_verify", does: "Verify DPDP technical readiness after changes." },
  { name: "vibedoctor_dpdp_generate_handoff", does: "Generate a DPDP agent handoff." }
] as const;

/** Specimen taken from tests/snapshots/report.json and fixtures/broken-security. */
export const specimen = {
  label: "SPECIMEN / TEST FIXTURE",
  findingId: "gitleaks:src/config.ts:1",
  source: "gitleaks",
  category: "security",
  severity: "critical",
  confidence: "high",
  title: "Hardcoded secret",
  message: "Hardcoded secret in config",
  file: "src/config.ts",
  startLine: 1,
  snippet: 'export const API_TOKEN = "ghp_example_secret_value_1234567890";',
  health: "71/100",
  completeness: "PARTIAL",
  blockers: 1,
  fixNext: 3,
  leftovers: 1,
  deadCode: 1,
  why: "A credential-like value is committed in source. Gitleaks reported a match at an exact location.",
  evidence: [
    "literal assignment in src/config.ts:1",
    "known GitHub personal-access-token prefix (ghp_)",
    "finding ID gitleaks:src/config.ts:1 is stable across runs of the same tree"
  ],
  prescription: "Move the credential to an environment variable. Do not commit tokens.",
  coverage: [
    {
      tool: "gitleaks",
      state: "completed",
      findings: "1",
      time: "1.2s",
      detail: "Ran 8.18.0."
    },
    {
      tool: "semgrep",
      state: "timed out",
      findings: "0",
      time: "300.0s",
      detail: "Exceeded its 300s budget and was stopped."
    }
  ],
  note: "This score is not comparable to a complete scan. Semgrep did not finish."
} as const;

/**
 * Language × check table from toolRegistry + adapters.
 * A cell is the tool id(s) that actually apply. "—" means no dedicated tool.
 */
export const languageMatrix = [
  { check: "Leftovers / AI residue", js: "built-in", ts: "built-in", py: "built-in" },
  { check: "Dead code", js: "knip", ts: "knip", py: "vulture" },
  { check: "Types", js: "—", ts: "tsc", py: "pyright" },
  { check: "Lint", js: "biome", ts: "biome", py: "ruff" },
  { check: "Tests", js: "vitest / jest", ts: "vitest / jest", py: "coverage.py" },
  { check: "Dependencies", js: "knip", ts: "knip", py: "deptry" },
  { check: "Duplication", js: "jscpd", ts: "jscpd", py: "—" },
  { check: "Complexity", js: "lizard", ts: "lizard", py: "radon / lizard" },
  { check: "Secrets", js: "gitleaks", ts: "gitleaks", py: "gitleaks" },
  { check: "Known vulns", js: "osv-scanner", ts: "osv-scanner", py: "osv-scanner" },
  { check: "Security rules", js: "semgrep", ts: "semgrep", py: "semgrep" },
  { check: "Privacy signals", js: "privacy-detector", ts: "privacy-detector", py: "privacy-detector" },
  { check: "Optional PII analyzer", js: "presidio", ts: "presidio", py: "presidio" },
  { check: "Refactor size", js: "custom-refactor", ts: "custom-refactor", py: "custom-refactor" },
  { check: "Telemetry opt-out", js: "telemetry-detector", ts: "telemetry-detector", py: "—" },
  { check: "Flow contracts (V1)", js: "flow-doctor", ts: "flow-doctor", py: "flow-doctor" }
] as const;

export const orchestration = [
  {
    id: "01",
    title: "Detect repo",
    body: "Read the tree: language, lockfiles, configs. Decide which capabilities apply."
  },
  {
    id: "02",
    title: "Build shared context",
    body: "Index files, git delta, file roles, and the tool runtime. Later graphs attach here."
  },
  {
    id: "03",
    title: "Run applicable engines",
    body: "Native detectors plus engines such as Ruff or Semgrep. Irrelevant tools are NOT_APPLICABLE, not failures."
  },
  {
    id: "04",
    title: "Analyze flows",
    body: "Flow Doctor binds routes to handlers and flags missing wiring plus high-confidence unreachable handlers. Dynamic paths stay heuristic."
  },
  {
    id: "05",
    title: "Correlate evidence",
    body: "Overlapping scanner output becomes one diagnosis, not five unrelated warnings."
  },
  {
    id: "06",
    title: "Rank root causes",
    body: "Real bugs and secrets outrank unused-import noise. Completeness stays a first-class result."
  },
  {
    id: "07",
    title: "Produce the report",
    body: "A prioritized report a human or coding agent can act on immediately."
  }
] as const;

export const agentSteps = [
  {
    id: "01",
    title: "Read completeness",
    body: "If the scan is PARTIAL or INVALID, recover tools before treating the score as authoritative."
  },
  {
    id: "02",
    title: "Fix the top-ranked issue",
    body: "Use topIssues[0]: location, likely root cause, repair, and verification guidance."
  },
  {
    id: "03",
    title: "Preserve unrelated changes",
    body: "Do not rewrite files the finding does not name."
  },
  {
    id: "04",
    title: "Verify",
    body: "Re-run the named tests and `vibedoctor scan --changed --report agent-json`."
  },
  {
    id: "05",
    title: "Continue",
    body: "Take the next recommended issue. Never claim success from incomplete evidence."
  }
] as const;

export const artifacts = [
  { path: ".vibedoctor/report.json", use: "Automation and agents." },
  { path: ".vibedoctor/report.html", use: "Human review." },
  { path: ".vibedoctor/agent-plan.md", use: "Ordered repair work." }
] as const;

export const nav = [
  { href: "/how-it-works/", label: "How it works" },
  { href: "/agents/", label: "Agents" },
  { href: "/privacy/", label: "Privacy" },
  { href: "/articles/", label: "Articles" }
] as const;
