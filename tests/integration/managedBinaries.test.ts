import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runScan } from "../../src/core/engine";
import { sha256File } from "../../src/core/toolRuntime";
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

function specFor(id: string, artifactPath: string, sha256: string): ManagedToolSpec {
  return {
    id,
    version: "test-1",
    artifacts: {
      [currentPlatformKey()]: {
        url: `https://example.invalid/${id}`,
        sha256,
        archive: "none",
        binary: path.basename(artifactPath)
      }
    }
  };
}

async function writeNodeShim(dir: string, name: string, script: string): Promise<string> {
  const binary = process.platform === "win32" ? `${name}.cmd` : name;
  const file = path.join(dir, binary);
  if (process.platform === "win32") {
    await fs.writeFile(file, `@echo off\n"${process.execPath}" -e "${script}"\nexit /b 0\n`, "utf8");
  } else {
    await fs.writeFile(file, `#!/bin/sh\n"${process.execPath}" -e "${script}"\nexit 0\n`, "utf8");
    await fs.chmod(file, 0o755);
  }
  return file;
}

describe("managed Gitleaks and OSV-Scanner", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("provisions both engines without mutating the target repo", async () => {
    const root = await createTempFixtureCopy("managed-binaries");
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-bin-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-bin-art-"));
    temps.push(root, cacheDir, artifactDir);

    await fs.writeFile(
      path.join(root, "vibedoctor.yml"),
      `version: 1
checks:
  security: { enabled: true }
  correctness: { enabled: false }
  tests: { enabled: false }
  dependencies: { enabled: true }
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

    const before = {
      packageJson: await hashIfExists(root, "package.json"),
      lock: await hashIfExists(root, "package-lock.json")
    };

    const gitleaks = await writeNodeShim(artifactDir, "gitleaks", "console.log('[]')");
    const osv = await writeNodeShim(artifactDir, "osv-scanner", "console.log(JSON.stringify({results:[]}))");
    const catalog = {
      gitleaks: specFor("gitleaks", gitleaks, await sha256File(gitleaks)),
      "osv-scanner": specFor("osv-scanner", osv, await sha256File(osv))
    };

    const scan = await runScan(root, "full", {
      runtimeOptions: {
        cacheDir,
        allowNetwork: false,
        preferProjectLocal: true,
        catalog,
        localArtifacts: { gitleaks, "osv-scanner": osv }
      }
    });

    const gitleaksCap = scan.capabilityMatrix.tools.find((tool) => tool.id === "gitleaks");
    const osvCap = scan.capabilityMatrix.tools.find((tool) => tool.id === "osv-scanner");
    expect(gitleaksCap?.state).not.toBe("not_installed");
    expect(osvCap?.state).not.toBe("not_installed");
    expect(gitleaksCap?.state === "completed" || gitleaksCap?.resolvedPath).toBeTruthy();
    expect(osvCap?.state === "completed" || osvCap?.resolvedPath).toBeTruthy();

    const after = {
      packageJson: await hashIfExists(root, "package.json"),
      lock: await hashIfExists(root, "package-lock.json")
    };
    expect(after).toEqual(before);
  });
});
