import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileIndex } from "./scanContext";

export type HttpCall = {
  file: string;
  line: number;
  method: string;
  /** False when fetch() had no visible method — do not guess GET. */
  methodExplicit: boolean;
  path: string;
  dynamic: boolean;
  absolute: boolean;
};

export type RouteDef = {
  file: string;
  line: number;
  method: string;
  path: string;
  /** Simple identifier used as the handler, when one is visible. */
  handler?: string;
  /** True when the handler is `controllers.create` or similar — not statically bound. */
  handlerMember?: boolean;
  handlerFile?: string;
  handlerLine?: number;
  handlerExternal?: boolean;
};

export type ImportEdge = {
  from: string;
  specifier: string;
  names: string[];
  external: boolean;
};

export type SymbolDef = {
  file: string;
  name: string;
  kind: "function" | "class" | "route" | "handler";
  line: number;
  exported: boolean;
};

export type CallSite = {
  file: string;
  callee: string;
  line: number;
};

export type ErrorPath = {
  file: string;
  line: number;
  kind: "empty_handler" | "success_after_failure";
  detail: string;
};

export type RepoGraph = {
  files: string[];
  imports: ImportEdge[];
  symbols: SymbolDef[];
  calls: CallSite[];
  httpCalls: HttpCall[];
  routes: RouteDef[];
  errorPaths: ErrorPath[];
};

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".py"]);
const MAX_FILE_BYTES = 512_000;

function normalizeMethod(method: string): string {
  return method.toUpperCase();
}

export function normalizeRoutePath(raw: string): string {
  const withoutQuery = raw.split("?")[0].trim();
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  return withSlash
    .replace(/\/+$/, "")
    .replace(/\{[^}]+\}/g, ":param")
    .replace(/:[A-Za-z_][\w]*/g, ":param")
    .replace(/\[[^\]]+\]/g, ":param")
    || "/";
}

function stripCommonApiPrefix(normalized: string): string {
  return normalized.replace(/^\/api(?=\/|$)/, "") || "/";
}

export function pathsCompatible(left: string, right: string): boolean {
  const a = normalizeRoutePath(left);
  const b = normalizeRoutePath(right);
  if (a === b) {
    return true;
  }
  // SPA clients typically call /api/users while Express mounts /users.
  return stripCommonApiPrefix(a) === stripCommonApiPrefix(b);
}

function isCommentLine(line: string, python: boolean): boolean {
  const trimmed = line.trim();
  return python ? trimmed.startsWith("#") : trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

function parseJsTs(file: string, content: string): Pick<RepoGraph, "imports" | "symbols" | "calls" | "httpCalls" | "routes" | "errorPaths"> {
  const imports: ImportEdge[] = [];
  const symbols: SymbolDef[] = [];
  const calls: CallSite[] = [];
  const httpCalls: HttpCall[] = [];
  const routes: RouteDef[] = [];
  const errorPaths: ErrorPath[] = [];
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    if (isCommentLine(line, false)) {
      continue;
    }

    imports.push(...parseJsImports(file, line));

    const fnMatch = /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/.exec(line);
    if (fnMatch) {
      symbols.push({ file, name: fnMatch[1], kind: "function", line: lineNo, exported: /^\s*export\b/.test(line) });
    }

    const constFn = /(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*=>)/.exec(line);
    if (constFn) {
      symbols.push({ file, name: constFn[1], kind: "function", line: lineNo, exported: /^\s*export\b/.test(line) });
    }

    const exportList = /^\s*export\s*\{([^}]+)\}/.exec(line);
    if (exportList) {
      for (const raw of exportList[1].split(",")) {
        const local = raw.trim().split(/\s+as\s+/)[0]?.trim();
        const existing = symbols.find((symbol) => symbol.file === file && symbol.name === local);
        if (existing) {
          existing.exported = true;
        }
      }
    }

    for (const callMatch of line.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) {
      if (!/^(if|for|while|switch|catch|function|return|async)$/.test(callMatch[1])) {
        calls.push({ file, callee: callMatch[1], line: lineNo });
      }
    }

    const fetchMatch =
      /\bfetch\s*\(\s*(['"`])([^'"`]+)\1/.exec(line) ??
      /\baxios\.(get|post|put|patch|delete)\s*\(\s*(['"`])([^'"`]+)\2/i.exec(line);
    if (fetchMatch) {
      const method = fetchMatch.length === 4 ? fetchMatch[1] : methodFromFetchOptions(lines, index);
      const rawPath = fetchMatch.length === 4 ? fetchMatch[3] : fetchMatch[2];
      httpCalls.push(httpCallFrom(file, lineNo, method, rawPath, line));
    }

    const routeMatch =
      /\b(?:app|router|server)\.(get|post|put|patch|delete|all)\s*\(\s*(['"`])([^'"`]+)\2\s*(?:,\s*(?:async\s+)?([A-Za-z_$][\w$]*)(\.[A-Za-z_$][\w$]*)?)?/i.exec(
        line
      );
    if (routeMatch && /get|post|put|patch|delete|all/i.test(routeMatch[1])) {
      const handlerName = routeMatch[4];
      const reserved = handlerName && /^(function|async|await|return|if)$/i.test(handlerName);
      routes.push({
        file,
        line: lineNo,
        method: normalizeMethod(routeMatch[1] === "all" ? "*" : routeMatch[1]),
        path: routeMatch[3],
        handler: reserved ? undefined : handlerName,
        handlerMember: Boolean(routeMatch[5])
      });
    }

    const exportedHandler = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/.exec(line);
    if (exportedHandler) {
      const fromFile = fileBasedRoute(file);
      if (fromFile) {
        routes.push({
          file,
          line: lineNo,
          method: exportedHandler[1],
          path: fromFile,
          handler: exportedHandler[1],
          handlerFile: file,
          handlerLine: lineNo
        });
        symbols.push({ file, name: exportedHandler[1], kind: "handler", line: lineNo, exported: true });
      }
    }
  }

  errorPaths.push(...detectJsErrorPaths(file, content));
  return { imports, symbols, calls, httpCalls, routes, errorPaths };
}

function parsePython(file: string, content: string): Pick<RepoGraph, "imports" | "symbols" | "calls" | "httpCalls" | "routes" | "errorPaths"> {
  const imports: ImportEdge[] = [];
  const symbols: SymbolDef[] = [];
  const calls: CallSite[] = [];
  const httpCalls: HttpCall[] = [];
  const routes: RouteDef[] = [];
  const errorPaths: ErrorPath[] = [];
  const pendingPythonRoute = new Map<string, RouteDef>();
  const lines = content.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    if (isCommentLine(line, true)) {
      continue;
    }

    const fromImport = /^\s*from\s+([\w.]+)\s+import\s+(.+)$/.exec(line);
    if (fromImport) {
      const names = fromImport[2]
        .split(",")
        .map((part) => part.trim().split(/\s+as\s+/).pop()?.trim())
        .filter((name): name is string => Boolean(name) && name !== "*");
      imports.push({ from: file, specifier: fromImport[1], names, external: !fromImport[1].startsWith(".") });
    } else {
      const importMatch = /^\s*import\s+([\w.]+)/.exec(line);
      if (importMatch) {
        imports.push({ from: file, specifier: importMatch[1], names: [importMatch[1].split(".").pop() ?? importMatch[1]], external: !importMatch[1].startsWith(".") });
      }
    }

    const fnMatch = /^\s*(?:async\s+)?def\s+([A-Za-z_][\w]*)/.exec(line);
    if (fnMatch) {
      symbols.push({ file, name: fnMatch[1], kind: "function", line: lineNo, exported: true });
      const pending = pendingPythonRoute.get(file);
      if (pending) {
        pending.handler = fnMatch[1];
        pending.handlerFile = file;
        pending.handlerLine = lineNo;
        pendingPythonRoute.delete(file);
      }
    }

    for (const callMatch of line.matchAll(/\b([A-Za-z_][\w]*)\s*\(/g)) {
      if (!/^(if|for|while|except|def|return|print|len|range)$/.test(callMatch[1])) {
        calls.push({ file, callee: callMatch[1], line: lineNo });
      }
    }

    const client = /\b(?:requests|httpx)\.(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]+)\2/i.exec(line);
    if (client) {
      httpCalls.push(httpCallFrom(file, lineNo, client[1], client[3], line));
    }

    const decorator = /@(?:app|router|api)\.(get|post|put|patch|delete)\s*\(\s*(['"])([^'"]+)\2/i.exec(line);
    if (decorator) {
      const route: RouteDef = { file, line: lineNo, method: normalizeMethod(decorator[1]), path: decorator[3] };
      routes.push(route);
      pendingPythonRoute.set(file, route);
    }

    const flask = /\b(?:app|blueprint)\.add_url_rule\s*\(\s*(['"])([^'"]+)\1[^)]*methods\s*=\s*\[[^\]]*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(
      line
    );
    if (flask) {
      routes.push({ file, line: lineNo, method: normalizeMethod(flask[3]), path: flask[2] });
    }
  }

  errorPaths.push(...detectPyErrorPaths(file, content));
  return { imports, symbols, calls, httpCalls, routes, errorPaths };
}

function parseJsImports(file: string, line: string): ImportEdge[] {
  const edges: ImportEdge[] = [];

  const named = /import\s+(?:type\s+)?(?:[A-Za-z_$][\w$]*\s*,\s*)?\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/.exec(line);
  if (named) {
    const names = named[1]
      .split(",")
      .map((part) => {
        const bits = part.trim().split(/\s+as\s+/);
        return (bits[1] ?? bits[0])?.trim();
      })
      .filter((name): name is string => Boolean(name));
    edges.push({ from: file, specifier: named[2], names, external: !named[2].startsWith(".") });
  }

  const def = /import\s+(?:type\s+)?([A-Za-z_$][\w$]*)\s+from\s+['"]([^'"]+)['"]/.exec(line);
  if (def) {
    edges.push({ from: file, specifier: def[2], names: [def[1]], external: !def[2].startsWith(".") });
  }

  const req = /require\s*\(\s*['"]([^'"]+)['"]/.exec(line);
  if (req && !named && !def) {
    edges.push({ from: file, specifier: req[1], names: [], external: !req[1].startsWith(".") });
  }

  return edges;
}

const JS_RESOLVE_EXTS = [".ts", ".tsx", ".js", ".jsx", ""];

function resolveSpecifier(fromFile: string, specifier: string, files: Set<string>): string | undefined {
  if (!specifier.startsWith(".")) {
    return undefined;
  }
  const fromDir = fromFile.includes("/") ? fromFile.slice(0, fromFile.lastIndexOf("/")) : "";
  const joined = path.posix.normalize(`${fromDir}/${specifier}`).replace(/^\.\//, "");
  const candidates = [
    ...JS_RESOLVE_EXTS.map((ext) => `${joined}${ext}`),
    `${joined}/index.ts`,
    `${joined}/index.js`,
    `${joined}/index.tsx`,
    `${joined}.py`
  ];
  return candidates.find((candidate) => files.has(candidate));
}

export function linkRepoGraph(graph: RepoGraph): RepoGraph {
  const files = new Set(graph.files);

  for (const route of graph.routes) {
    const handlerName = route.handler;
    if (!handlerName || route.handlerMember || route.handlerFile) {
      continue;
    }

    const local = graph.symbols.find((symbol) => symbol.file === route.file && symbol.name === handlerName);
    if (local) {
      route.handlerFile = local.file;
      route.handlerLine = local.line;
      continue;
    }

    const imported = graph.imports.find((edge) => edge.from === route.file && edge.names.includes(handlerName));
    if (imported?.external) {
      route.handlerExternal = true;
      continue;
    }
    if (imported) {
      const target = resolveSpecifier(route.file, imported.specifier, files);
      if (target) {
        const remote = graph.symbols.find((symbol) => symbol.file === target && symbol.name === handlerName);
        if (remote) {
          route.handlerFile = remote.file;
          route.handlerLine = remote.line;
        }
      }
    }
  }

  return graph;
}

function methodFromFetchOptions(lines: string[], startIndex: number): string | undefined {
  for (let index = startIndex; index < lines.length && index < startIndex + 10; index += 1) {
    const match = /method\s*:\s*['"](GET|POST|PUT|PATCH|DELETE)['"]/i.exec(lines[index]);
    if (match) {
      return match[1];
    }
    if (index > startIndex && /^\s*\)\s*;?\s*$/.test(lines[index])) {
      break;
    }
  }
  return undefined;
}

function httpCallFrom(
  file: string,
  line: number,
  method: string | undefined,
  rawPath: string,
  sourceLine: string
): HttpCall {
  const dynamic = /\$\{|%[sdf]|f["']/.test(rawPath) || /\$\{/.test(sourceLine);
  const absolute = /^https?:\/\//i.test(rawPath);
  return {
    file,
    line,
    method: normalizeMethod(method ?? "GET"),
    methodExplicit: Boolean(method),
    path: rawPath,
    dynamic,
    absolute
  };
}

function fileBasedRoute(file: string): string | undefined {
  const posix = file.replaceAll("\\", "/");
  const appApi = /(?:^|\/)app\/(api\/.+)\/route\.(t|j)sx?$/.exec(posix);
  if (appApi) {
    return `/${appApi[1]}`.replace(/\/route$/, "");
  }
  const pagesApi = /(?:^|\/)pages\/(api\/.+)\.(t|j)sx?$/.exec(posix);
  if (pagesApi) {
    return `/${pagesApi[1]}`;
  }
  return undefined;
}

function detectJsErrorPaths(file: string, content: string): ErrorPath[] {
  const findings: ErrorPath[] = [];
  const emptyCatch = /catch\s*(?:\([^)]*\))?\s*\{\s*\}/g;
  let match: RegExpExecArray | null;
  while ((match = emptyCatch.exec(content))) {
    findings.push({
      file,
      line: lineNumberAt(content, match.index),
      kind: "empty_handler",
      detail: "Empty catch swallows the error."
    });
  }

  const successAfter =
    /catch\s*(?:\([^)]*\))?\s*\{[^}]*(?:status\s*\(\s*20\d\s*\)|\bok\s*:\s*true|\bsuccess\s*:\s*true)[^}]*\}/gis;
  while ((match = successAfter.exec(content))) {
    findings.push({
      file,
      line: lineNumberAt(content, match.index),
      kind: "success_after_failure",
      detail: "Caught failure then emitted an HTTP 2xx or success payload."
    });
  }

  return findings;
}

function detectPyErrorPaths(file: string, content: string): ErrorPath[] {
  const findings: ErrorPath[] = [];
  const lines = content.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*except\b/.test(lines[index])) {
      continue;
    }
    const body: string[] = [];
    let cursor = index + 1;
    const indent = /^\s*/.exec(lines[index])?.[0].length ?? 0;
    while (cursor < lines.length) {
      const next = lines[cursor];
      if (next.trim() === "") {
        cursor += 1;
        continue;
      }
      const nextIndent = /^\s*/.exec(next)?.[0].length ?? 0;
      if (nextIndent <= indent) {
        break;
      }
      body.push(next.trim());
      cursor += 1;
    }
    const meaningful = body.filter((line) => line && !line.startsWith("#"));
    if (meaningful.length === 0 || meaningful.every((line) => line === "pass" || line === "...")) {
      findings.push({
        file,
        line: index + 1,
        kind: "empty_handler",
        detail: "except handler is empty or only pass."
      });
    } else if (meaningful.some((line) => /return\s+.*\b(200|ok\s*=\s*True|success)/i.test(line))) {
      findings.push({
        file,
        line: index + 1,
        kind: "success_after_failure",
        detail: "except handler returns a success response."
      });
    }
  }
  return findings;
}

function lineNumberAt(content: string, index: number): number {
  return content.slice(0, index).split(/\r?\n/).length;
}

export async function buildRepoGraph(root: string, files: FileIndex | readonly string[]): Promise<RepoGraph> {
  const list = "files" in files ? [...files.files] : [...files];
  const graph: RepoGraph = {
    files: [],
    imports: [],
    symbols: [],
    calls: [],
    httpCalls: [],
    routes: [],
    errorPaths: []
  };

  for (const file of list) {
    const ext = path.extname(file).toLowerCase();
    if (!SOURCE_EXTS.has(ext)) {
      continue;
    }
    const absolute = path.join(root, file);
    let content: string;
    try {
      const stat = await fs.stat(absolute);
      if (stat.size > MAX_FILE_BYTES) {
        continue;
      }
      content = await fs.readFile(absolute, "utf8");
    } catch {
      continue;
    }

    graph.files.push(file);
    const parsed = ext === ".py" ? parsePython(file, content) : parseJsTs(file, content);
    graph.imports.push(...parsed.imports);
    graph.symbols.push(...parsed.symbols);
    graph.calls.push(...parsed.calls);
    graph.httpCalls.push(...parsed.httpCalls);
    graph.routes.push(...parsed.routes);
    graph.errorPaths.push(...parsed.errorPaths);
  }

  return linkRepoGraph(graph);
}

export function routeMatchesCall(call: HttpCall, route: RouteDef): boolean {
  if (call.dynamic || !call.methodExplicit) {
    return false;
  }
  if (route.method !== "*" && route.method !== call.method) {
    return false;
  }
  return pathsCompatible(call.path, route.path);
}
