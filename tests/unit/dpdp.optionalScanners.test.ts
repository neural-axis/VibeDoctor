import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { presidioAdapter } from "../../src/adapters/presidio";
import { semgrepAdapter } from "../../src/adapters/semgrep";
import type { ToolAdapterContext } from "../../src/adapters/shared";
import { defaultConfig } from "../../src/core/config";
import type { Finding } from "../../src/core/finding";
import { collectOptionalScannerSignals } from "../../src/dpdp/collectors/optionalScanners";
import { loadCachedDpdpScanResult } from "../../src/dpdp/artifacts";
import { runScan } from "../../src/core/engine";

function finding(source: "presidio" | "semgrep", file: string): Finding {
  return {
    id: `${source}:${file}:1:test`,
    source,
    category: source === "presidio" ? "privacy" : "security",
    severity: "medium",
    confidence: "high",
    title: "PII token in log",
    message: "Potential personal data in a logger call",
    file,
    startLine: 1,
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    tags: [source === "presidio" ? "privacy" : "security", "pii", "log"],
    evidence: { entityType: "email", detectionPath: source, matchedPattern: "email" },
    scoreImpact: 0
  };
}

function context(): ToolAdapterContext {
  const config = structuredClone(defaultConfig);
  config.checks.dpdp.usePresidio = true;
  config.checks.dpdp.useSemgrep = true;
  return {
    root: "/tmp/dpdp-optional",
    config,
    scanMode: "full",
    project: {
      root: "/tmp/dpdp-optional",
      languages: ["typescript"],
      packageManagers: ["npm"],
      hasGit: true,
      changedFiles: [],
      configFiles: [],
      lockfiles: [],
      testCommands: [],
      toolsAvailable: {},
      frameworkHints: [],
      entryFiles: [],
      projectFiles: ["src/a.ts", "src/b.ts"]
    }
  };
}

describe("DPDP optional scanner orchestration", () => {
  it("keeps normal privacy and DPDP Presidio opt-outs independent", async () => {
    const ctx = context();
    ctx.config.checks.privacy.presidio.enabled = false;
    ctx.config.checks.dpdp.usePresidio = true;
    expect(await presidioAdapter.detect(ctx.project, ctx.config)).toBe(false);

    ctx.config.checks.privacy.presidio.enabled = true;
    ctx.config.checks.dpdp.usePresidio = false;
    expect(await presidioAdapter.detect(ctx.project, ctx.config)).toBe(true);

    ctx.config.checks.dpdp.useSemgrep = false;
    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"]);
    expect(result.capabilities.find((item) => item.id === "presidio")?.message).toContain("Opted out");
  });

  it("reuses completed scanner results and limits them to DPDP candidates", async () => {
    const ctx = context();
    ctx.config.checks.dpdp.usePresidio = false;
    ctx.sharedToolResults = {
      semgrep: {
        findings: [finding("semgrep", "src/a.ts"), finding("semgrep", "src/b.ts")]
      }
    };

    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"]);
    expect(result.findings.map((item) => item.file)).toEqual(["src/a.ts"]);
    expect(result.signals.every((item) => item.file === "src/a.ts")).toBe(true);
    expect(result.capabilities.find((item) => item.id === "semgrep")?.message).toContain("Reused semgrep scan");
  });

  it("retries a scanner the main scan skipped for a configuration reason", async () => {
    const ctx = context();
    ctx.config.checks.dpdp.usePresidio = false;
    // The main scan skipped Semgrep because its category was turned off, not
    // because Semgrep is missing. Inheriting that skip reported an available
    // scanner as unavailable for DPDP, with no way to tell the cases apart.
    ctx.sharedToolResults = {
      semgrep: {
        findings: [],
        status: {
          command: "semgrep",
          stdout: "",
          stderr: "",
          exitCode: null,
          durationMs: 0,
          status: "skipped"
        }
      }
    };

    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"]);
    const semgrep = result.capabilities.find((item) => item.id === "semgrep");
    expect(semgrep?.message).not.toContain("Reused semgrep scan");
    expect(semgrep?.cause).toBeDefined();
  });

  it("keeps inheriting a skip when the tool is genuinely absent", async () => {
    const ctx = context();
    ctx.config.checks.dpdp.usePresidio = false;
    ctx.sharedToolResults = {
      semgrep: {
        findings: [],
        status: {
          command: "semgrep",
          stdout: "",
          stderr: "",
          exitCode: null,
          durationMs: 0,
          status: "skipped",
          // An install hint means the tool was not found; rerunning it under a
          // different config cannot make it appear.
          installHint: "Install Semgrep with: pipx install semgrep"
        }
      }
    };

    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"]);
    const semgrep = result.capabilities.find((item) => item.id === "semgrep");
    expect(semgrep?.status).toBe("available");
    expect(semgrep?.message).toContain("Reused semgrep scan");
  });

  it("explains every skip with a cause and a remediation", async () => {
    const ctx = context();
    ctx.config.checks.dpdp.usePresidio = false;
    ctx.config.checks.dpdp.useSemgrep = false;

    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"]);
    for (const capability of result.capabilities) {
      expect(capability.cause).toBe("opted_out");
      expect(capability.remediation).toBeTruthy();
    }
  });

  it("never falls back to the whole project for an empty candidate scope", async () => {
    const ctx = context();
    ctx.sharedToolResults = {
      presidio: { findings: [finding("presidio", "src/a.ts")] },
      semgrep: { findings: [finding("semgrep", "src/a.ts")] }
    };

    const result = await collectOptionalScannerSignals(ctx, []);
    expect(result.findings).toEqual([]);
    expect(result.signals).toEqual([]);
    expect(result.capabilities.every((item) => item.message?.includes("No DPDP candidate files"))).toBe(true);
  });

  it("skips slow optional tools in quick mode while recording the decision", async () => {
    const ctx = context();
    ctx.scanMode = "quick";
    const result = await collectOptionalScannerSignals(ctx, ["src/a.ts"], { enabled: false });
    expect(result.findings).toEqual([]);
    expect(result.capabilities.map((item) => item.message)).toEqual(["Skipped in quick mode", "Skipped in quick mode"]);
  });

  it("executes normal optional adapters once and reuses them in DPDP", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-dpdp-reuse-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const email = 'demo@example.com';\n", "utf8");
    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
baseline:
  enabled: false
checks:
  security:
    enabled: true
  correctness:
    enabled: false
  deadCode:
    enabled: false
  leftovers:
    enabled: false
  refactorReadiness:
    enabled: false
  tests:
    enabled: false
  dependencies:
    enabled: false
  privacy:
    enabled: true
    presidio:
      enabled: true
  dpdp:
    enabled: true
    use_presidio: true
    use_semgrep: true
paths:
  include: [src/**]
`,
      "utf8"
    );

    const originalPresidioRun = presidioAdapter.runStandalone;
    const originalSemgrepBuild = semgrepAdapter.buildScanCommand;
    const presidioRun = vi.fn(async () => ({
      findings: [],
      status: {
        command: "presidio-test",
        stdout: "[]",
        stderr: "",
        exitCode: 0,
        durationMs: 1,
        status: "ok" as const
      }
    }));
    const semgrepBuild = vi.fn(() => ({
      cmd: "node",
      args: ["-e", "console.log(JSON.stringify({results: []}))"],
      cwd: root,
      timeoutMs: 10_000
    }));
    presidioAdapter.runStandalone = presidioRun;
    semgrepAdapter.buildScanCommand = semgrepBuild;

    try {
      await runScan(root, "full");
      expect(presidioRun).toHaveBeenCalledTimes(1);
      expect(semgrepBuild).toHaveBeenCalledTimes(1);
      const dpdp = await loadCachedDpdpScanResult(root);
      expect(dpdp?.capabilities.find((item) => item.id === "presidio")?.message).toContain("Reused presidio scan");
      expect(dpdp?.capabilities.find((item) => item.id === "semgrep")?.message).toContain("Reused semgrep scan");
    } finally {
      presidioAdapter.runStandalone = originalPresidioRun;
      semgrepAdapter.buildScanCommand = originalSemgrepBuild;
    }
  });
});
