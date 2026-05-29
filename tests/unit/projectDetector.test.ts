import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { detectProject } from "../../src/core/projectDetector";

async function writeExecutable(root: string, segments: string[], name: string): Promise<void> {
  const binDir = path.join(root, ...segments);
  await fs.mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    await fs.writeFile(path.join(binDir, `${name}.cmd`), "@echo off\n", "utf8");
    return;
  }

  const commandPath = path.join(binDir, name);
  await fs.writeFile(commandPath, "#!/bin/sh\n", "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("detectProject", () => {
  it("detects mixed TypeScript and Python repositories", async () => {
    const root = path.join(process.cwd(), "fixtures", "mixed-monorepo");
    const project = await detectProject(root);

    expect(project.languages).toEqual(["python", "typescript"]);
    expect(project.packageManagers).toContain("uv");
    expect(project.packageManagers).toContain("npm");
  });

  it("ignores dependency and virtualenv folders while detecting project languages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-detect-excludes-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "node_modules", "pkg"), { recursive: true });
    await fs.mkdir(path.join(root, ".venv", "Lib", "site-packages", "pkg"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ scripts: { test: "vitest run" } }), "utf8");
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n", "utf8");
    await fs.writeFile(path.join(root, "node_modules", "pkg", "index.js"), "module.exports = {};\n", "utf8");
    await fs.writeFile(path.join(root, ".venv", "Lib", "site-packages", "pkg", "module.py"), "value = 1\n", "utf8");

    const project = await detectProject(root);

    expect(project.languages).toEqual(["typescript"]);
    expect(project.projectFiles).not.toContain("node_modules/pkg/index.js");
    expect(project.projectFiles).not.toContain(".venv/Lib/site-packages/pkg/module.py");
    expect(project.testCommands).toContain("npm test");
  });

  it("detects local virtualenv tools without manual PATH edits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-detect-local-tool-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "pyproject.toml"), "[project]\nname = \"local-tool\"\n", "utf8");
    await fs.writeFile(path.join(root, "src", "app.py"), "print('ok')\n", "utf8");
    await writeExecutable(root, process.platform === "win32" ? [".venv", "Scripts"] : [".venv", "bin"], "ruff");

    const project = await detectProject(root);

    expect(project.toolsAvailable.ruff).toBe(true);
  });
});
