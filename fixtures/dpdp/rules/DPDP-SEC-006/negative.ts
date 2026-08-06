import express from "express";

const app = express();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.headers.authorization) {
    return res.status(401).end();
  }
  return next();
}

app.get("/users/:id", requireAuth, (req, res) => {
  res.json({ id: req.params.id });
});

app.get("/profile", requireAuth, (_req, res) => {
  res.json({ profile: true });
});

export { app };
