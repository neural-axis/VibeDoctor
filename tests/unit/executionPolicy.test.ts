import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommandEnv, resolveExecutable } from "../../src/core/executable";
import {
  DEFAULT_POLICY,
  allowedPathEntries,
  currentPolicy,
  gitSafetyEnv,
  policyExclusion,
  profilePolicy,
  withExecutionPolicy
} from "../../src/core/executionPolicy";

describe("execution policy", () => {
  it("defaults to the long-standing behaviour outside an explicit profile", () => {
    expect(currentPolicy()).toEqual(DEFAULT_POLICY);
    expect(policyExclusion("vitest")).toBeUndefined();
    expect(gitSafetyEnv()).toEqual({});
  });

  it("static profile excludes tools that execute project code or use the network, with reasons", () => {
    const policy = profilePolicy("static", { targetRoot: process.cwd() });
    for (const tool of ["vitest", "jest", "knip", "coverage.py", "presidio", "semgrep", "osv-scanner"])
      expect(policyExclusion(tool, policy)).toMatch(/static profile/);
    for (const tool of ["ruff", "biome", "tsc", "gitleaks", "privacy-detector"])
      expect(policyExclusion(tool, policy)).toBeUndefined();
    const networked = profilePolicy("static", { targetRoot: process.cwd(), allowNetwork: true });
    expect(policyExclusion("semgrep", networked)).toBeUndefined();
    expect(policyExclusion("vitest", networked)).toMatch(/static profile/);
  });

  it("trusted profile allows project tools but keeps network-backed tools off by default", () => {
    const policy = profilePolicy("trusted", { targetRoot: process.cwd() });
    expect(policyExclusion("vitest", policy)).toBeUndefined();
    expect(policyExclusion("osv-scanner", policy)).toMatch(/network is off/);
  });

  it("removes relative and in-target PATH entries and never resolves an executable inside the target", async () => {
    const target = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-policy-"));
    const bin = path.join(target, "node_modules", ".bin");
    await fs.mkdir(bin, { recursive: true });
    const tool = path.join(bin, process.platform === "win32" ? "faketool.cmd" : "faketool");
    await fs.writeFile(tool, process.platform === "win32" ? "@echo off\r\n" : "#!/bin/sh\n", { mode: 0o755 });
    const outside = os.tmpdir();
    const policy = profilePolicy("static", { targetRoot: target });
    expect(allowedPathEntries([".", bin, outside], policy)).toEqual([outside]);
    expect(resolveExecutable("faketool", target)).toBeDefined();
    await withExecutionPolicy(policy, async () => {
      expect(resolveExecutable("faketool", target)).toBeUndefined();
      expect(resolveExecutable(tool, target)).toBeUndefined();
      const env = buildCommandEnv(target, undefined);
      const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path")!;
      expect(env[pathKey]!.split(path.delimiter)).not.toContain(bin);
    });
  });

  it("passes only allow-listed variables and switches off network and risky git settings", async () => {
    process.env.VIBEDOCTOR_TEST_SECRET = "should-not-leak";
    try {
      await withExecutionPolicy(profilePolicy("static", { targetRoot: process.cwd() }), async () => {
        const env = buildCommandEnv(process.cwd(), undefined);
        expect(env.VIBEDOCTOR_TEST_SECRET).toBeUndefined();
        expect(env.VIBEDOCTOR_ALLOW_NETWORK).toBe("0");
        const git = gitSafetyEnv();
        const keys = Object.entries(git).filter(([k]) => k.startsWith("GIT_CONFIG_KEY_")).map(([, v]) => v);
        expect(keys).toEqual(expect.arrayContaining(["core.fsmonitor", "core.hooksPath", "diff.external"]));
      });
    } finally {
      delete process.env.VIBEDOCTOR_TEST_SECRET;
    }
  });
});
