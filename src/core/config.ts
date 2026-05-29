import { promises as fs } from "node:fs";
import path from "node:path";
import YAML from "yaml";
import { DEFAULT_EXCLUDES, pathExists } from "./paths";

export type VibeDoctorConfig = {
  version: number;
  profile: string;
  project: {
    type: string;
    languages: Array<"python" | "javascript" | "typescript">;
  };
  paths: {
    include: string[];
    exclude: string[];
  };
  baseline: {
    enabled: boolean;
    file: string;
    failOnlyOnNewIssues: boolean;
  };
  score: {
    minimum: number;
  };
  checks: {
    security: {
      enabled: boolean;
      failOnSecrets: boolean;
      failOnNewHighVulnerabilities: boolean;
    };
    correctness: {
      enabled: boolean;
      failOnTypeErrors: boolean;
      failOnTestFailures: boolean;
    };
    deadCode: {
      enabled: boolean;
      deleteAutomatically: boolean;
      minConfidenceToReport: "low" | "medium" | "high";
    };
    leftovers: {
      enabled: boolean;
      scanComments: boolean;
      scanCommentedCode: boolean;
      scanLegacyFallbacks: boolean;
      deleteAutomatically: boolean;
    };
    refactorReadiness: {
      enabled: boolean;
      minFileLines: number;
      minComplexity: number;
      requireTestsBeforeRefactor: boolean;
    };
    tests: {
      enabled: boolean;
      minCoverage: number;
      minChangedCodeCoverage: number;
    };
    dependencies: {
      enabled: boolean;
      failOnMissingDependencies: boolean;
      failOnNewDirectVulnerabilities: boolean;
    };
  };
  output: {
    terminal: boolean;
    json: string;
    html: string;
    agent: string;
  };
};

export const defaultConfig: VibeDoctorConfig = {
  version: 1,
  profile: "startup",
  project: {
    type: "app",
    languages: []
  },
  paths: {
    include: ["src/**", "app/**", "packages/**", "services/**", "tests/**", "*.{js,jsx,ts,tsx,py}", "**/*.{js,jsx,ts,tsx,py}"],
    exclude: DEFAULT_EXCLUDES
  },
  baseline: {
    enabled: true,
    file: ".vibedoctor/baseline.json",
    failOnlyOnNewIssues: true
  },
  score: {
    minimum: 80
  },
  checks: {
    security: {
      enabled: true,
      failOnSecrets: true,
      failOnNewHighVulnerabilities: true
    },
    correctness: {
      enabled: true,
      failOnTypeErrors: true,
      failOnTestFailures: true
    },
    deadCode: {
      enabled: true,
      deleteAutomatically: false,
      minConfidenceToReport: "medium"
    },
    leftovers: {
      enabled: true,
      scanComments: true,
      scanCommentedCode: true,
      scanLegacyFallbacks: true,
      deleteAutomatically: false
    },
    refactorReadiness: {
      enabled: true,
      minFileLines: 500,
      minComplexity: 15,
      requireTestsBeforeRefactor: true
    },
    tests: {
      enabled: true,
      minCoverage: 70,
      minChangedCodeCoverage: 80
    },
    dependencies: {
      enabled: true,
      failOnMissingDependencies: true,
      failOnNewDirectVulnerabilities: true
    }
  },
  output: {
    terminal: true,
    json: ".vibedoctor/report.json",
    html: ".vibedoctor/report.html",
    agent: ".vibedoctor/agent-plan.md"
  }
};

const CONFIG_FILES = ["vibedoctor.yml", "vibedoctor.yaml", "vibedoctor.json"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T>(base: T, override: Partial<T> | undefined): T {
  if (override === undefined) {
    return base;
  }

  if (Array.isArray(base)) {
    return (Array.isArray(override) ? override : base) as T;
  }

  if (!isRecord(base) || !isRecord(override)) {
    return override as T;
  }

  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = merged[key];
    merged[key] = isRecord(current) && isRecord(value) ? deepMerge(current, value) : value;
  }
  return merged as T;
}

export async function findConfigFile(root: string): Promise<string | undefined> {
  for (const fileName of CONFIG_FILES) {
    const candidate = path.join(root, fileName);
    if (await pathExists(candidate)) {
      return candidate;
    }
  }

  return undefined;
}

function normalizeRawConfig(raw: Partial<VibeDoctorConfig>): Partial<VibeDoctorConfig> {
  const { baseline: _baseline, checks: _checks, ...rest } = raw;
  const rawChecks = raw.checks as Record<string, unknown> | undefined;
  const rawBaseline = raw.baseline as Record<string, unknown> | undefined;
  const rawDeadCode = (rawChecks?.deadCode ?? rawChecks?.dead_code) as Record<string, unknown> | undefined;
  const rawLeftovers = rawChecks?.leftovers as Record<string, unknown> | undefined;
  const rawRefactor = (rawChecks?.refactorReadiness ?? rawChecks?.refactor_readiness) as Record<string, unknown> | undefined;
  const rawSecurity = rawChecks?.security as Record<string, unknown> | undefined;
  const rawCorrectness = rawChecks?.correctness as Record<string, unknown> | undefined;
  const rawTests = rawChecks?.tests as Record<string, unknown> | undefined;
  const rawDependencies = rawChecks?.dependencies as Record<string, unknown> | undefined;

  return {
    ...rest,
    ...(rawBaseline
      ? {
          baseline: {
            enabled: (rawBaseline.enabled as boolean | undefined) ?? defaultConfig.baseline.enabled,
            file: (rawBaseline.file as string | undefined) ?? defaultConfig.baseline.file,
            failOnlyOnNewIssues:
              (rawBaseline.failOnlyOnNewIssues as boolean | undefined) ??
              (rawBaseline.fail_only_on_new_issues as boolean | undefined) ??
              defaultConfig.baseline.failOnlyOnNewIssues
          }
        }
      : {}),
    ...(rawChecks
      ? {
          checks: {
            security: rawSecurity
              ? {
                  enabled: (rawSecurity.enabled as boolean | undefined) ?? defaultConfig.checks.security.enabled,
                  failOnSecrets:
                    (rawSecurity.failOnSecrets as boolean | undefined) ??
                    (rawSecurity.fail_on_secrets as boolean | undefined) ??
                    defaultConfig.checks.security.failOnSecrets,
                  failOnNewHighVulnerabilities:
                    (rawSecurity.failOnNewHighVulnerabilities as boolean | undefined) ??
                    (rawSecurity.fail_on_new_high_vulnerabilities as boolean | undefined) ??
                    defaultConfig.checks.security.failOnNewHighVulnerabilities
                }
              : defaultConfig.checks.security,
            correctness: rawCorrectness
              ? {
                  enabled: (rawCorrectness.enabled as boolean | undefined) ?? defaultConfig.checks.correctness.enabled,
                  failOnTypeErrors:
                    (rawCorrectness.failOnTypeErrors as boolean | undefined) ??
                    (rawCorrectness.fail_on_type_errors as boolean | undefined) ??
                    defaultConfig.checks.correctness.failOnTypeErrors,
                  failOnTestFailures:
                    (rawCorrectness.failOnTestFailures as boolean | undefined) ??
                    (rawCorrectness.fail_on_test_failures as boolean | undefined) ??
                    defaultConfig.checks.correctness.failOnTestFailures
                }
              : defaultConfig.checks.correctness,
            deadCode: rawDeadCode
              ? {
                  enabled: (rawDeadCode.enabled as boolean | undefined) ?? defaultConfig.checks.deadCode.enabled,
                  deleteAutomatically:
                    (rawDeadCode.deleteAutomatically as boolean | undefined) ??
                    (rawDeadCode.delete_automatically as boolean | undefined) ??
                    defaultConfig.checks.deadCode.deleteAutomatically,
                  minConfidenceToReport:
                    (rawDeadCode.minConfidenceToReport as "low" | "medium" | "high" | undefined) ??
                    (rawDeadCode.min_confidence_to_report as "low" | "medium" | "high" | undefined) ??
                    defaultConfig.checks.deadCode.minConfidenceToReport
                }
              : defaultConfig.checks.deadCode,
            leftovers: rawLeftovers
              ? {
                  enabled: (rawLeftovers.enabled as boolean | undefined) ?? defaultConfig.checks.leftovers.enabled,
                  scanComments:
                    (rawLeftovers.scanComments as boolean | undefined) ??
                    (rawLeftovers.scan_comments as boolean | undefined) ??
                    defaultConfig.checks.leftovers.scanComments,
                  scanCommentedCode:
                    (rawLeftovers.scanCommentedCode as boolean | undefined) ??
                    (rawLeftovers.scan_commented_code as boolean | undefined) ??
                    defaultConfig.checks.leftovers.scanCommentedCode,
                  scanLegacyFallbacks:
                    (rawLeftovers.scanLegacyFallbacks as boolean | undefined) ??
                    (rawLeftovers.scan_legacy_fallbacks as boolean | undefined) ??
                    defaultConfig.checks.leftovers.scanLegacyFallbacks,
                  deleteAutomatically:
                    (rawLeftovers.deleteAutomatically as boolean | undefined) ??
                    (rawLeftovers.delete_automatically as boolean | undefined) ??
                    defaultConfig.checks.leftovers.deleteAutomatically
                }
              : defaultConfig.checks.leftovers,
            refactorReadiness: rawRefactor
              ? {
                  enabled: (rawRefactor.enabled as boolean | undefined) ?? defaultConfig.checks.refactorReadiness.enabled,
                  minFileLines:
                    (rawRefactor.minFileLines as number | undefined) ??
                    (rawRefactor.min_file_lines as number | undefined) ??
                    defaultConfig.checks.refactorReadiness.minFileLines,
                  minComplexity:
                    (rawRefactor.minComplexity as number | undefined) ??
                    (rawRefactor.min_complexity as number | undefined) ??
                    defaultConfig.checks.refactorReadiness.minComplexity,
                  requireTestsBeforeRefactor:
                    (rawRefactor.requireTestsBeforeRefactor as boolean | undefined) ??
                    (rawRefactor.require_tests_before_refactor as boolean | undefined) ??
                    defaultConfig.checks.refactorReadiness.requireTestsBeforeRefactor
                }
              : defaultConfig.checks.refactorReadiness,
            tests: rawTests
              ? {
                  enabled: (rawTests.enabled as boolean | undefined) ?? defaultConfig.checks.tests.enabled,
                  minCoverage:
                    (rawTests.minCoverage as number | undefined) ??
                    (rawTests.min_coverage as number | undefined) ??
                    defaultConfig.checks.tests.minCoverage,
                  minChangedCodeCoverage:
                    (rawTests.minChangedCodeCoverage as number | undefined) ??
                    (rawTests.min_changed_code_coverage as number | undefined) ??
                    defaultConfig.checks.tests.minChangedCodeCoverage
                }
              : defaultConfig.checks.tests,
            dependencies: rawDependencies
              ? {
                  enabled: (rawDependencies.enabled as boolean | undefined) ?? defaultConfig.checks.dependencies.enabled,
                  failOnMissingDependencies:
                    (rawDependencies.failOnMissingDependencies as boolean | undefined) ??
                    (rawDependencies.fail_on_missing_dependencies as boolean | undefined) ??
                    defaultConfig.checks.dependencies.failOnMissingDependencies,
                  failOnNewDirectVulnerabilities:
                    (rawDependencies.failOnNewDirectVulnerabilities as boolean | undefined) ??
                    (rawDependencies.fail_on_new_direct_vulnerabilities as boolean | undefined) ??
                    defaultConfig.checks.dependencies.failOnNewDirectVulnerabilities
                }
              : defaultConfig.checks.dependencies
          }
        }
      : {})
  };
}

export async function loadConfig(root: string): Promise<{ config: VibeDoctorConfig; configPath?: string }> {
  const configPath = await findConfigFile(root);
  if (!configPath) {
    return { config: defaultConfig };
  }

  const content = await fs.readFile(configPath, "utf8");
  const parsed = configPath.endsWith(".json") ? JSON.parse(content) : YAML.parse(content);
  const config = deepMerge(defaultConfig, normalizeRawConfig(parsed as Partial<VibeDoctorConfig>));
  return { config, configPath };
}
