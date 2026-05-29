import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../../src/core/toolRunner";

async function writeLocalCommand(root: string, segments: string[], name: string): Promise<void> {
  const binDir = path.join(root, ...segments);
  await fs.mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    await fs.writeFile(path.join(binDir, `${name}.cmd`), `@echo off\necho ${name}-ok\n`, "utf8");
    return;
  }

  const commandPath = path.join(binDir, name);
  await fs.writeFile(commandPath, `#!/bin/sh\necho ${name}-ok\n`, "utf8");
  await fs.chmod(commandPath, 0o755);
}

describe("runCommand", () => {
  it("marks missing commands as skipped", async () => {
    const result = await runCommand({
      cmd: "definitely-missing-vibedoctor-command",
      args: []
    });

    expect(result.status).toBe("skipped");
  });

  it("marks long-running commands as timeout", async () => {
    const result = await runCommand({
      cmd: process.execPath,
      args: ["-e", "setTimeout(() => {}, 500);"],
      timeoutMs: 50
    });

    expect(result.status).toBe("timeout");
  });

  it("finds local node_modules binaries without manual PATH edits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-local-node-bin-"));
    await writeLocalCommand(root, ["node_modules", ".bin"], "vibedoctor-local-node-tool");

    const result = await runCommand({
      cmd: "vibedoctor-local-node-tool",
      args: [],
      cwd: root
    });

    expect(result.status).toBe("ok");
    expect(result.stdout).toContain("vibedoctor-local-node-tool-ok");
  });

  it("finds local virtualenv binaries without manual PATH edits", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-local-venv-bin-"));
    const venvBin = process.platform === "win32" ? [".venv", "Scripts"] : [".venv", "bin"];
    await writeLocalCommand(root, venvBin, "vibedoctor-local-venv-tool");

    const result = await runCommand({
      cmd: "vibedoctor-local-venv-tool",
      args: [],
      cwd: root
    });

    expect(result.status).toBe("ok");
    expect(result.stdout).toContain("vibedoctor-local-venv-tool-ok");
  });
});
