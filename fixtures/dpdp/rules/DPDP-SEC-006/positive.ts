import express from "express";

const app = express();

app.get("/users/:id", (req, res) => {
  res.json({ id: req.params.id, email: "field-only", profile: true });
});

app.get("/profile", (_req, res) => {
  res.json({ profile: true });
});

export { app };
