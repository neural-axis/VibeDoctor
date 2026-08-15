import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { resolveExecutable } from "./executable";
import {
  artifactFor,
  currentPlatformKey,
  getManagedTool,
  isManagedTool,
  type ManagedArchiveKind,
  type ManagedArtifact,
  type ManagedToolSpec
} from "./managedTools";

export type ToolResolutionStatus =
  | "resolved"
  | "not_found"
  | "checksum_mismatch"
  | "unsupported_platform"
  | "failed";

export type ToolResolutionSource = "project-local" | "managed" | "path";

export type ToolResolution = {
  tool: string;
  status: ToolResolutionStatus;
  source?: ToolResolutionSource;
  version?: string;
  executablePath?: string;
  cachePath?: string;
  reusedCache: boolean;
  reason: string;
  remediation?: string;
};

export type ToolRuntimeOptions = {
  cacheDir?: string;
  projectRoot?: string;
  enabled?: boolean;
  allowNetwork?: boolean;
  preferProjectLocal?: boolean;
  allowPathFallback?: boolean;
  /** Test/advanced: replace the catalog for a tool. */
  catalog?: Record<string, ManagedToolSpec>;
  /** Test: copy this local file instead of downloading. */
  localArtifacts?: Record<string, string>;
  fetchArtifact?: (url: string, destFile: string) => Promise<void>;
};

export type ToolRuntime = {
  readonly cacheDir: string;
  resolve(tool: string, options?: { projectRoot?: string }): Promise<ToolResolution>;
};

type Manifest = {
  tool: string;
  version: string;
  platform: string;
  sha256: string;
  binary: string;
  binarySha256?: string;
  provisionedAt: string;
};

export const DOWNLOAD_TIMEOUT_MS = 45_000;
export const MAX_DOWNLOAD_BYTES = 80 * 1024 * 1024;

const MANIFEST_NAME = "manifest.json";

export function defaultToolCacheDir(): string {
  if (process.env.VIBEDOCTOR_TOOL_CACHE) {
    return process.env.VIBEDOCTOR_TOOL_CACHE;
  }
  return path.join(os.homedir(), ".cache", "vibedoctor");
}

function envAllowsNetwork(): boolean {
  const value = process.env.VIBEDOCTOR_ALLOW_NETWORK;
  if (value === "0" || value === "false") {
    return false;
  }
  return true;
}

export function createToolRuntime(options: ToolRuntimeOptions = {}): ToolRuntime {
  const cacheDir = options.cacheDir ?? defaultToolCacheDir();
  const managedEnabled = options.enabled ?? true;
  const allowNetwork = (options.allowNetwork ?? true) && envAllowsNetwork();
  const preferProjectLocal = options.preferProjectLocal ?? true;
  const allowPathFallback = options.allowPathFallback ?? true;
  const catalog = options.catalog;
  const localArtifacts = options.localArtifacts ?? {};
  const fetchArtifact = options.fetchArtifact ?? downloadFile;

  async function resolve(tool: string, resolveOptions: { projectRoot?: string } = {}): Promise<ToolResolution> {
    const projectRoot = resolveOptions.projectRoot ?? options.projectRoot;
    const spec = catalog?.[tool] ?? getManagedTool(tool);

    if (preferProjectLocal && projectRoot) {
      const local = findProjectLocal(tool, projectRoot);
      if (local) {
        return {
          tool,
          status: "resolved",
          source: "project-local",
          version: spec?.version,
          executablePath: local,
          reusedCache: false,
          reason: `Using project-local ${tool} at ${local}.`
        };
      }
    }

    if (spec && managedEnabled) {
      const managed = await resolveManaged(spec);
      if (managed.status === "resolved" || managed.status === "checksum_mismatch") {
        return managed;
      }
      if (managed.status === "unsupported_platform") {
        const fromPath = allowPathFallback
          ? projectRoot
            ? resolveExecutable(tool, projectRoot)
            : resolveExecutable(tool)
          : undefined;
        if (fromPath) {
          return {
            tool,
            status: "resolved",
            source: "path",
            executablePath: fromPath.path,
            reusedCache: false,
            reason: `No managed ${tool} artifact for this platform; using PATH at ${fromPath.path}.`
          };
        }
        return managed;
      }
      const fromPath = allowPathFallback
        ? projectRoot
          ? resolveExecutable(tool, projectRoot)
          : resolveExecutable(tool)
        : undefined;
      if (fromPath && !isProjectLocalPath(fromPath.path, projectRoot)) {
        return {
          tool,
          status: "resolved",
          source: "path",
          version: spec.version,
          executablePath: fromPath.path,
          reusedCache: false,
          reason: `Managed ${tool} was not available (${managed.reason}); using PATH at ${fromPath.path}.`
        };
      }
      return managed;
    }

    const fromPath = projectRoot ? resolveExecutable(tool, projectRoot) : resolveExecutable(tool);
    if (fromPath) {
      return {
        tool,
        status: "resolved",
        source: isProjectLocalPath(fromPath.path, projectRoot) ? "project-local" : "path",
        executablePath: fromPath.path,
        reusedCache: false,
        reason: `Resolved ${tool} at ${fromPath.path}.`
      };
    }

    return {
      tool,
      status: "not_found",
      reusedCache: false,
      reason: spec
        ? `Managed ${tool} is disabled and ${tool} was not found on PATH.`
        : `${tool} is not a managed engine and was not found on PATH.`,
      remediation: `Install ${tool} or add a managed-tool entry for it.`
    };
  }

  async function resolveManaged(spec: ManagedToolSpec): Promise<ToolResolution> {
    const platform = currentPlatformKey();
    const artifact = artifactFor(spec, platform);
    if (!artifact) {
      return {
        tool: spec.id,
        status: "unsupported_platform",
        version: spec.version,
        reusedCache: false,
        reason: `No managed ${spec.id} ${spec.version} artifact for platform ${platform}.`,
        remediation: `Install ${spec.id} yourself, or run on a supported platform (win32-x64, darwin-arm64, linux-x64, …).`
      };
    }

    const toolDir = path.join(cacheDir, "tools", spec.id, spec.version);
    const binaryPath = path.join(toolDir, artifact.binary);
    const cached = await readValidCache(spec, artifact, toolDir, binaryPath);
    if (cached) {
      return cached;
    }

    try {
      await fs.mkdir(toolDir, { recursive: true });
      const staged = await stageArtifact(spec, artifact, toolDir);
      const digest = await sha256File(staged.archivePath);
      if (digest !== artifact.sha256.toLowerCase()) {
        await rmQuiet(staged.archivePath);
        return {
          tool: spec.id,
          status: "checksum_mismatch",
          version: spec.version,
          cachePath: toolDir,
          reusedCache: false,
          reason: `Checksum mismatch for managed ${spec.id} ${spec.version}: expected ${artifact.sha256}, got ${digest}. The file was not installed.`,
          remediation: `Delete ${toolDir} and rerun the scan. If this persists, the download is corrupt or the catalog checksum is wrong.`
        };
      }

      const executablePath = await materializeBinary(staged, artifact, toolDir, binaryPath);
      await writeManifest(toolDir, {
        tool: spec.id,
        version: spec.version,
        platform,
        sha256: artifact.sha256,
        binary: artifact.binary,
        binarySha256: await sha256File(executablePath),
        provisionedAt: new Date().toISOString()
      });
      if (staged.cleanup) {
        await rmQuiet(staged.archivePath);
      }

      return {
        tool: spec.id,
        status: "resolved",
        source: "managed",
        version: spec.version,
        executablePath,
        cachePath: toolDir,
        reusedCache: false,
        reason: `Provisioned managed ${spec.id} ${spec.version} at ${executablePath}.`
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        tool: spec.id,
        status: /checksum/i.test(message) ? "checksum_mismatch" : "failed",
        version: spec.version,
        cachePath: toolDir,
        reusedCache: false,
        reason: `Could not provision managed ${spec.id} ${spec.version}: ${message}`,
        remediation: allowNetwork
          ? `Check network access to the artifact URL, or install ${spec.id} on PATH.`
          : `Network is disabled. Provide a cached copy under ${toolDir} or a test artifact, or install ${spec.id} on PATH.`
      };
    }
  }

  async function readValidCache(
    spec: ManagedToolSpec,
    artifact: ManagedArtifact,
    toolDir: string,
    binaryPath: string
  ): Promise<ToolResolution | undefined> {
    try {
      await fs.access(binaryPath);
      const manifest = await readManifest(toolDir);
      if (!manifest || manifest.sha256.toLowerCase() !== artifact.sha256.toLowerCase()) {
        return undefined;
      }
      if (manifest.binarySha256) {
        const digest = await sha256File(binaryPath);
        if (digest !== manifest.binarySha256.toLowerCase()) {
          return undefined;
        }
      }
      return {
        tool: spec.id,
        status: "resolved",
        source: "managed",
        version: spec.version,
        executablePath: binaryPath,
        cachePath: toolDir,
        reusedCache: true,
        reason: `Reused managed ${spec.id} ${spec.version} at ${binaryPath}.`
      };
    } catch {
      return undefined;
    }
  }

  async function stageArtifact(
    spec: ManagedToolSpec,
    artifact: ManagedArtifact,
    toolDir: string
  ): Promise<{ archivePath: string; cleanup: boolean }> {
    const local = localArtifacts[spec.id];
    if (local) {
      const dest = path.join(toolDir, path.basename(local));
      await fs.copyFile(local, dest);
      return { archivePath: dest, cleanup: artifact.archive !== "none" };
    }

    if (!allowNetwork) {
      throw new Error(
        `Network is disabled and ${spec.id} ${spec.version} is not in the VibeDoctor cache (${toolDir}).`
      );
    }

    const fileName = path.basename(new URL(artifact.url).pathname) || `${spec.id}.bin`;
    const dest = path.join(toolDir, fileName);
    await fetchArtifact(artifact.url, dest);
    return { archivePath: dest, cleanup: artifact.archive !== "none" };
  }

  return { cacheDir, resolve };
}

function findProjectLocal(tool: string, projectRoot: string): string | undefined {
  const resolved = resolveExecutable(tool, projectRoot);
  if (!resolved) {
    return undefined;
  }
  return isProjectLocalPath(resolved.path, projectRoot) ? resolved.path : undefined;
}

export function isProjectLocalPath(candidate: string, projectRoot: string | undefined): boolean {
  if (!projectRoot) {
    return false;
  }
  const relative = path.relative(projectRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return false;
  }
  return /(^|[/\\])(node_modules|\.venv|venv)([/\\]|$)/i.test(relative);
}

async function materializeBinary(
  staged: { archivePath: string },
  artifact: ManagedArtifact,
  toolDir: string,
  binaryPath: string
): Promise<string> {
  if (artifact.archive === "none") {
    if (path.resolve(staged.archivePath) !== path.resolve(binaryPath)) {
      await fs.copyFile(staged.archivePath, binaryPath);
    }
    if (process.platform !== "win32") {
      await fs.chmod(binaryPath, 0o755);
    }
    return binaryPath;
  }

  await extractArchive(staged.archivePath, toolDir, artifact.archive);
  const found = await findExtractedBinary(toolDir, artifact.binary);
  if (!found) {
    throw new Error(`Archive extracted but ${artifact.binary} was not found in ${toolDir}.`);
  }
  if (path.resolve(found) !== path.resolve(binaryPath)) {
    await fs.copyFile(found, binaryPath);
  }
  if (process.platform !== "win32") {
    await fs.chmod(binaryPath, 0o755);
  }
  return binaryPath;
}

async function extractArchive(archivePath: string, destDir: string, kind: ManagedArchiveKind): Promise<void> {
  const args = kind === "tar.gz" ? ["-xzf", archivePath, "-C", destDir] : ["-xf", archivePath, "-C", destDir];
  await new Promise<void>((resolve, reject) => {
    execFile("tar", args, { windowsHide: true }, (error, _stdout, stderr) => {
      if (error) {
        reject(new Error(stderr || error.message));
        return;
      }
      resolve();
    });
  });
}

async function findExtractedBinary(dir: string, binary: string): Promise<string | undefined> {
  const direct = path.join(dir, binary);
  try {
    await fs.access(direct);
    return direct;
  } catch {
    // Search one level down — some archives wrap the binary in a folder.
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const nested = path.join(dir, entry.name, binary);
      try {
        await fs.access(nested);
        return nested;
      } catch {
        // keep looking
      }
    }
    if (entry.isFile() && entry.name === binary) {
      return path.join(dir, entry.name);
    }
  }
  return undefined;
}

async function readManifest(toolDir: string): Promise<Manifest | undefined> {
  try {
    return JSON.parse(await fs.readFile(path.join(toolDir, MANIFEST_NAME), "utf8")) as Manifest;
  } catch {
    return undefined;
  }
}

async function writeManifest(toolDir: string, manifest: Manifest): Promise<void> {
  await fs.writeFile(path.join(toolDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  const handle = await fs.open(filePath, "r");
  try {
    const stream = handle.createReadStream();
    for await (const chunk of stream) {
      hash.update(chunk as Buffer);
    }
  } finally {
    await handle.close();
  }
  return hash.digest("hex");
}

async function downloadFile(url: string, destFile: string): Promise<void> {
  await fs.mkdir(path.dirname(destFile), { recursive: true });
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      reject(error);
    };
    const succeed = () => {
      if (settled) {
        return;
      }
      settled = true;
      resolve();
    };

    const follow = (target: string, remaining: number) => {
      if (!target.startsWith("https://")) {
        fail(new Error(`Refusing non-HTTPS download: ${target}`));
        return;
      }
      const request = https.get(target, { timeout: DOWNLOAD_TIMEOUT_MS }, (response) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400 && response.headers.location && remaining > 0) {
          response.resume();
          follow(new URL(response.headers.location, target).toString(), remaining - 1);
          return;
        }
        if (status !== 200) {
          response.resume();
          fail(new Error(`Download failed (${status}) for ${target}`));
          return;
        }
        const out = createWriteStream(destFile);
        let received = 0;
        response.on("data", (chunk: Buffer) => {
          received += chunk.length;
          if (received > MAX_DOWNLOAD_BYTES) {
            request.destroy();
            out.destroy();
            fail(new Error(`Download exceeded ${MAX_DOWNLOAD_BYTES} bytes for ${target}`));
          }
        });
        response.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
          request.destroy();
          out.destroy();
          fail(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
        });
        response.pipe(out);
        out.on("finish", () => out.close((error) => (error ? fail(error) : succeed())));
        out.on("error", fail);
      });
      request.setTimeout(DOWNLOAD_TIMEOUT_MS, () => {
        request.destroy();
        fail(new Error(`Download timed out after ${DOWNLOAD_TIMEOUT_MS}ms`));
      });
      request.on("error", fail);
    };
    follow(url, 5);
  });
}

async function rmQuiet(target: string): Promise<void> {
  try {
    await fs.rm(target, { force: true });
  } catch {
    // best effort
  }
}

export { isManagedTool };
