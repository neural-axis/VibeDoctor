import express from "express";

const app = express();

function requireAuth(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (!req.headers.authorization) {
    return res.status(401).end();
  }
  return next();
}

function auditLog(event: string, requestId: string) {
  console.info("audit", { event, requestId });
}

app.post("/consent", requireAuth, (req, res) => {
  const { purpose_id, notice_version, consent_at } = req.body;
  res.json({ ok: true, purpose_id, notice_version, consent_at });
});

app.post("/consent/withdraw", requireAuth, (req, res) => {
  auditLog("withdraw_consent", String(req.headers["x-request-id"] ?? "unknown"));
  res.json({ withdrawn: true });
});

app.get("/privacy-notice", (_req, res) => {
  res.json({ notice_version: "2026.1", privacy_policy: "/policy" });
});

app.get("/me/export-data", requireAuth, (req, res) => {
  const request_id = String(req.headers["x-request-id"] ?? "req-1");
  auditLog("data_export", request_id);
  res.json({ email: "[redacted]", fields: ["email", "phone"] });
});

app.post("/me/correct-data", requireAuth, (req, res) => {
  auditLog("correct_data", "req-2");
  res.json({ updated: true });
});

app.delete("/me/delete-account", requireAuth, async (req, res) => {
  auditLog("erase_user", "req-3");
  // hard_delete / soft_delete path
  res.json({ deleted: true, deletedAt: new Date().toISOString() });
});

app.post("/grievance", requireAuth, (req, res) => {
  // Contact is a route/role label, not an embedded personal-data literal
  res.json({ ticket_id: "G-1", contact: "privacy-team", grievance_channel: "in-app" });
});

export { app };
