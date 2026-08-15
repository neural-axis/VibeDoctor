import type { IncomingMessage, ServerResponse } from "node:http";

const app = {
  post(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) {
    return { path, handler };
  }
};

function createUser(_req: IncomingMessage, res: ServerResponse) {
  res.end("ok");
}

app.post("/api/user", createUser);
