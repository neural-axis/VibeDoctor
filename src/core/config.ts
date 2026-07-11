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
  runtime: {
    defaultTimeoutSeconds: number;
    toolTimeouts: Record<string, number>;
    requiredTools: string[];
    failOnIncompleteScan: boolean;
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
    privacy: {
      enabled: boolean;
      minConfidenceToReport: "low" | "medium" | "high";
      maskExamples: boolean;
      maxFileBytes: number;
      failOnRegulatedIdentifiers: boolean;
      failOnSensitiveAttributes: boolean;
      detectTelemetryOptOut: boolean;
      detectUnsanitizedLogs: boolean;
      detectApiOverfetching: boolean;
      detectMissingRetention: boolean;
      ai: {
        enabled: boolean;
        apiKeyEnv: string;
        baseUrlEnv: string;
        modelEnv: string;
        includeRawValues: boolean;
      };
      presidio: {
        enabled: boolean;
      };
    };
  };
  output: {
    terminal: boolean;
    json: string;
    html: string;
    agent: string;
    privacyReview: string;
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
    include: [
      "src/**",
      "app/**",
      "packages/**",
      "services/**",
      "tests/**",
      "*.{js,jsx,ts,tsx,py}",
      "**/*.{js,jsx,ts,tsx,py}",
      "*.prisma",
      "**/*.prisma"
    ],
    exclude: [
      ...DEFAULT_EXCLUDES,
      "test/**",
      "tests/**",
      "**/test/**",
      "**/tests/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/__tests__/**"
    ]
  },
  baseline: {
    enabled: true,
    file: ".vibedoctor/baseline.json",
    failOnlyOnNewIssues: true
  },
  score: {
    minimum: 80
  },
  runtime: {
    defaultTimeoutSeconds: 120,
    toolTimeouts: {
      biome: 180,
      semgrep: 300
    },
    requiredTools: [],
    failOnIncompleteScan: false
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
    },
    privacy: {
      enabled: true,
      minConfidenceToReport: "medium",
      maskExamples: true,
      maxFileBytes: 1_048_576,
      failOnRegulatedIdentifiers: false,
      failOnSensitiveAttributes: false,
      detectTelemetryOptOut: true,
      detectUnsanitizedLogs: true,
      detectApiOverfetching: true,
      detectMissingRetention: true,
      ai: {
        enabled: false,
        apiKeyEnv: "VIBEDOCTOR_AI_API_KEY",
        baseUrlEnv: "VIBEDOCTOR_AI_BASE_URL",
        modelEnv: "VIBEDOCTOR_AI_MODEL",
        includeRawValues: false
      },
      presidio: {
        enabled: false
      }
    }
  },
  output: {
    terminal: true,
    json: ".vibedoctor/report.json",
    html: ".vibedoctor/report.html",
    agent: ".vibedoctor/agent-plan.md",
    privacyReview: ".vibedoctor/privacy-review.json"
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
  const { baseline: _baseline, checks: _checks, output: _output, runtime: _runtime, ...rest } = raw;
  const rawChecks = raw.checks as Record<string, unknown> | undefined;
  const rawBaseline = raw.baseline as Record<string, unknown> | undefined;
  const rawOutput = raw.output as Record<string, unknown> | undefined;
  const rawRuntime = raw.runtime as Record<string, unknown> | undefined;
  const rawDeadCode = (rawChecks?.deadCode ?? rawChecks?.dead_code) as Record<string, unknown> | undefined;
  const rawLeftovers = rawChecks?.leftovers as Record<string, unknown> | undefined;
  const rawRefactor = (rawChecks?.refactorReadiness ?? rawChecks?.refactor_readiness) as Record<string, unknown> | undefined;
  const rawSecurity = rawChecks?.security as Record<string, unknown> | undefined;
  const rawCorrectness = rawChecks?.correctness as Record<string, unknown> | undefined;
  const rawTests = rawChecks?.tests as Record<string, unknown> | undefined;
  const rawDependencies = rawChecks?.dependencies as Record<string, unknown> | undefined;
  const rawPrivacy = rawChecks?.privacy as Record<string, unknown> | undefined;
  const rawPrivacyAi = (rawPrivacy?.ai ?? {}) as Record<string, unknown>;
  const rawPresidio = (rawPrivacy?.presidio ?? {}) as Record<string, unknown>;

  return {
    ...rest,
    ...(rawRuntime
      ? {
          runtime: {
            defaultTimeoutSeconds:
              (rawRuntime.defaultTimeoutSeconds as number | undefined) ??
              (rawRuntime.default_timeout_seconds as number | undefined) ??
              defaultConfig.runtime.defaultTimeoutSeconds,
            toolTimeouts:
              (rawRuntime.toolTimeouts as Record<string, number> | undefined) ??
              (rawRuntime.tool_timeouts as Record<string, number> | undefined) ??
              defaultConfig.runtime.toolTimeouts,
            requiredTools:
              (rawRuntime.requiredTools as string[] | undefined) ??
              (rawRuntime.required_tools as string[] | undefined) ??
              defaultConfig.runtime.requiredTools,
            failOnIncompleteScan:
              (rawRuntime.failOnIncompleteScan as boolean | undefined) ??
              (rawRuntime.fail_on_incomplete_scan as boolean | undefined) ??
              defaultConfig.runtime.failOnIncompleteScan
          }
        }
      : {}),
    ...(rawOutput
      ? {
          output: {
            terminal: (rawOutput.terminal as boolean | undefined) ?? defaultConfig.output.terminal,
            json: (rawOutput.json as string | undefined) ?? defaultConfig.output.json,
            html: (rawOutput.html as string | undefined) ?? defaultConfig.output.html,
            agent: (rawOutput.agent as string | undefined) ?? defaultConfig.output.agent,
            privacyReview:
              (rawOutput.privacyReview as string | undefined) ??
              (rawOutput.privacy_review as string | undefined) ??
              defaultConfig.output.privacyReview
          }
        }
      : {}),
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
              : defaultConfig.checks.dependencies,
            privacy: rawPrivacy
              ? {
                  enabled: (rawPrivacy.enabled as boolean | undefined) ?? defaultConfig.checks.privacy.enabled,
                  minConfidenceToReport:
                    (rawPrivacy.minConfidenceToReport as "low" | "medium" | "high" | undefined) ??
                    (rawPrivacy.min_confidence_to_report as "low" | "medium" | "high" | undefined) ??
                    defaultConfig.checks.privacy.minConfidenceToReport,
                  maskExamples:
                    (rawPrivacy.maskExamples as boolean | undefined) ??
                    (rawPrivacy.mask_examples as boolean | undefined) ??
                    defaultConfig.checks.privacy.maskExamples,
                  maxFileBytes:
                    (rawPrivacy.maxFileBytes as number | undefined) ??
                    (rawPrivacy.max_file_bytes as number | undefined) ??
                    defaultConfig.checks.privacy.maxFileBytes,
                  failOnRegulatedIdentifiers:
                    (rawPrivacy.failOnRegulatedIdentifiers as boolean | undefined) ??
                    (rawPrivacy.fail_on_regulated_identifiers as boolean | undefined) ??
                    defaultConfig.checks.privacy.failOnRegulatedIdentifiers,
                  failOnSensitiveAttributes:
                    (rawPrivacy.failOnSensitiveAttributes as boolean | undefined) ??
                    (rawPrivacy.fail_on_sensitive_attributes as boolean | undefined) ??
                    defaultConfig.checks.privacy.failOnSensitiveAttributes,
                  detectTelemetryOptOut:
                    (rawPrivacy.detectTelemetryOptOut as boolean | undefined) ??
                    (rawPrivacy.detect_telemetry_opt_out as boolean | undefined) ??
                    defaultConfig.checks.privacy.detectTelemetryOptOut,
                  detectUnsanitizedLogs:
                    (rawPrivacy.detectUnsanitizedLogs as boolean | undefined) ??
                    (rawPrivacy.detect_unsanitized_logs as boolean | undefined) ??
                    defaultConfig.checks.privacy.detectUnsanitizedLogs,
                  detectApiOverfetching:
                    (rawPrivacy.detectApiOverfetching as boolean | undefined) ??
                    (rawPrivacy.detect_api_overfetching as boolean | undefined) ??
                    defaultConfig.checks.privacy.detectApiOverfetching,
                  detectMissingRetention:
                    (rawPrivacy.detectMissingRetention as boolean | undefined) ??
                    (rawPrivacy.detect_missing_retention as boolean | undefined) ??
                    defaultConfig.checks.privacy.detectMissingRetention,
                  ai: {
                    enabled: (rawPrivacyAi.enabled as boolean | undefined) ?? defaultConfig.checks.privacy.ai.enabled,
                    apiKeyEnv:
                      (rawPrivacyAi.apiKeyEnv as string | undefined) ??
                      (rawPrivacyAi.api_key_env as string | undefined) ??
                      defaultConfig.checks.privacy.ai.apiKeyEnv,
                    baseUrlEnv:
                      (rawPrivacyAi.baseUrlEnv as string | undefined) ??
                      (rawPrivacyAi.base_url_env as string | undefined) ??
                      defaultConfig.checks.privacy.ai.baseUrlEnv,
                    modelEnv:
                      (rawPrivacyAi.modelEnv as string | undefined) ??
                      (rawPrivacyAi.model_env as string | undefined) ??
                      defaultConfig.checks.privacy.ai.modelEnv,
                    includeRawValues:
                      (rawPrivacyAi.includeRawValues as boolean | undefined) ??
                      (rawPrivacyAi.include_raw_values as boolean | undefined) ??
                      defaultConfig.checks.privacy.ai.includeRawValues
                  },
                  presidio: {
                    enabled: (rawPresidio.enabled as boolean | undefined) ?? defaultConfig.checks.privacy.presidio.enabled
                  }
                }
              : defaultConfig.checks.privacy
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
