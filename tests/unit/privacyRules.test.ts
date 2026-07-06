import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { detectPiiFindings } from "../../src/adapters/privacyDetector";
import { telemetryDetectorAdapter } from "../../src/adapters/telemetryDetector";
import { defaultConfig } from "../../src/core/config";
import type { ToolAdapterContext } from "../../src/adapters/shared";

function createPrivacyContext(root: string, projectFiles: string[]): ToolAdapterContext {
  return {
    root,
    project: {
      root,
      projectFiles,
      languages: ["typescript"],
      packageManagers: [],
      hasGit: false,
      changedFiles: [],
      configFiles: [],
      lockfiles: [],
      testCommands: [],
      toolsAvailable: {},
      frameworkHints: [],
      entryFiles: projectFiles
    },
    config: defaultConfig,
    scanMode: "default"
  };
}

describe("advanced privacy features", () => {
  it("telemetry detector flags missing opt-outs and fixes them", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-telemetry-"));
    const packageJsonContent = JSON.stringify({
      dependencies: {
        next: "^14.0.0"
      }
    });
    await fs.writeFile(path.join(root, "package.json"), packageJsonContent, "utf8");

    const ctx = createPrivacyContext(root, ["package.json"]);

    const isEnabled = await telemetryDetectorAdapter.detect(ctx.project, ctx.config);
    expect(isEnabled).toBe(true);

    const { findings } = await telemetryDetectorAdapter.runStandalone!(ctx);
    expect(findings).toHaveLength(1);
    expect(findings[0].id).toBe("privacy:telemetry:opt-out");
    expect(findings[0].severity).toBe("low");

    // Execute safe fix
    const fixSpec = telemetryDetectorAdapter.buildFixCommand!(ctx);
    const { execSync } = require("node:child_process");
    execSync(`${fixSpec.cmd} ${fixSpec.args.map((a) => `"${a.replace(/"/g, '\\"')}"`).join(" ")}`, { cwd: root });

    // Verify .env file was created and variables appended
    const envContent = await fs.readFile(path.join(root, ".env"), "utf8");
    expect(envContent).toContain("NEXT_TELEMETRY_DISABLED=1");
    expect(envContent).toContain("DO_NOT_TRACK=1");

    // Re-run scan to ensure it passes now
    const { findings: findingsAfter } = await telemetryDetectorAdapter.runStandalone!(ctx);
    expect(findingsAfter).toHaveLength(0);
  });

  it("log sanitization check flags raw variable logs and respects redaction helpers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-logs-"));
    const code = [
      "console.log('User object:', user);",
      "logger.info('Some message', redact(user));",
      "log.error('Failed for customer:', customer);",
      "logger.warn('Safe output:', safeUser);"
    ].join("\n");
    await fs.writeFile(path.join(root, "index.ts"), code, "utf8");

    const ctx = createPrivacyContext(root, ["index.ts"]);

    const findings = await detectPiiFindings(ctx);
    const logFindings = findings.filter((f) => f.id.startsWith("privacy:unsanitized-log:"));

    // Should flag console.log('User object:', user) and log.error('Failed for customer:', customer)
    // Should NOT flag redact(user) and safeUser (due to redact/safe words)
    expect(logFindings).toHaveLength(2);
    expect(logFindings[0].startLine).toBe(1);
    expect(logFindings[1].startLine).toBe(3);
  });

  it("api overfetching check flags direct model serialization in api responses", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-api-"));
    const code = [
      "app.get('/user', (req, res) => {",
      "  res.json(user);",
      "});",
      "app.post('/customer', (req, res) => {",
      "  res.send(customer);",
      "});",
      "app.get('/safe', (req, res) => {",
      "  res.json(user.toDto());",
      "});"
    ].join("\n");
    await fs.writeFile(path.join(root, "routes.ts"), code, "utf8");

    const ctx = createPrivacyContext(root, ["routes.ts"]);

    const findings = await detectPiiFindings(ctx);
    const apiFindings = findings.filter((f) => f.id.startsWith("privacy:api-overfetching:"));

    expect(apiFindings).toHaveLength(2);
    expect(apiFindings[0].startLine).toBe(2);
    expect(apiFindings[1].startLine).toBe(5);
  });

  it("database retention auditor flags prisma tables storing pii that lack soft-delete fields", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-db-"));
    const schema = [
      "model User {",
      "  id    Int    @id",
      "  email String",
      "}",
      "model Customer {",
      "  id        Int      @id",
      "  email     String",
      "  deletedAt DateTime?",
      "}"
    ].join("\n");
    await fs.writeFile(path.join(root, "schema.prisma"), schema, "utf8");

    const ctx = createPrivacyContext(root, ["schema.prisma"]);

    const findings = await detectPiiFindings(ctx);
    const dbFindings = findings.filter((f) => f.id.startsWith("privacy:missing-retention:"));

    // Should flag User (stores email but has no deletedAt/ttl field)
    // Should NOT flag Customer (has deletedAt field)
    expect(dbFindings).toHaveLength(1);
    expect(dbFindings[0].id).toContain("User");
  });
});
