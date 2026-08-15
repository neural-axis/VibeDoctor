import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { createToolRuntime, sha256File } from "../../src/core/toolRuntime";
import { currentPlatformKey, type ManagedToolSpec } from "../../src/core/managedTools";
import { createTempFixtureCopy } from "../helpers";

async function hashIfExists(root: string, relative: string): Promise<string | null> {
  try {
    const bytes = await fs.readFile(path.join(root, relative));
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

async function writeFakeRuff(dir: string): Promise<string> {
  const binary = process.platform === "win32" ? "ruff.cmd" : "ruff";
  const file = path.join(dir, binary);
  const script = `console.log(JSON.stringify([{filename:'src/app.py',code:'F401',message:'unused import',location:{row:1},end_location:{row:1}}]))`;
  if (process.platform === "win32") {
    await fs.writeFile(file, `@echo off\n"${process.execPath}" -e "${script}"\nexit /b 1\n`, "utf8");
  } else {
    await fs.writeFile(file, `#!/bin/sh\n"${process.execPath}" -e "${script}"\nexit 1\n`, "utf8");
    await fs.chmod(file, 0o755);
  }
  return file;
}

async function prepareManagedRuffFixture(): Promise<string> {
  const root = await createTempFixtureCopy("managed-ruff");
  await fs.writeFile(
    path.join(root, "vibedoctor.yml"),
    `version: 1
checks:
  security: { enabled: false }
  correctness: { enabled: true }
  tests: { enabled: false }
  dependencies: { enabled: false }
  privacy: { enabled: false }
  dpdp: { enabled: false }
  leftovers: { enabled: false }
  dead_code: { enabled: false }
  refactor_readiness: { enabled: false }
  flow_analysis: { enabled: false }
runtime:
  verify_tools_before_scan: true
  managed_tools:
    allow_network: false
    prefer_project_local: true
`,
    "utf8"
  );
  return root;
}

function specFor(artifactPath: string, sha256: string): ManagedToolSpec {
  return {
    id: "ruff",
    version: "test-1",
    artifacts: {
      [currentPlatformKey()]: {
        url: "https://example.invalid/ruff-test",
        sha256,
        archive: "none",
        binary: path.basename(artifactPath)
      }
    }
  };
}

describe("managed Ruff zero-setup", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("resolves managed Ruff when the project has no local install and does not mutate the repo", async () => {
    const root = await prepareManagedRuffFixture();
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-bin-"));
    temps.push(root, cacheDir, artifactDir);

    const before = {
      packageJson: await hashIfExists(root, "package.json"),
      lock: await hashIfExists(root, "package-lock.json"),
      pyproject: await hashIfExists(root, "pyproject.toml"),
      requirements: await hashIfExists(root, "requirements.txt")
    };

    const artifact = await writeFakeRuff(artifactDir);
    const digest = await sha256File(artifact);
    const catalog = { ruff: specFor(artifact, digest) };
    const runtimeOptions = {
      cacheDir,
      allowNetwork: false,
      preferProjectLocal: true,
      catalog,
      localArtifacts: { ruff: artifact }
    };

    const first = await runScan(root, "full", { runtimeOptions });
    const ruffFirst = first.capabilityMatrix.tools.find((tool) => tool.id === "ruff");
    expect(ruffFirst?.state).not.toBe("not_installed");
    expect(ruffFirst?.state === "completed" || ruffFirst?.state === "failed" || (ruffFirst?.findingsReported ?? 0) > 0).toBe(
      true
    );
    expect(first.findings.some((finding) => finding.source === "ruff")).toBe(true);
    expect(ruffFirst?.resolvedPath?.includes(cacheDir) || ruffFirst?.reason.includes("managed")).toBeTruthy();

    const runtime = createToolRuntime(runtimeOptions);
    const secondResolve = await runtime.resolve("ruff", { projectRoot: root });
    expect(secondResolve.reusedCache).toBe(true);
    expect(secondResolve.version).toBe("test-1");

    const after = {
      packageJson: await hashIfExists(root, "package.json"),
      lock: await hashIfExists(root, "package-lock.json"),
      pyproject: await hashIfExists(root, "pyproject.toml"),
      requirements: await hashIfExists(root, "requirements.txt")
    };
    expect(after).toEqual(before);
  });

  it("does not treat a managed checksum failure as a clean scan", async () => {
    const root = await prepareManagedRuffFixture();
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-bin-"));
    temps.push(root, cacheDir, artifactDir);
    const artifact = await writeFakeRuff(artifactDir);

    const scan = await runScan(root, "full", {
      runtimeOptions: {
        cacheDir,
        allowNetwork: false,
        preferProjectLocal: false,
        catalog: { ruff: specFor(artifact, "0".repeat(64)) },
        localArtifacts: { ruff: artifact }
      }
    });

    const ruff = scan.capabilityMatrix.tools.find((tool) => tool.id === "ruff");
    expect(ruff?.state === "failed" || ruff?.state === "not_installed").toBe(true);
    expect(scan.completeness.status).not.toBe("complete");
    expect(scan.completeness.incompleteTools).toContain("ruff");
  });
});
