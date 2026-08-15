import type { Finding, PackageReference } from "../core/finding";
import type { ToolAdapter, ToolAdapterContext } from "./shared";

type OsvPackage = { name?: string; version?: string; ecosystem?: string };

type OsvAffectedRange = {
  type?: string;
  events?: Array<{ introduced?: string; fixed?: string }>;
};

type OsvFinding = {
  package?: OsvPackage;
  id?: string;
  summary?: string;
  severity?: Array<{ score?: string }>;
  database_specific?: { severity?: string };
  affected?: Array<{ package?: OsvPackage; ranges?: OsvAffectedRange[] }>;
  /** Source manifest the dependency was read from, carried down from the result. */
  sourcePath?: string;
  /** Dependency chain from a direct dependency, when the scanner reports one. */
  dependencyGroups?: string[];
};

type OsvResult = {
  results?: Array<{
    source?: { path?: string; type?: string };
    packages?: Array<{
      package?: OsvPackage;
      dependency_groups?: string[];
      vulnerabilities?: OsvFinding[];
    }>;
  }>;
};

function parseOsv(stdout: string): OsvFinding[] {
  const trimmed = stdout.trim();
  if (!trimmed) {
    return [];
  }

  const parsed = JSON.parse(trimmed) as OsvResult;
  const findings: OsvFinding[] = [];
  for (const result of parsed.results ?? []) {
    for (const pkg of result.packages ?? []) {
      for (const vulnerability of pkg.vulnerabilities ?? []) {
        findings.push({
          ...vulnerability,
          package: vulnerability.package ?? pkg.package,
          sourcePath: result.source?.path,
          dependencyGroups: pkg.dependency_groups
        });
      }
    }
  }
  return findings;
}

/** First version that fixes the advisory, read from the affected-range events. */
function firstFixedVersion(item: OsvFinding): string | undefined {
  for (const affected of item.affected ?? []) {
    for (const range of affected.ranges ?? []) {
      const fixed = range.events?.find((event) => event.fixed)?.fixed;
      if (fixed) {
        return fixed;
      }
    }
  }
  return undefined;
}

/**
 * Determines whether the vulnerable package ships to production.
 *
 * A remote-code-execution advisory in a dev server and one in a PDF renderer that
 * runs on user input are not comparable risks, and a report that lists both as
 * "critical dependency vulnerability" makes them look identical. OSV reports
 * dependency groups where the ecosystem supports it; otherwise the project's own
 * manifest is the authority.
 */
function resolveScope(item: OsvFinding, ctx: ToolAdapterContext): PackageReference["scope"] {
  const groups = item.dependencyGroups?.map((group) => group.toLowerCase()) ?? [];
  if (groups.includes("dev") || groups.includes("development")) {
    return "dev";
  }
  if (groups.includes("optional")) {
    return "optional";
  }
  if (groups.length > 0) {
    return "runtime";
  }

  const name = item.package?.name;
  if (!name) {
    return "unknown";
  }

  const manifest = ctx.project.declaredDependencies;
  if (!manifest) {
    return "unknown";
  }

  // Ecosystems disagree on case normalization (PyPI names are case-insensitive),
  // so compare case-insensitively rather than missing a match on capitalization.
  const needle = name.toLowerCase();
  const has = (names: string[]) => names.some((candidate) => candidate.toLowerCase() === needle);

  if (has(manifest.runtime)) {
    return "runtime";
  }
  if (has(manifest.dev)) {
    return "dev";
  }
  if (has(manifest.optional)) {
    return "optional";
  }

  // Present in the lockfile but in no manifest section: it arrived through
  // another package.
  return "transitive";
}

function severityFromCvss(item: OsvFinding): "low" | "medium" | "high" | "critical" {
  const namedSeverity = item.database_specific?.severity?.toLowerCase();
  if (namedSeverity === "critical" || namedSeverity === "high" || namedSeverity === "medium" || namedSeverity === "low") {
    return namedSeverity;
  }
  const score = Number(item.severity?.[0]?.score ?? 0);
  if (score >= 9) {
    return "critical";
  }
  if (score >= 7) {
    return "high";
  }
  if (score >= 4) {
    return "medium";
  }
  return "low";
}

export const osvScannerAdapter: ToolAdapter = {
  id: "osv-scanner",
  category: "dependencies",
  async detect(project) {
    return project.lockfiles.length > 0;
  },
  buildScanCommand(ctx) {
    return {
      tool: "osv-scanner",
      cmd: "osv-scanner",
      args: [
        "scan",
        "source",
        ...ctx.project.lockfiles.flatMap((lockfile) => ["--lockfile", lockfile]),
        "--format",
        "json",
        "--verbosity",
        "error"
      ],
      cwd: ctx.root,
      timeoutMs: 60_000,
      runtime: ctx.toolRuntime
    };
  },
  parseResult(result, ctx) {
    return parseOsv(result.stdout).map((item, index) => {
      const name = item.package?.name ?? "unknown";
      const version = item.package?.version;
      const scope = resolveScope(item, ctx);
      const fixedIn = firstFixedVersion(item);
      const baseSeverity = severityFromCvss(item);

      // A dev-only advisory is real but not shipped. Keeping it at the advisory's
      // raw severity is what made a build-tool notice indistinguishable from a
      // vulnerability in code that touches user input.
      const severity: Finding["severity"] =
        scope === "dev" || scope === "optional"
          ? baseSeverity === "critical"
            ? "medium"
            : baseSeverity === "high"
              ? "medium"
              : "low"
          : baseSeverity;

      const scopeLabel =
        scope === "dev"
          ? "development-only dependency"
          : scope === "optional"
            ? "optional dependency"
            : scope === "transitive"
              ? "transitive dependency"
              : scope === "runtime"
                ? "runtime dependency"
                : "dependency (scope undetermined)";

      return {
        id: `osv:${name}:${version ?? "unknown"}:${item.id ?? index}`,
        source: "osv-scanner",
        category: "dependencies",
        severity,
        confidence: "high",
        title: item.id ?? "Dependency vulnerability",
        message: [
          `${name}${version ? `@${version}` : ""} (${scopeLabel}):`,
          item.summary ?? "Known vulnerability detected.",
          fixedIn ? `Fixed in ${fixedIn}.` : "No fixed version is published yet."
        ].join(" "),
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: fixedIn
          ? `Upgrade ${name} to ${fixedIn} or later, then rerun tests.`
          : `No fix is available for ${name}; assess whether the vulnerable code path is reachable, or replace the dependency.`,
        tags: ["dependencies", "security", `scope:${scope}`],
        package: {
          name,
          version,
          ecosystem: item.package?.ecosystem,
          scope,
          fixedIn,
          manifest: item.sourcePath
        },
        remediation: {
          kind: "dependency",
          component: name,
          steps: fixedIn
            ? [`Upgrade ${name} from ${version ?? "the installed version"} to ${fixedIn} or later.`, "Run the test suite."]
            : [
                `Check whether the vulnerable code path in ${name} is reachable from this project.`,
                "If it is, pin to a safe version, patch, or replace the dependency."
              ],
          requiredEvidence: fixedIn ? `Lockfile showing ${name} at ${fixedIn} or later.` : "Reachability assessment for the advisory."
        },
        evidence: {
          toolRawId: item.id,
          reasons: [
            `Advisory severity: ${baseSeverity}.`,
            severity === baseSeverity
              ? `Reported at advisory severity because ${name} is a ${scopeLabel}.`
              : `Reduced from ${baseSeverity} to ${severity} because ${name} is a ${scopeLabel} and does not ship to production.`
          ]
        },
        scoreImpact: 0
      } satisfies Finding;
    });
  },
  installHint: "VibeDoctor provisions a pinned OSV-Scanner into ~/.cache/vibedoctor when needed. To use a project-local copy, put osv-scanner on PATH."
};
