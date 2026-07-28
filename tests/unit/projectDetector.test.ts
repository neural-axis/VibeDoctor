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
  it("respects configured exclusions when detecting project languages", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-project-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.mkdir(path.join(root, "fixtures", "python"), { recursive: true });
    await fs.writeFile(path.join(root, "src", "index.ts"), "export const value = 1;\n");
    await fs.writeFile(path.join(root, "fixtures", "python", "app.py"), "print('fixture')\n");

    const project = await detectProject(root, ["fixtures/**"]);

    expect(project.languages).toEqual(["typescript"]);
    expect(project.projectFiles).toContain("fixtures/python/app.py");
  });

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

  it("detects Next.js src/app route files as entrypoints", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-detect-next-"));
    await fs.mkdir(path.join(root, "src", "app", "results"), { recursive: true });
    await fs.writeFile(path.join(root, "package.json"), JSON.stringify({ dependencies: { next: "15.0.0" } }), "utf8");
    await fs.writeFile(path.join(root, "src", "app", "results", "page.tsx"), "export default function Page() { return null; }\n", "utf8");

    const project = await detectProject(root);

    expect(project.frameworkHints).toContain("nextjs");
    expect(project.entryFiles).toContain("src/app/results/page.tsx");
  });

  it("detects monorepo config files located in subdirectories", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-detect-monorepo-"));
    await fs.mkdir(path.join(root, "backend"), { recursive: true });
    await fs.mkdir(path.join(root, "frontend"), { recursive: true });
    await fs.writeFile(path.join(root, "backend", "pyproject.toml"), "[project]\nname=\"backend\"\n", "utf8");
    await fs.writeFile(path.join(root, "backend", "app.py"), "print('hello')\n", "utf8");
    await fs.writeFile(path.join(root, "frontend", "package.json"), JSON.stringify({ name: "frontend" }), "utf8");
    await fs.writeFile(path.join(root, "frontend", "package-lock.json"), JSON.stringify({ lockfileVersion: 3 }), "utf8");
    await fs.writeFile(path.join(root, "frontend", "tsconfig.json"), "{}", "utf8");
    await fs.writeFile(path.join(root, "frontend", "index.ts"), "export const a = 1;\n", "utf8");

    const project = await detectProject(root);

    expect(project.languages).toEqual(["python", "typescript"]);
    expect(project.configFiles).toContain("pyproject.toml");
    expect(project.configFiles).toContain("package.json");
    expect(project.configFiles).toContain("tsconfig.json");
    expect(project.lockfiles).toContain("frontend/package-lock.json");
  });
});
