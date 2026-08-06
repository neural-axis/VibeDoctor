import express from "express";

const app = express();

export type User = { email: string; phone: string };

app.get("/me", async (_req, res) => {
  const user: User = { email: "field", phone: "field" };
  res.json({ id: "1", displayName: "member" });
});

export { app };
