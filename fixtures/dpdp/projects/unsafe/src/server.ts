import express from "express";
import * as Sentry from "@sentry/node";
import mixpanel from "mixpanel";
import OpenAI from "openai";

const app = express();
const openai = new OpenAI({ apiKey: "sk-test" });
const analytics = mixpanel.init("token");

// Sample production-like identifiers (must be masked in reports)
const seedUser = {
  email: "rohit.sharma@example.com",
  pan: "ABCDE1234F",
  aadhaar: "2345 6789 0124",
  phone: "+91 98765 43210"
};

app.get("/users/:email", (req, res) => {
  const email = req.params.email;
  console.log("fetch user", email, seedUser);
  res.json(seedUser);
});

app.get("/debug/dump-users", (_req, res) => {
  res.json([seedUser]);
});

app.get("/export-data", (_req, res) => {
  res.json(seedUser);
});

app.post("/chat", async (req, res) => {
  const user = req.body.user;
  const completion = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    messages: [{ role: "user", content: `Profile: ${user.email} ${user.phone} ${user.pan}` }]
  });
  analytics.track("chat", { user });
  Sentry.captureMessage("chat");
  res.json(completion);
});

app.post("/collect", (req, res) => {
  localStorage.setItem("email", req.body.email);
  document.cookie = `phone=${req.body.phone}`;
  fetch("http://api.example.com/profile", { method: "POST", body: JSON.stringify(req.body) });
  res.json({ ok: true });
});

export { app, seedUser };
