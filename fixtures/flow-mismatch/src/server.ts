import type { IncomingMessage, ServerResponse } from "node:http";

const app = {
  get(path: string, handler: (req: IncomingMessage, res: ServerResponse) => void) {
    return { path, handler };
  }
};

app.get("/api/user", (_req, res) => {
  res.end("[]");
});
