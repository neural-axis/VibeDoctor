import { mcpTools } from "./tools";

type JsonRpcId = number | string | null;

type JsonRpcRequest = {
  jsonrpc?: string;
  id?: JsonRpcId;
  method?: string;
  params?: Record<string, unknown>;
};

function writeMessage(payload: Record<string, unknown>): void {
  const body = JSON.stringify(payload);
  process.stdout.write(`Content-Length: ${Buffer.byteLength(body, "utf8")}\r\n\r\n${body}`);
}

function writeResult(id: JsonRpcId, result: Record<string, unknown>): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    result
  });
}

function writeError(id: JsonRpcId, code: number, message: string): void {
  writeMessage({
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message
    }
  });
}

function parseMessages(buffer: Buffer<ArrayBufferLike>): { messages: JsonRpcRequest[]; remaining: Buffer<ArrayBufferLike> } {
  const messages: JsonRpcRequest[] = [];
  let cursor = buffer;

  while (cursor.length > 0) {
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

    messages.push(JSON.parse(cursor.subarray(bodyStart, bodyEnd).toString("utf8")) as JsonRpcRequest);
    cursor = cursor.subarray(bodyEnd);
  }

  return { messages, remaining: cursor };
}

async function handleRequest(root: string, request: JsonRpcRequest): Promise<void> {
  const id = request.id ?? null;

  if (!request.method) {
    if (request.id !== undefined) {
      writeError(id, -32600, "Invalid request");
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
            version: "0.1.0"
          },
          capabilities: {
            tools: {}
          }
        });
        return;
      case "notifications/initialized":
        return;
      case "ping":
        writeResult(id, {});
        return;
      case "tools/list":
        writeResult(id, {
          tools: mcpTools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema
          }))
        });
        return;
      case "tools/call": {
        const toolName = request.params?.name;
        if (typeof toolName !== "string") {
          writeError(id, -32602, "Tool name is required");
          return;
        }

        const tool = mcpTools.find((candidate) => candidate.name === toolName);
        if (!tool) {
          writeError(id, -32601, `Unknown tool: ${toolName}`);
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
        });
        return;
      }
      default:
        writeError(id, -32601, `Unsupported method: ${request.method}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeError(id, -32000, message);
  }
}

export async function runMcpServer(root: string): Promise<void> {
  let buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);

  process.stdin.on("data", async (chunk: Buffer<ArrayBufferLike>) => {
    try {
      buffer = Buffer.concat([buffer, chunk]);
      const parsed = parseMessages(buffer);
      buffer = parsed.remaining;

      for (const message of parsed.messages) {
        await handleRequest(root, message);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeError(null, -32700, message);
      buffer = Buffer.alloc(0);
    }
  });

  process.stdin.resume();
  await new Promise<void>((resolve) => {
    process.stdin.on("end", () => resolve());
    process.stdin.on("close", () => resolve());
  });
}
