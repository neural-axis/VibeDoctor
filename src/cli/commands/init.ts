import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultConfig } from "../../core/config";
import { ensureDir, pathExists } from "../../core/paths";
import { detectProject } from "../../core/projectDetector";
import { SUPPRESSIONS_TEMPLATE } from "../../core/suppressions";

function buildYaml(detectedLanguages: string[]): string {
  const languagesBlock =
    detectedLanguages.length > 0
      ? `  languages:\n${detectedLanguages.map((language) => `    - ${language}`).join("\n")}`
      : "  languages: []";

  return `version: ${defaultConfig.version}

profile: ${defaultConfig.profile}

project:
  type: ${defaultConfig.project.type}
${languagesBlock}

paths:
  include:
    - src/**
    - app/**
    - packages/**
    - services/**
  exclude:
    - node_modules/**
    - dist/**
    - build/**
    - .venv/**
    - coverage/**
    - .next/**
    - vendor/**
    - .agents/**
    - test/**
    - tests/**
    - "**/test/**"
    - "**/tests/**"
    - "**/*.test.*"
    - "**/*.spec.*"
    - "**/__tests__/**"

baseline:
  enabled: true
  file: .vibedoctor/baseline.json
  fail_only_on_new_issues: true

score:
  minimum: ${defaultConfig.score.minimum}

runtime:
  default_timeout_seconds: ${defaultConfig.runtime.defaultTimeoutSeconds}
  # Per-tool time budgets. A tool that exceeds its budget is reported as timed
  # out, never as passing.
  tool_timeouts:
    biome: ${defaultConfig.runtime.toolTimeouts.biome}
    semgrep: ${defaultConfig.runtime.toolTimeouts.semgrep}
  required_tools: []
  fail_on_incomplete_scan: false
  # Wall-clock ceiling for the whole scan; 0 means no ceiling.
  total_budget_seconds: ${defaultConfig.runtime.totalBudgetSeconds}
  # On timeout: scoped_retry reruns the tool over changed files only and reports
  # the partial coverage. Alternatives: skip, fail.
  on_timeout: ${defaultConfig.runtime.onTimeout}
  scoped_retry_timeout_seconds: ${defaultConfig.runtime.scopedRetryTimeoutSeconds}
  # Tools deliberately not run. The report says they were deferred rather than
  # implying they passed — use this for tools this environment cannot support.
  deferred_tools: []
  verify_tools_before_scan: true

# Controls how much of what the tools report actually reaches the report.
# Nothing is dropped silently: every filter states what it withheld and why.
relevance:
  enabled: true
  min_confidence: ${defaultConfig.relevance.minConfidence}
  max_findings_per_tool: ${defaultConfig.relevance.maxFindingsPerTool}
  max_findings_total: ${defaultConfig.relevance.maxFindingsTotal}
  # Findings in tests, fixtures, generated, and vendored files: keep, downgrade,
  # or drop.
  synthetic_file_policy: ${defaultConfig.relevance.syntheticFilePolicy}
  # Check that findings claiming to be credentials look like credentials.
  validate_secrets: true
  per_tool:
    vulture:
      min_confidence: medium
      max_findings: 50
    pyright:
      max_findings: 150
    tsc:
      max_findings: 150
  # Correct a file-role misclassification without disabling the defaults.
  # file_roles:
  #   source: ["fixtures/real/**"]

# Acknowledged findings live in this file. Each entry needs a reason; an expiry
# date is strongly recommended, because a lapsed acknowledgement resurfaces its
# findings instead of hiding them forever.
suppressions:
  enabled: true
  file: ${defaultConfig.suppressions.file}
  # Turn this on to reject acknowledgements that have no expiry date: they are
  # listed as rejected in the report and hide nothing.
  require_expiry: false

checks:
  security:
    enabled: true
    fail_on_secrets: true
    fail_on_new_high_vulnerabilities: true

  correctness:
    enabled: true
    fail_on_type_errors: true
    fail_on_test_failures: true

  dead_code:
    enabled: true
    delete_automatically: false
    min_confidence_to_report: medium

  leftovers:
    enabled: true
    scan_comments: true
    scan_commented_code: true
    scan_legacy_fallbacks: true
    delete_automatically: false

  refactor_readiness:
    enabled: true
    min_file_lines: 500
    min_complexity: 15
    require_tests_before_refactor: true

  tests:
    enabled: true
    min_coverage: 70
    min_changed_code_coverage: 80

  dependencies:
    enabled: true
    fail_on_missing_dependencies: true
    fail_on_new_direct_vulnerabilities: true

  privacy:
    enabled: true
    min_confidence_to_report: medium
    mask_examples: true
    max_file_bytes: 1048576
    fail_on_regulated_identifiers: false
    fail_on_sensitive_attributes: false
    ai:
      enabled: false
      api_key_env: VIBEDOCTOR_AI_API_KEY
      base_url_env: VIBEDOCTOR_AI_BASE_URL
      model_env: VIBEDOCTOR_AI_MODEL
      include_raw_values: false
    presidio:
      enabled: false

output:
  terminal: true
  json: .vibedoctor/report.json
  html: .vibedoctor/report.html
  agent: .vibedoctor/agent-plan.md
  privacy_review: .vibedoctor/privacy-review.json
`;
}

export async function runInit(root: string): Promise<string> {
  const project = await detectProject(root);
  const configPath = path.join(root, "vibedoctor.yml");
  const baselineDir = path.join(root, ".vibedoctor");
  await ensureDir(baselineDir);
  await fs.writeFile(configPath, buildYaml(project.languages), "utf8");
  await fs.writeFile(path.join(baselineDir, "baseline.json"), JSON.stringify({ createdAt: new Date().toISOString(), findings: [] }, null, 2), "utf8");

  // Scaffold the acknowledgements file with its rules explained, so the first
  // person who needs to suppress a false positive finds the format waiting for
  // them instead of inventing one. Never overwrite an existing file.
  const suppressionsPath = path.join(root, defaultConfig.suppressions.file);
  if (!(await pathExists(suppressionsPath))) {
    await ensureDir(path.dirname(suppressionsPath));
    await fs.writeFile(suppressionsPath, SUPPRESSIONS_TEMPLATE, "utf8");
  }

  return configPath;
}
