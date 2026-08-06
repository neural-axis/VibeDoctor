import express from "express";

const app = express();

app.get("/me", async (_req, res) => {
  const user = { email: "x", phone: "y", pan: "z" };
  res.json(user);
});

export { app };
