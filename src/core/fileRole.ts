import { Minimatch } from "minimatch";

/**
 * Classifies what a file is for.
 *
 * Relevance decisions kept being made per tool: one detector learned to ignore
 * fixtures, another flagged them as critical. A secret in a test fixture, a dead
 * function in a generated client, and a type error in production code are not
 * the same finding, and every tool needs the same answer to that question.
 */

export type FileRole = "source" | "test" | "fixture" | "generated" | "vendor" | "config" | "docs" | "unknown";

const DEFAULT_ROLE_PATTERNS: Array<{ role: FileRole; patterns: string[] }> = [
  {
    role: "fixture",
    patterns: [
      "**/fixtures/**",
      "**/fixture/**",
      "**/__fixtures__/**",
      "**/testdata/**",
      "**/test-data/**",
      "**/mocks/**",
      "**/__mocks__/**",
      "**/samples/**",
      "**/examples/**",
      "**/seeds/**",
      "**/*.fixture.*",
      "**/*.mock.*"
    ]
  },
  {
    role: "test",
    patterns: [
      "**/test/**",
      "**/tests/**",
      "**/__tests__/**",
      "**/spec/**",
      "**/*.test.*",
      "**/*.spec.*",
      "**/*_test.py",
      "**/test_*.py",
      "**/conftest.py",
      "**/e2e/**"
    ]
  },
  {
    role: "generated",
    patterns: [
      "**/*.generated.*",
      "**/*.gen.*",
      "**/generated/**",
      "**/__generated__/**",
      "**/*_pb2.py",
      "**/*_pb2_grpc.py",
      "**/*.pb.go",
      "**/migrations/**",
      "**/.next/**",
      "**/dist/**",
      "**/build/**",
      "**/*.min.js",
      "**/*.d.ts",
      "**/*.snap"
    ]
  },
  {
    role: "vendor",
    patterns: ["**/vendor/**", "**/node_modules/**", "**/third_party/**", "**/site-packages/**", "**/.venv/**"]
  },
  {
    role: "config",
    patterns: [
      "*.json",
      "*.yml",
      "*.yaml",
      "*.toml",
      "*.ini",
      "*.cfg",
      "**/.*rc",
      "**/.*rc.*",
      "**/*.config.*",
      "**/Dockerfile*",
      "**/*.env.example",
      "**/.github/**"
    ]
  },
  {
    role: "docs",
    patterns: ["**/*.md", "**/*.mdx", "**/*.rst", "**/*.txt", "**/docs/**", "**/LICENSE*", "**/CHANGELOG*"]
  }
];

export type FileRoleClassifier = (file: string | undefined) => FileRole;

export type FileRoleOverrides = Partial<Record<FileRole, string[]>>;

/**
 * Builds a classifier. Repository-specific globs are checked before the defaults
 * so a project can correct a misclassification without disabling the rest.
 */
export function createFileRoleClassifier(overrides: FileRoleOverrides = {}): FileRoleClassifier {
  const compiled: Array<{ role: FileRole; matchers: Minimatch[] }> = [];

  for (const [role, patterns] of Object.entries(overrides) as Array<[FileRole, string[] | undefined]>) {
    if (patterns && patterns.length > 0) {
      compiled.push({ role, matchers: patterns.map((pattern) => new Minimatch(pattern, { dot: true })) });
    }
  }

  for (const { role, patterns } of DEFAULT_ROLE_PATTERNS) {
    compiled.push({ role, matchers: patterns.map((pattern) => new Minimatch(pattern, { dot: true })) });
  }

  const cache = new Map<string, FileRole>();

  return (file) => {
    if (!file) {
      return "unknown";
    }

    const cached = cache.get(file);
    if (cached) {
      return cached;
    }

    const normalized = file.split("\\").join("/");
    const role = compiled.find(({ matchers }) => matchers.some((matcher) => matcher.match(normalized)))?.role ?? "source";
    cache.set(file, role);
    return role;
  };
}

/** Roles where a finding is usually about the repository's real behaviour. */
export function isProductionRole(role: FileRole): boolean {
  return role === "source" || role === "config";
}

/**
 * Roles where a "secret", a dead function, or a hardcoded personal identifier is
 * expected by design. Findings here are still reported, at reduced severity, so
 * a real leak in a fixture is not hidden outright.
 */
export function isSyntheticRole(role: FileRole): boolean {
  return role === "fixture" || role === "test" || role === "generated" || role === "vendor";
}
