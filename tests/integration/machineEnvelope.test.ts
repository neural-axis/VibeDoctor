import { promises as fs, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScanCommand } from "../../src/cli/commands/scan";
import { profilePolicy, withExecutionPolicy } from "../../src/core/executionPolicy";
import { ENVELOPE_SCHEMA, ENVELOPE_VERSION } from "../../src/integration/envelope";
import { sourceFingerprint } from "../../src/integration/sourceFingerprint";
import YAML from "yaml";
import { createTempFixtureCopy } from "../helpers";

const created: string[] = [];
const schema = JSON.parse(
  readFileSync(path.join(process.cwd(), "schemas", "machine-envelope.v1.schema.json"), "utf8")
);

/** Checks required properties, consts, enums and basic types; enough to catch contract drift. */
function expectMatchesSchema(value: unknown, node: Record<string, any>, at = "$"): void {
  if (node.const !== undefined) expect(value, at).toBe(node.const);
  if (node.enum) expect(node.enum, at).toContain(value);
  const types = node.type ? ([] as string[]).concat(node.type) : [];
  if (types.length) {
    const actual = value === null ? "null" : Array.isArray(value) ? "array" : Number.isInteger(value) ? "integer" : typeof value;
    expect(types.includes(actual) || (actual === "integer" && types.includes("number")), `${at} is ${actual}`).toBe(true);
  }
  if (node.pattern && typeof value === "string") expect(value, at).toMatch(new RegExp(node.pattern));
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const key of node.required ?? []) expect(value, `${at} requires ${key}`).toHaveProperty(key);
    for (const [key, child] of Object.entries(node.properties ?? {}))
      if (key in (value as object)) expectMatchesSchema((value as any)[key], child as Record<string, any>, `${at}.${key}`);
  }
  if (Array.isArray(value) && node.items) value.forEach((item, i) => expectMatchesSchema(item, node.items, `${at}[${i}]`));
}
afterEach(async () => {
  for (const dir of created.splice(0)) await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
});

/**
 * Plants executables, scripts and configs that write a marker file if anything runs them.
 * A static-profile scan must leave the marker absent.
 */
async function booby(root: string): Promise<string> {
  const marker = path.join(root, "EXECUTED.txt");
  const js = `require("fs").writeFileSync(${JSON.stringify(marker)}, "ran");`;
  const bin = path.join(root, "node_modules", ".bin");
  await fs.mkdir(bin, { recursive: true });
  for (const name of ["tsc", "biome", "knip", "vitest", "gitleaks"]) {
    if (process.platform === "win32") {
      await fs.writeFile(path.join(bin, `${name}.cmd`), `@echo off\r\necho ran> "${marker}"\r\n`);
      await fs.writeFile(path.join(root, `${name}.cmd`), `@echo off\r\necho ran> "${marker}"\r\n`);
    } else {
      await fs.writeFile(path.join(bin, name), `#!/bin/sh\necho ran > "${marker}"\n`, { mode: 0o755 });
    }
  }
  await fs.writeFile(path.join(root, "knip.config.js"), `${js}\nmodule.exports = {};\n`);
  await fs.writeFile(path.join(root, "vitest.config.js"), `${js}\nmodule.exports = {};\n`);
  await fs.writeFile(path.join(root, "tsconfig.json"), JSON.stringify({ compilerOptions: { strict: true } }));
  const pkgPath = path.join(root, "package.json");
  const pkg = JSON.parse(await fs.readFile(pkgPath, "utf8").catch(() => "{}"));
  pkg.scripts = { ...(pkg.scripts ?? {}), test: `node -e '${js}'`, postinstall: `node -e '${js}'` };
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), vitest: "*", knip: "*", typescript: "*" };
  await fs.writeFile(pkgPath, JSON.stringify(pkg, null, 2));
  // The shared fixture helper turns categories off for speed; this test needs the tools that a
  // booby-trapped repository would hijack (tsc, biome, gitleaks) to be planned.
  const configPath = path.join(root, "vibedoctor.yml");
  const config = YAML.parse(await fs.readFile(configPath, "utf8"));
  config.checks.security.enabled = true;
  config.checks.correctness.enabled = true;
  await fs.writeFile(configPath, YAML.stringify(config));
  return marker;
}

describe("machine envelope and static profile", () => {
  it(
    "runs a static scan without executing project code and emits a versioned envelope",
    async () => {
      const root = await createTempFixtureCopy("ts-basic");
      created.push(root);
      const marker = await booby(root);
      const before = await sourceFingerprint(root);

      const result = await withExecutionPolicy(profilePolicy("static", { targetRoot: root }), () =>
        runScanCommand(root, { report: "envelope", version: "test" })
      );
      const envelope = JSON.parse(result.output);

      await expect(fs.access(marker)).rejects.toThrow();
      expectMatchesSchema(envelope, schema);
      expect(envelope.schema).toBe(ENVELOPE_SCHEMA);
      expect(envelope.schemaVersion).toBe(ENVELOPE_VERSION);
      expect(envelope.run.profile).toBe("static");
      expect(envelope.run.network).toBe(false);
      expect(envelope.execution.status).toBe("completed");
      expect(envelope.gate.exitCode).toBe(result.exitCode);
      expect(envelope.repository.source).toEqual(before);
      expect(Array.isArray(envelope.report.findings)).toBe(true);
      for (const finding of envelope.report.findings) expect(finding.fingerprint).toMatch(/^[0-9a-f]{40}$/);
      const tools = envelope.report.capabilityMatrix.tools as Array<{ id: string; state: string; reason: string }>;
      for (const id of ["vitest", "knip"]) {
        const tool = tools.find((t) => t.id === id);
        expect(tool?.state).toBe("disabled");
        expect(tool?.reason).toMatch(/static profile/);
      }
      // The planted files are untouched: the source fingerprint ignores only .vibedoctor/.
      expect(await sourceFingerprint(root)).toEqual(before);
    },
    180_000
  );

  it(
    "positive control: the same booby-trapped repository does run project code under the default profile",
    async () => {
      const root = await createTempFixtureCopy("ts-basic");
      created.push(root);
      const marker = await booby(root);
      await runScanCommand(root, { report: "json" });
      await expect(fs.access(marker)).resolves.toBeUndefined();
    },
    180_000
  );

  it("leaves the existing JSON report format unchanged", async () => {
    const root = await createTempFixtureCopy("js-basic");
    created.push(root);
    const json = JSON.parse((await runScanCommand(root, { report: "json" })).output);
    expect(json).not.toHaveProperty("schema");
    expect(json.findings.every((f: Record<string, unknown>) => !("fingerprint" in f))).toBe(true);
  }, 180_000);
});
