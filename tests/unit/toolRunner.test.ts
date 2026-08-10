import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCommandEnv, quoteForWindowsShell, runCommand } from "../../src/core/toolRunner";

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
  it("adds Python user scripts to the Windows command search path", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const appData = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-appdata-"));
    const scripts = path.join(appData, "Python", "Python312", "Scripts");
    await fs.mkdir(scripts, { recursive: true });

    const env = buildCommandEnv(undefined, { APPDATA: appData, PATH: "original-path" });

    expect(env.PATH).toContain(scripts);
  });

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

  it("passes wildcard arguments literally to Windows executables", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const result = await runCommand({
      cmd: process.execPath,
      args: ["-e", "console.log(process.argv[1])", "node_modules/**"],
      cwd: process.cwd()
    });

    expect(result.status).toBe("ok");
    expect(result.stdout.trim()).toBe("node_modules/**");
  });
});

describe("quoteForWindowsShell", () => {
  it("leaves ordinary arguments exactly as they were", () => {
    for (const argument of ["--json", "src/core/engine.ts", "--max-warnings=0", "node_modules/**", "a,b;c"]) {
      expect(quoteForWindowsShell(argument)).toBe(argument);
    }
  });

  it("quotes arguments the shell would otherwise split or interpret", () => {
    // Without quoting, cmd.exe splits this into two arguments.
    expect(quoteForWindowsShell("C:\\Program Files\\repo")).toBe('"C:\\Program Files\\repo"');
    // Without quoting, cmd.exe treats these as command separators and redirection.
    expect(quoteForWindowsShell("a&b")).toBe('"a&b"');
    expect(quoteForWindowsShell("rule|other")).toBe('"rule|other"');
    expect(quoteForWindowsShell("out>file")).toBe('"out>file"');
    expect(quoteForWindowsShell("")).toBe('""');
  });

  it("keeps a percent sign from expanding as an environment variable", () => {
    // Quotes alone do not stop %PATH% expanding on a cmd.exe command line.
    expect(quoteForWindowsShell("100% done")).toBe('"100"^%" done"');
  });

  it("escapes backslashes before quotes so the argument survives argv parsing", () => {
    expect(quoteForWindowsShell('say "hi"')).toBe('"say \\"hi\\""');
    // Only backslashes that precede a quote are doubled; a path separator
    // followed by anything else is already literal.
    expect(quoteForWindowsShell('dir\\ "x"')).toBe('"dir\\ \\"x\\""');
    expect(quoteForWindowsShell('c:\\dir\\"x"')).toBe('"c:\\dir\\\\\\"x\\""');
  });

  it("delivers an argument containing shell metacharacters intact through a .cmd shim", async () => {
    if (process.platform !== "win32") {
      return;
    }

    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vibedoctor-shell-args-"));
    const binDir = path.join(root, "node_modules", ".bin");
    await fs.mkdir(binDir, { recursive: true });
    await fs.writeFile(
      path.join(root, "echo-args.js"),
      "console.log(process.argv.slice(2).join(String.fromCharCode(124)));\n",
      "utf8"
    );
    // A shim in the shape npm writes: a .cmd file that must go through cmd.exe
    // and forwards its arguments on.
    await fs.writeFile(
      path.join(binDir, "vibedoctor-echo-args.cmd"),
      `@echo off\r\n"${process.execPath}" "${path.join(root, "echo-args.js")}" %*\r\n`,
      "utf8"
    );

    const result = await runCommand({
      cmd: "vibedoctor-echo-args",
      args: ["--pattern", "a&b", "C:\\Program Files\\repo", "100% done"],
      cwd: root
    });

    expect(result.status).toBe("ok");
    expect(result.stdout.trim()).toBe("--pattern|a&b|C:\\Program Files\\repo|100% done");
  });
});
