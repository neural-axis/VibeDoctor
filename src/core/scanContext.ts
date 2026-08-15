import { createFileRoleClassifier, type FileRoleClassifier } from "./fileRole";
import type { VibeDoctorConfig } from "./config";
import { detectProject, type ProjectContext } from "./projectDetector";
import type { ScanMode } from "./scanPlanner";
import { createToolRuntime, type ToolRuntime, type ToolRuntimeOptions } from "./toolRuntime";

export type FileIndex = {
  files: readonly string[];
  byExtension(extension: string): string[];
};

export type GitContext = {
  hasGit: boolean;
  changedFiles: readonly string[];
};

export type RepoContext = ProjectContext;

export type ScanContext = {
  root: string;
  mode: ScanMode;
  config: VibeDoctorConfig;
  repo: RepoContext;
  files: FileIndex;
  git: GitContext;
  classifyFile: FileRoleClassifier;
  toolRuntime: ToolRuntime;
};

export function buildFileIndex(files: string[]): FileIndex {
  const byExt = new Map<string, string[]>();
  for (const file of files) {
    const dot = file.lastIndexOf(".");
    const ext = dot >= 0 ? file.slice(dot).toLowerCase() : "";
    const list = byExt.get(ext) ?? [];
    list.push(file);
    byExt.set(ext, list);
  }
  return {
    files,
    byExtension(extension: string) {
      const key = extension.startsWith(".") ? extension.toLowerCase() : `.${extension.toLowerCase()}`;
      return byExt.get(key) ?? [];
    }
  };
}

export async function buildScanContext(
  root: string,
  config: VibeDoctorConfig,
  mode: ScanMode,
  runtimeOptions?: ToolRuntimeOptions
): Promise<ScanContext> {
  const repo = await detectProject(root, config.paths.exclude);
  return {
    root,
    mode,
    config,
    repo,
    files: buildFileIndex(repo.projectFiles),
    git: { hasGit: repo.hasGit, changedFiles: repo.changedFiles },
    classifyFile: createFileRoleClassifier(config.relevance.fileRoles),
    toolRuntime: createToolRuntime({
      projectRoot: root,
      enabled: config.runtime.managedTools.enabled,
      preferProjectLocal: config.runtime.managedTools.preferProjectLocal,
      allowNetwork: config.runtime.managedTools.allowNetwork,
      cacheDir: config.runtime.managedTools.cacheDir,
      ...runtimeOptions
    })
  };
}
