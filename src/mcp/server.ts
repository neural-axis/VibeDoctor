import { mcpTools } from "./tools";

const { version } = require("../../package.json") as { version: string };
type Framing = "newline" | "content-length";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

function writeMessage(payload: Record<string, unknown>, framing: Framing): void {
  const body = JSON.stringify(payload);
  process.stdout.write(framing === "newline" ? `${body}\n` : `Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function writeResult(id: JsonRpcId, result: Record<string, unknown>, framing: Framing): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result
  }, framing);
}

function writeError(id: JsonRpcId, code: number, message: string, framing: Framing): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  }, framing);
}

function parseMessages(buffer: Buffer<ArrayBufferLike>): {
  messages: { body: string; framing: Framing }[];
  remaining: Buffer<ArrayBufferLike>;
} {
  const messages: { body: string; framing: Framing }[] = [];
  let cursor = buffer;

  while (cursor.length > 0) {
    // Standard MCP stdio uses one JSON message per line. Preserve the original
    // header framing for clients that already use VibeDoctor's legacy transport.
    const prefix = cursor.subarray(0, Math.min(cursor.length, 15)).toString("ascii").toLowerCase();
    if (!"content-length:".startsWith(prefix) && !prefix.startsWith("content-length:")) {
      const lineEnd = cursor.indexOf("\n");
      if (lineEnd === -1) break;
      const body = cursor.subarray(0, lineEnd).toString("utf8").trim();
      cursor = cursor.subarray(lineEnd + 1);
      if (body) messages.push({ body, framing: "newline" });
      continue;
    }
    const headerEnd = cursor.indexOf("\r\n\r\n");
    if (headerEnd === -1) {
      break;
    }

    const header = cursor.subarray(0, headerEnd).toString("utf8");
    const match = header.match(/Content-Length:\s*(\d+)/i);
    if (!match) {
      throw new Error("Missing Content-Length header");
    }

    const length = Number.parseInt(match[1], 10);
    const bodyStart = headerEnd + 4;
    const bodyEnd = bodyStart + length;

    if (cursor.length < bodyEnd) {
      break;
    }

    messages.push({ body: cursor.subarray(bodyStart, bodyEnd).toString("utf8"), framing: "content-length" });
    cursor = cursor.subarray(bodyEnd);
  }

  return { messages, remaining: cursor };
}

async function handleRequest(root: string, request: JsonRpcRequest, framing: Framing): Promise<void> {
  const id = request.id ?? null;

  if (!request.method) {
    if (request.id !== undefined) {
      writeError(id, -32600, "Invalid request", framing);
    }
    return;
  }

  try {
    switch (request.method) {
      case "initialize":
        writeResult(id, {
          protocolVersion: "2024-11-05",
          serverInfo: {
            name: "vibedoctor",
            version
          },
          capabilities: {
            tools: {}
          }
        }, framing);
        return;
      case "notifications/initialized":
        return;
      case "ping":
        writeResult(id, {}, framing);
        return;
      case "tools/list":
        writeResult(id, {
          tools: mcpTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        }, framing);
        return;
      case "tools/call": {
        const toolName = request.params?.name;
        if (typeof toolName !== "string") {
          writeError(id, -32602, "Tool name is required", framing);
          return;
        }

        const tool = mcpTools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          writeError(id, -32601, `Unknown tool: ${toolName}`, framing);
          return;
        }

        const args = request.params?.arguments;
        const result = await tool.call(root, (typeof args === "object" && args !== null ? args : {}) as Record<string, unknown>);
        writeResult(id, {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ],
          structuredContent: result
        }, framing);
        return;
      }
      default:
        if (request.id !== undefined) writeError(id, -32601, `Unsupported method: ${request.method}`, framing);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(id, -32000, message, framing);
  }
}

export async function runMcpServer(root: string): Promise<void> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  for await (const chunk of process.stdin) {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseMessages(buffer);
      buffer = parsed.remaining;

      for (const { body, framing } of parsed.messages) {
        let request: JsonRpcRequest;
        try {
          request = JSON.parse(body) as JsonRpcRequest;
        } catch {
          writeError(null, -32700, "Invalid JSON", framing);
          continue;
        }
        if (typeof request !== "object" || request === null || Array.isArray(request)) {
          writeError(null, -32600, "Invalid request", framing);
          continue;
        }
        await handleRequest(root, request, framing);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeError(null, -32700, message, "newline");
      buffer = Buffer.alloc(0);
    }
  }
}
