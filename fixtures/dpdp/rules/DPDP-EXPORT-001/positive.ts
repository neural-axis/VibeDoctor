import express from "express";

const app = express();

export type User = { email: string; phone: string };

app.get("/export-data", (_req, res) => {
  const user: User = { email: "demo@example.com", phone: "9999999999" };
  res.json(user);
});

export { app };
