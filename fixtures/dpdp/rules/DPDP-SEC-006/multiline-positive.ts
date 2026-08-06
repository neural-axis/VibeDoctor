import express from "express";

const app = express();

app.get(
  "/users/:id",
  (req, res) => {
    res.json({ id: req.params.id, email: "field" });
  }
);

export { app };
