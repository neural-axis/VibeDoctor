import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createToolRuntime, sha256File } from "../../src/core/toolRuntime";
import { artifactFor, currentPlatformKey, MANAGED_TOOLS, type ManagedToolSpec } from "../../src/core/managedTools";

async function writeFakeRuff(dir: string, body: string): Promise<string> {
  const binary = process.platform === "win32" ? "ruff.cmd" : "ruff";
  const file = path.join(dir, binary);
  await fs.mkdir(dir, { recursive: true });
  if (process.platform === "win32") {
    await fs.writeFile(file, `@echo off\n${body}\n`, "utf8");
  } else {
    await fs.writeFile(file, `#!/bin/sh\n${body}\n`, "utf8");
    await fs.chmod(file, 0o755);
  }
  return file;
}

function specFor(artifactPath: string, sha256: string): ManagedToolSpec {
  const binary = path.basename(artifactPath);
  return {
    id: "ruff",
    version: "test-1",
    artifacts: {
      [currentPlatformKey()]: {
        url: "https://example.invalid/ruff-test",
        sha256,
        archive: "none",
        binary
      }
    }
  };
}

describe("managed catalog", () => {
  it("pins checksummed artifacts for ruff, gitleaks, and osv-scanner on this platform", () => {
    for (const id of ["ruff", "gitleaks", "osv-scanner"] as const) {
      const spec = MANAGED_TOOLS[id];
      expect(spec, id).toBeDefined();
      expect(artifactFor(spec)).toBeDefined();
      expect(artifactFor(spec)?.sha256).toMatch(/^[a-f0-9]{64}$/);
    }
  });
});

describe("ToolRuntime", () => {
  const temps: string[] = [];

  afterEach(async () => {
    await Promise.all(temps.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
  });

  it("provisions a managed engine from a local artifact, reuses the cache, and does not need PATH", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-art-"));
    temps.push(cacheDir, artifactDir);
    const artifact = await writeFakeRuff(artifactDir, "echo []");
    const digest = await sha256File(artifact);
    const runtime = createToolRuntime({
      cacheDir,
      allowNetwork: false,
      preferProjectLocal: false,
      catalog: { ruff: specFor(artifact, digest) },
      localArtifacts: { ruff: artifact }
    });

    const first = await runtime.resolve("ruff");
    const second = await runtime.resolve("ruff");

    expect(first.status).toBe("resolved");
    expect(first.source).toBe("managed");
    expect(first.reusedCache).toBe(false);
    expect(first.version).toBe("test-1");
    expect(first.executablePath).toBeTruthy();
    expect(second.reusedCache).toBe(true);
    expect(second.executablePath).toBe(first.executablePath);
    expect(second.version).toBe("test-1");
  });

  it("reports a checksum mismatch instead of installing a corrupt artifact", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-art-"));
    temps.push(cacheDir, artifactDir);
    const artifact = await writeFakeRuff(artifactDir, "echo bad");
    const runtime = createToolRuntime({
      cacheDir,
      allowNetwork: false,
      preferProjectLocal: false,
      catalog: { ruff: specFor(artifact, createHash("sha256").update("not-the-file").digest("hex")) },
      localArtifacts: { ruff: artifact }
    });

    const result = await runtime.resolve("ruff");
    expect(result.status).toBe("checksum_mismatch");
    expect(result.executablePath).toBeUndefined();
  });

  it("does not reuse a cached binary when the manifest is missing", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    const artifactDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-ruff-art-"));
    temps.push(cacheDir, artifactDir);
    const artifact = await writeFakeRuff(artifactDir, "echo []");
    const digest = await sha256File(artifact);
    const runtime = createToolRuntime({
      cacheDir,
      allowNetwork: false,
      preferProjectLocal: false,
      catalog: { ruff: specFor(artifact, digest) },
      localArtifacts: { ruff: artifact }
    });

    const first = await runtime.resolve("ruff");
    expect(first.status).toBe("resolved");
    expect(first.cachePath).toBeTruthy();
    await fs.rm(path.join(first.cachePath!, "manifest.json"), { force: true });

    const second = await runtime.resolve("ruff");
    expect(second.status).toBe("resolved");
    expect(second.reusedCache).toBe(false);
  });

  it("does not download when managed tools are disabled", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    temps.push(cacheDir);
    let fetched = 0;
    const runtime = createToolRuntime({
      cacheDir,
      enabled: false,
      allowNetwork: true,
      preferProjectLocal: false,
      catalog: {
        "vd-fresh-tool": {
          id: "vd-fresh-tool",
          version: "test-1",
          artifacts: {
            [currentPlatformKey()]: {
              url: "https://example.invalid/tool",
              sha256: "ab".repeat(32),
              archive: "none",
              binary: "vd-fresh-tool"
            }
          }
        }
      },
      fetchArtifact: async () => {
        fetched += 1;
      }
    });

    const result = await runtime.resolve("vd-fresh-tool");
    expect(fetched).toBe(0);
    expect(result.status).toBe("not_found");
    expect(result.reason).toMatch(/disabled/i);
  });

  it("treats VIBEDOCTOR_ALLOW_NETWORK=0 as a hard override", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    temps.push(cacheDir);
    const previous = process.env.VIBEDOCTOR_ALLOW_NETWORK;
    process.env.VIBEDOCTOR_ALLOW_NETWORK = "0";
    let fetched = 0;
    try {
      const runtime = createToolRuntime({
        cacheDir,
        allowNetwork: true,
        preferProjectLocal: false,
        allowPathFallback: false,
        catalog: {
          "vd-fresh-tool": {
            id: "vd-fresh-tool",
            version: "test-1",
            artifacts: {
              [currentPlatformKey()]: {
                url: "https://example.invalid/tool",
                sha256: "ab".repeat(32),
                archive: "none",
                binary: "vd-fresh-tool"
              }
            }
          }
        },
        fetchArtifact: async () => {
          fetched += 1;
        }
      });

      const result = await runtime.resolve("vd-fresh-tool");
      expect(fetched).toBe(0);
      expect(result.status).toBe("failed");
      expect(result.reason).toMatch(/Network is disabled/i);
    } finally {
      if (previous === undefined) {
        delete process.env.VIBEDOCTOR_ALLOW_NETWORK;
      } else {
        process.env.VIBEDOCTOR_ALLOW_NETWORK = previous;
      }
    }
  });

  it("reports a missing platform artifact honestly", async () => {
    const cacheDir = await fs.mkdtemp(path.join(os.tmpdir(), "vd-tool-cache-"));
    temps.push(cacheDir);
    const runtime = createToolRuntime({
      cacheDir,
      allowNetwork: false,
      preferProjectLocal: false,
      allowPathFallback: false,
      catalog: {
        ruff: {
          id: "ruff",
          version: "test-1",
          artifacts: {
            "plan9-x64": {
              url: "https://example.invalid/ruff",
              sha256: "abc",
              archive: "none",
              binary: "ruff"
            }
          }
        }
      }
    });

    const result = await runtime.resolve("ruff");
    expect(result.status).toBe("unsupported_platform");
    expect(result.reason).toMatch(/No managed ruff/i);
  });
});
