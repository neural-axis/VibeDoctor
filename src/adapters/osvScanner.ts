import type { ToolAdapter } from "./shared";

type OsvPackage = { name?: string };
type OsvFinding = {
  package?: OsvPackage;
  id?: string;
  summary?: string;
  severity?: Array<{ score?: string }>;
};

type OsvResult = {
  results?: Array<{
    packages?: Array<{
      package?: OsvPackage;
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
          package: vulnerability.package ?? pkg.package
        });
      }
    }
  }
  return findings;
}

function severityFromCvss(item: OsvFinding): "low" | "medium" | "high" | "critical" {
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
      cmd: "osv-scanner",
      args: ["scan", "--lockfile=auto", "--format=json", "."],
      cwd: ctx.root,
      timeoutMs: 60_000
    };
  },
  parseResult(result) {
    return parseOsv(result.stdout).map((item, index) => ({
      id: `osv:${item.package?.name}:${item.id ?? index}`,
      source: "osv-scanner",
      category: "dependencies",
      severity: severityFromCvss(item),
      confidence: "high",
      title: item.id ?? "Dependency vulnerability",
      message: `${item.package?.name ?? "Dependency"}: ${item.summary ?? "Known vulnerability detected."}`,
      isNew: true,
      isAutofixable: false,
      safeToAutofix: false,
      agentInstruction: "Upgrade or replace the affected dependency after checking compatibility and changelog risk.",
      tags: ["dependencies", "security"],
      scoreImpact: 0
    }));
  },
  installHint: "Install OSV-Scanner from https://google.github.io/osv-scanner/"
};
