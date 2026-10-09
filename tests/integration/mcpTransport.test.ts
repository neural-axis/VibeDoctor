import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { version } from "../../package.json";

async function exchange(chunks: (string | Buffer)[]): Promise<string> {
  const child = spawn(process.execPath, ["--import", "tsx", path.resolve("src/cli/index.ts"), "mcp"], {
    stdio: ["pipe", "pipe", "pipe"]
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (data: string) => { stdout += data; });
  child.stderr.setEncoding("utf8").on("data", (data: string) => { stderr += data; });
  const done = new Promise<string>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(`MCP exited ${code}: ${stderr}`)));
  });
  for (const chunk of chunks) {
    child.stdin.write(chunk);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  child.stdin.end();
  try { return await done; } finally { child.kill(); }
}

const initialize = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "test", version: "1" } } };
const list = { jsonrpc: "2.0", id: 2, method: "tools/list" };
const legacy = (message: object) => {
  const body = JSON.stringify(message);
  return `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
};

describe("MCP stdio transport", () => {
  it("initializes and introspects over standard newline JSON without replying to notifications", async () => {
    const output = await exchange([`${JSON.stringify(initialize)}\n${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n${JSON.stringify(list)}\n`]);
    const messages = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(messages.map((message) => message.id)).toEqual([1, 2]);
    expect(messages[0].result.serverInfo).toEqual({ name: "vibedoctor", version });
    expect(messages[1].result.tools.length).toBeGreaterThan(0);
    expect(messages[1].result.tools.every((tool: any) => tool.name && tool.inputSchema.type === "object")).toBe(true);
  });

  it("handles fragmented UTF-8 input, CRLF, and blank lines", async () => {
    const input = Buffer.from(`\n${JSON.stringify({ ...initialize, id: "診断" })}\r\n`);
    const utf8Start = input.indexOf(Buffer.from("診"));
    const output = await exchange([input.subarray(0, utf8Start + 1), input.subarray(utf8Start + 1, input.length - 1), input.subarray(input.length - 1)]);
    expect(JSON.parse(output).id).toBe("診断");
  });

  it("preserves Content-Length framing for existing clients with fragmented headers and bodies", async () => {
    const input = legacy({ ...initialize, id: "診断" }) + legacy(list);
    const output = Buffer.from(await exchange([input.slice(0, 7), input.slice(7, 44), input.slice(44)]));
    const messages = [];
    let cursor = output;
    while (cursor.length) {
      const end = cursor.indexOf("\r\n\r\n");
      expect(end).toBeGreaterThan(0);
      const length = Number(cursor.subarray(0, end).toString().match(/Content-Length: (\d+)/)?.[1]);
      messages.push(JSON.parse(cursor.subarray(end + 4, end + 4 + length).toString()));
      cursor = cursor.subarray(end + 4 + length);
    }
    expect(messages.map((message) => message.id)).toEqual(["診断", 2]);
    expect(messages[1].result.tools.length).toBeGreaterThan(0);
  });

  it("reports invalid input and still processes the next request", async () => {
    const output = await exchange([`{invalid}\nnull\n${JSON.stringify({ jsonrpc: "2.0", id: 3, method: "ping" })}\n`]);
    const messages = output.trim().split("\n").map((line) => JSON.parse(line));
    expect(messages[0].error.code).toBe(-32700);
    expect(messages[1].error.code).toBe(-32600);
    expect(messages[2]).toEqual({ jsonrpc: "2.0", id: 3, result: {} });
  });
});
