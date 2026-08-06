import express from "express";

const app = express();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.headers.authorization) {
    return res.status(401).end();
  }
  return next();
}

export type User = { email: string };

app.get("/export-data", requireAuth, (req, res) => {
  res.json({ email: "[redacted]", request_id: String(req.headers["x-request-id"] ?? "r1") });
});

export { app };
