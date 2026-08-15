import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeFlows } from "../../src/adapters/flowDoctor";
import { buildRepoGraph } from "../../src/core/repoGraph";

async function graphFor(name: string) {
  const root = path.join(process.cwd(), "fixtures", name);
  const files: string[] = [];
  async function walk(dir: string, prefix = "") {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), relative);
      } else {
        files.push(relative);
      }
    }
  }
  await walk(root);
  return buildRepoGraph(root, files);
}

describe("Flow Doctor V1", () => {
  it("detects a client POST whose method/path has no matching backend route", async () => {
    const graph = await graphFor("flow-mismatch");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(true);
    expect(findings.find((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")?.evidenceGrade).toBe(
      "verified"
    );
  });

  it("does not flag a matching route", async () => {
    const graph = await graphFor("flow-match");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(false);
  });

  it("detects swallowed errors and success-after-failure", async () => {
    const graph = await graphFor("flow-swallowed");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-empty_handler")).toBe(true);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-success_after_failure")).toBe(true);
  });

  it("does not treat a commented best-effort catch as a verified swallowed error", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-flow-comment-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "probe.ts"),
      `export function maybe() {
  try {
    return 1;
  } catch {
    // Probe failed; fall back.
  }
}
`,
      "utf8"
    );
    const findings = analyzeFlows(await buildRepoGraph(root, ["src/probe.ts"]));
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-empty_handler")).toBe(false);
  });

  it("detects a route whose named handler is not defined", async () => {
    const graph = await graphFor("flow-handler-missing");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-missing-handler")).toBe(true);
    expect(graph.routes[0]?.handler).toBe("createUser");
    expect(graph.routes[0]?.handlerFile).toBeUndefined();
  });

  it("resolves an imported handler and does not flag it", async () => {
    const graph = await graphFor("flow-handler-wired");
    const findings = analyzeFlows(graph);
    expect(graph.routes[0]?.handlerFile).toBe("src/handlers.ts");
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-missing-handler")).toBe(false);
  });

  it("flags an unexported unused function in a route file", async () => {
    const graph = await graphFor("flow-orphan-handler");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-orphaned-handler" && finding.file?.includes("server.ts"))).toBe(
      true
    );
    expect(findings.some((finding) => finding.message.includes("leftoverHandler"))).toBe(true);
    expect(findings.some((finding) => finding.message.includes("createUser"))).toBe(false);
  });

  it("does not flag an exported unused function as a verified orphan", async () => {
    const graph = await graphFor("flow-orphan-exported");
    const findings = analyzeFlows(graph);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-orphaned-handler")).toBe(false);
  });

  it("does not treat a member-expression handler as a missing identifier", async () => {
    const graph = await graphFor("flow-handler-member");
    const findings = analyzeFlows(graph);
    expect(graph.routes[0]?.handlerMember).toBe(true);
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-missing-handler")).toBe(false);
  });

  it("reads a multiline fetch method instead of guessing GET", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-flow-multiline-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "client.ts"),
      `export async function createUser() {
  await fetch("/api/user", {
    method: "POST",
    headers: { "content-type": "application/json" }
  });
}
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "src", "server.ts"),
      `const app = { post(path: string, handler: () => void) { return { path, handler }; } };
function createUser() {}
app.post("/api/user", createUser);
`,
      "utf8"
    );
    const graph = await buildRepoGraph(root, ["src/client.ts", "src/server.ts"]);
    expect(graph.httpCalls[0]?.method).toBe("POST");
    expect(graph.httpCalls[0]?.methodExplicit).toBe(true);
    expect(analyzeFlows(graph).some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(false);
  });

  it("does not treat helper names like api.get as HTTP clients", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-flow-apiget-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "lib.ts"),
      `export const api = { get(path: string) { return path; } };
api.get("/orders");
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "src", "server.ts"),
      `const app = { get(path: string, handler: () => void) { return { path, handler }; } };
app.get("/health", () => undefined);
`,
      "utf8"
    );
    const graph = await buildRepoGraph(root, ["src/lib.ts", "src/server.ts"]);
    expect(graph.httpCalls).toHaveLength(0);
    expect(analyzeFlows(graph).some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(false);
  });

  it("does not emit a verified mismatch when the client path is unrelated to any route", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-flow-unscoped-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "client.ts"),
      `export async function loadOrders() {
  await fetch("/v1/orders", { method: "GET" });
}
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "src", "server.ts"),
      `const app = { get(path: string, handler: () => void) { return { path, handler }; } };
app.get("/health", () => undefined);
`,
      "utf8"
    );
    const findings = analyzeFlows(await buildRepoGraph(root, ["src/client.ts", "src/server.ts"]));
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(false);
  });

  it("treats /api prefix as the same route family", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "vd-flow-prefix-"));
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(
      path.join(root, "src", "client.ts"),
      `export async function createUser() {
  await fetch("/api/user", { method: "POST" });
}
`,
      "utf8"
    );
    await fs.writeFile(
      path.join(root, "src", "server.ts"),
      `const app = { post(path: string, handler: () => void) { return { path, handler }; } };
function createUser() {}
app.post("/user", createUser);
`,
      "utf8"
    );
    const findings = analyzeFlows(await buildRepoGraph(root, ["src/client.ts", "src/server.ts"]));
    expect(findings.some((finding) => finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(false);
  });

  it("does not label a dynamic path as a verified route mismatch", async () => {
    const graph = await graphFor("flow-heuristic");
    const verified = analyzeFlows(graph);
    expect(verified.some((finding) => finding.evidenceGrade === "verified" && finding.evidence?.toolRawId === "flow-route-mismatch")).toBe(
      false
    );

    const withHeuristic = analyzeFlows(graph, { reportHeuristics: true });
    const heuristic = withHeuristic.find((finding) => finding.evidence?.toolRawId === "flow-dynamic-path");
    expect(heuristic?.evidenceGrade).toBe("heuristic");
  });
});
