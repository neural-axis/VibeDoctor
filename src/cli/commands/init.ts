import { promises as fs } from "node:fs";
import path from "node:path";
import { defaultConfig } from "../../core/config";
import { ensureDir } from "../../core/paths";
import { detectProject } from "../../core/projectDetector";

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

baseline:
  enabled: true
  file: .vibedoctor/baseline.json
  fail_only_on_new_issues: true

score:
  minimum: ${defaultConfig.score.minimum}

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

output:
  terminal: true
  json: .vibedoctor/report.json
  html: .vibedoctor/report.html
  agent: .vibedoctor/agent-plan.md
`;
}

export async function runInit(root: string): Promise<string> {
  const project = await detectProject(root);
  const configPath = path.join(root, "vibedoctor.yml");
  const baselineDir = path.join(root, ".vibedoctor");
  await ensureDir(baselineDir);
  await fs.writeFile(configPath, buildYaml(project.languages), "utf8");
  await fs.writeFile(path.join(baselineDir, "baseline.json"), JSON.stringify({ createdAt: new Date().toISOString(), findings: [] }, null, 2), "utf8");
  return configPath;
}
