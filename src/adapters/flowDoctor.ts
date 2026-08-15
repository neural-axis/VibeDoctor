import type { Finding } from "../core/finding";
import {
  buildRepoGraph,
  pathsCompatible,
  routeMatchesCall,
  type HttpCall,
  type RepoGraph,
  type RouteDef,
  type SymbolDef
} from "../core/repoGraph";
import type { ToolAdapter } from "./shared";

function findingBase(partial: Omit<Finding, "isNew" | "isAutofixable" | "safeToAutofix" | "scoreImpact" | "tags"> & { tags?: string[] }): Finding {
  return {
    isNew: true,
    isAutofixable: false,
    safeToAutofix: false,
    scoreImpact: 0,
    tags: partial.tags ?? ["flow"],
    ...partial
  };
}

function describeRoute(route: RouteDef): string {
  return `${route.method} ${route.path} (${route.file}:${route.line})`;
}

function mismatchFinding(call: HttpCall, routes: RouteDef[], verified: boolean): Finding {
  const available = routes.slice(0, 6).map(describeRoute).join("; ");
  return findingBase({
    id: `flow-doctor:${call.file}:${call.line}:route-mismatch`,
    source: "flow-doctor",
    category: "correctness",
    severity: verified ? "high" : "medium",
    confidence: verified ? "high" : "medium",
    evidenceGrade: verified ? "verified" : "heuristic",
    title: "HTTP call has no matching backend route",
    message: `${call.method} ${call.path} has no matching server route.`,
    file: call.file,
    startLine: call.line,
    agentInstruction: `Add a ${call.method} handler for ${call.path}, or change the client call to a route the server actually exposes.`,
    evidence: { toolRawId: "flow-route-mismatch", detectionPath: available },
    remediation: {
      kind: "code",
      steps: [
        `Align the client ${call.method} ${call.path} call with an existing route, or add that route on the server.`
      ],
      requiredEvidence: "A server handler exists for the same method and path."
    }
  });
}

function heuristicCallFinding(call: HttpCall): Finding {
  return findingBase({
    id: `flow-doctor:${call.file}:${call.line}:dynamic-route`,
    source: "flow-doctor",
    category: "correctness",
    severity: "low",
    confidence: "low",
    evidenceGrade: "heuristic",
    title: "Dynamic HTTP path could not be verified",
    message: `Call uses a constructed path (${call.path}); Flow Doctor cannot prove a route match.`,
    file: call.file,
    startLine: call.line,
    agentInstruction: "Leave this unless a concrete method/path mismatch is visible nearby.",
    evidence: { toolRawId: "flow-dynamic-path" },
    tags: ["flow", "heuristic"]
  });
}

function errorPathFinding(file: string, line: number, kind: "empty_handler" | "success_after_failure", detail: string): Finding {
  const verified = kind === "empty_handler" || kind === "success_after_failure";
  return findingBase({
    id: `flow-doctor:${file}:${line}:${kind}`,
    source: "flow-doctor",
    category: "correctness",
    severity: kind === "success_after_failure" ? "high" : "medium",
    confidence: "high",
    evidenceGrade: verified ? "verified" : "heuristic",
    title: kind === "empty_handler" ? "Swallowed error path" : "Success response after a caught failure",
    message: detail,
    file,
    startLine: line,
    agentInstruction:
      kind === "empty_handler"
        ? "Log, rethrow, or return an explicit error from this handler. Do not leave it empty."
        : "Return a failure status from the catch/except path, or rethrow after recording the error.",
    evidence: { toolRawId: `flow-${kind}` }
  });
}

function missingHandlerFinding(route: RouteDef): Finding {
  return findingBase({
    id: `flow-doctor:${route.file}:${route.line}:missing-handler`,
    source: "flow-doctor",
    category: "correctness",
    severity: "high",
    confidence: "high",
    evidenceGrade: "verified",
    title: "Route handler is not defined",
    message: `${route.method} ${route.path} is wired to ${route.handler}, but that function is not defined or imported.`,
    file: route.file,
    startLine: route.line,
    agentInstruction: `Define ${route.handler} or point this route at a function that exists.`,
    evidence: { toolRawId: "flow-missing-handler" },
    remediation: {
      kind: "code",
      steps: [`Add ${route.handler} in this file or import it, then keep the ${route.method} ${route.path} wiring.`],
      requiredEvidence: `A function named ${route.handler} is defined or imported.`
    }
  });
}

function orphanedHandlerFinding(symbol: SymbolDef): Finding {
  return findingBase({
    id: `flow-doctor:${symbol.file}:${symbol.line}:orphaned-handler`,
    source: "flow-doctor",
    category: "correctness",
    severity: "medium",
    confidence: "high",
    evidenceGrade: "verified",
    title: "Unreachable handler in a route file",
    message: `${symbol.name} is defined next to routes but is never called and is not wired to any route.`,
    file: symbol.file,
    startLine: symbol.line,
    agentInstruction: `Wire ${symbol.name} to a route, call it, or delete it if it is leftover.`,
    evidence: { toolRawId: "flow-orphaned-handler" }
  });
}

function handlerIsBound(route: RouteDef): boolean {
  return Boolean(route.handlerFile || route.handlerExternal || route.handlerMember);
}

function isReferenced(symbol: SymbolDef, graph: RepoGraph): boolean {
  if (graph.routes.some((route) => route.handler === symbol.name && (route.handlerFile === symbol.file || route.file === symbol.file))) {
    return true;
  }
  return graph.calls.some(
    (call) => call.callee === symbol.name && call.file === symbol.file && call.line !== symbol.line
  );
}

export function analyzeFlows(graph: RepoGraph, options: { reportHeuristics?: boolean } = {}): Finding[] {
  const findings: Finding[] = [];
  const reportHeuristics = options.reportHeuristics ?? false;
  const backendPresent = graph.routes.length > 0;

  if (backendPresent) {
    for (const call of graph.httpCalls) {
      if (call.absolute) {
        continue;
      }
      if (call.dynamic || !call.methodExplicit) {
        if (reportHeuristics) {
          findings.push(heuristicCallFinding(call));
        }
        continue;
      }
      const match = graph.routes.some((route) => routeMatchesCall(call, route));
      if (match) {
        continue;
      }
      const samePath = graph.routes.some((route) => pathsCompatible(call.path, route.path));
      // Same path, wrong method is a real bug. Unrelated paths in a monorepo are not.
      if (samePath) {
        findings.push(mismatchFinding(call, graph.routes, true));
      } else if (reportHeuristics) {
        findings.push(mismatchFinding(call, graph.routes, false));
      }
    }
  }

  for (const errorPath of graph.errorPaths) {
    findings.push(errorPathFinding(errorPath.file, errorPath.line, errorPath.kind, errorPath.detail));
  }

  for (const route of graph.routes) {
    if (!route.handler || route.handlerMember || handlerIsBound(route)) {
      continue;
    }
    if (route.handler.length < 2) {
      continue;
    }
    findings.push(missingHandlerFinding(route));
  }

  const routerFiles = new Set(graph.routes.map((route) => route.file));
  for (const symbol of graph.symbols) {
    if (symbol.kind !== "function" || symbol.exported || symbol.name.startsWith("_")) {
      continue;
    }
    if (!routerFiles.has(symbol.file)) {
      continue;
    }
    if (isReferenced(symbol, graph)) {
      continue;
    }
    findings.push(orphanedHandlerFinding(symbol));
  }

  return findings;
}

export const flowDoctorAdapter: ToolAdapter = {
  id: "flow-doctor",
  category: "correctness",
  async detect(project, config) {
    if (config.checks.flowAnalysis.enabled === false) {
      return false;
    }
    return project.languages.length > 0;
  },
  async runStandalone(ctx) {
    const graph = await buildRepoGraph(ctx.root, ctx.project.projectFiles);
    return { findings: analyzeFlows(graph) };
  },
  installHint: "Built-in Flow Doctor. No external install."
};
