/**
 * Pinned managed-tool catalog.
 *
 * Adapters ask for `tool: "ruff"`; ToolRuntime maps that name onto a
 * versioned, checksummed artifact in the VibeDoctor cache. Other engines plug
 * into the same shape without changing adapters.
 */

export type ManagedArchiveKind = "zip" | "tar.gz" | "none";

export type ManagedArtifact = {
  url: string;
  sha256: string;
  archive: ManagedArchiveKind;
  /** File name of the executable inside the archive (or the copied file). */
  binary: string;
};

export type ManagedToolSpec = {
  id: string;
  version: string;
  artifacts: Record<string, ManagedArtifact>;
};

const RUFF_VERSION = "0.16.3";
const RUFF_BASE = `https://releases.astral.sh/github/ruff/releases/download/${RUFF_VERSION}`;

const GITLEAKS_VERSION = "8.30.1";
const GITLEAKS_BASE = `https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}`;

const OSV_VERSION = "2.5.0";
const OSV_BASE = `https://github.com/google/osv-scanner/releases/download/v${OSV_VERSION}`;

export const MANAGED_TOOLS: Record<string, ManagedToolSpec> = {
  ruff: {
    id: "ruff",
    version: RUFF_VERSION,
    artifacts: {
      "win32-x64": {
        url: `${RUFF_BASE}/ruff-x86_64-pc-windows-msvc.zip`,
        sha256: "f10c709755b393fd9821506b21070bcca969b9966504edd1e490efd08e3662ba",
        archive: "zip",
        binary: "ruff.exe"
      },
      "win32-arm64": {
        url: `${RUFF_BASE}/ruff-aarch64-pc-windows-msvc.zip`,
        sha256: "9a9915c54b27b26c972271fbd603845610bb379a7f29571daf923fd8d2bda33e",
        archive: "zip",
        binary: "ruff.exe"
      },
      "darwin-x64": {
        url: `${RUFF_BASE}/ruff-x86_64-apple-darwin.tar.gz`,
        sha256: "05c2a6705e7c0c056d6d93ff538978583f0c47b4c28d334ab9d58d2e8daf4c24",
        archive: "tar.gz",
        binary: "ruff"
      },
      "darwin-arm64": {
        url: `${RUFF_BASE}/ruff-aarch64-apple-darwin.tar.gz`,
        sha256: "136a4db6512d9b16dda56ac8604696ed65c3b1a914a142de029e7f8d5006f1d9",
        archive: "tar.gz",
        binary: "ruff"
      },
      "linux-x64": {
        url: `${RUFF_BASE}/ruff-x86_64-unknown-linux-gnu.tar.gz`,
        sha256: "7ab3b978d2c0b1c96b2323d4e5c4f35284ae1cdf35d2f7399595c74c805f5fa3",
        archive: "tar.gz",
        binary: "ruff"
      },
      "linux-arm64": {
        url: `${RUFF_BASE}/ruff-aarch64-unknown-linux-gnu.tar.gz`,
        sha256: "b9cc833f5db856484b38718c9da195a6ec990707307bda30530913a09705419a",
        archive: "tar.gz",
        binary: "ruff"
      },
      "linux-x64-musl": {
        url: `${RUFF_BASE}/ruff-x86_64-unknown-linux-musl.tar.gz`,
        sha256: "d67c9b5949981698c48915abf65e0b3406ba9184ad73521cdf20a926bc889c73",
        archive: "tar.gz",
        binary: "ruff"
      }
    }
  },
  gitleaks: {
    id: "gitleaks",
    version: GITLEAKS_VERSION,
    artifacts: {
      "win32-x64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_windows_x64.zip`,
        sha256: "d29144deff3a68aa93ced33dddf84b7fdc26070add4aa0f4513094c8332afc4e",
        archive: "zip",
        binary: "gitleaks.exe"
      },
      "win32-arm64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_windows_arm64.zip`,
        sha256: "b95f5e4f5c425cedca7ee203d9afd29597e692c4924a12ed42f970537c72cc0f",
        archive: "zip",
        binary: "gitleaks.exe"
      },
      "darwin-x64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_darwin_x64.tar.gz`,
        sha256: "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
        archive: "tar.gz",
        binary: "gitleaks"
      },
      "darwin-arm64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_darwin_arm64.tar.gz`,
        sha256: "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
        archive: "tar.gz",
        binary: "gitleaks"
      },
      "linux-x64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz`,
        sha256: "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
        archive: "tar.gz",
        binary: "gitleaks"
      },
      "linux-arm64": {
        url: `${GITLEAKS_BASE}/gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz`,
        sha256: "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
        archive: "tar.gz",
        binary: "gitleaks"
      }
    }
  },
  "osv-scanner": {
    id: "osv-scanner",
    version: OSV_VERSION,
    artifacts: {
      "win32-x64": {
        url: `${OSV_BASE}/osv-scanner_windows_amd64.exe`,
        sha256: "4342285bd8be36b9f113468f3eea86e7900befbcd19ca8dc6ac4f0f6cbe7c362",
        archive: "none",
        binary: "osv-scanner.exe"
      },
      "win32-arm64": {
        url: `${OSV_BASE}/osv-scanner_windows_arm64.exe`,
        sha256: "b8bb8d499e0636e193688c96834a11a8f74e353734053f9641e546d76a0cb857",
        archive: "none",
        binary: "osv-scanner.exe"
      },
      "darwin-x64": {
        url: `${OSV_BASE}/osv-scanner_darwin_amd64`,
        sha256: "baef4f4a4ce2924a9241869c36d4bd9d6c04b632cae6637a0f6347ab9272eb16",
        archive: "none",
        binary: "osv-scanner"
      },
      "darwin-arm64": {
        url: `${OSV_BASE}/osv-scanner_darwin_arm64`,
        sha256: "fff5a2e351b7f0a60001e87cbf862e82fb82e2792d368b533fec7a5865a73da2",
        archive: "none",
        binary: "osv-scanner"
      },
      "linux-x64": {
        url: `${OSV_BASE}/osv-scanner_linux_amd64`,
        sha256: "edcfc41d257db36148f065055655fe3fcfc434b0b423ea67468a84c207524e0c",
        archive: "none",
        binary: "osv-scanner"
      },
      "linux-arm64": {
        url: `${OSV_BASE}/osv-scanner_linux_arm64`,
        sha256: "fe152e1a546af223e6c557cc3111a8bb3e5dc02fcbf7dbe95d26567c0f0041f2",
        archive: "none",
        binary: "osv-scanner"
      }
    }
  }
};

export function isManagedTool(id: string): boolean {
  return Boolean(MANAGED_TOOLS[id]);
}

export function getManagedTool(id: string): ManagedToolSpec | undefined {
  return MANAGED_TOOLS[id];
}

export function currentPlatformKey(): string {
  const os = process.platform === "win32" || process.platform === "darwin" || process.platform === "linux" ? process.platform : "linux";
  const arch = process.arch === "x64" || process.arch === "arm64" || process.arch === "ia32" || process.arch === "arm" ? process.arch : "x64";
  if (os === "linux" && arch === "x64" && typeof process.report?.getReport === "function" && isMusl()) {
    return "linux-x64-musl";
  }
  if (os === "win32" && arch === "ia32") {
    return "win32-x64";
  }
  return `${os}-${arch === "ia32" ? "x64" : arch}`;
}

function isMusl(): boolean {
  try {
    const report = process.report?.getReport() as { header?: { glibcVersionRuntime?: string } } | string | undefined;
    if (report && typeof report === "object") {
      return !report.header?.glibcVersionRuntime;
    }
  } catch {
    // Best-effort; fall back to gnu.
  }
  return false;
}

export function artifactFor(spec: ManagedToolSpec, platformKey = currentPlatformKey()): ManagedArtifact | undefined {
  return spec.artifacts[platformKey];
}
