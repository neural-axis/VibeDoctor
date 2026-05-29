import { normalizeFilePath } from "../core/finding";
import type { ToolAdapter } from "./shared";

type VultureItem = {
  filename: string;
  first_lineno: number;
  size?: number;
  name: string;
  type: string;
  confidence?: number;
};

function parseVulture(stdout: string): VultureItem[] {
  const trimmed = stdout.trim();
  return trimmed ? (JSON.parse(trimmed) as VultureItem[]) : [];
}

function isPackageInitializer(file: string): boolean {
  return file.replaceAll("\\", "/").endsWith("/__init__.py") || file === "__init__.py";
}

export const vultureAdapter: ToolAdapter = {
  id: "vulture",
  category: "dead_code",
  async detect(project) {
    return project.languages.includes("python");
  },
  buildScanCommand(ctx) {
    return {
      cmd: "vulture",
      args: [".", "--json"],
      cwd: ctx.root,
      timeoutMs: 60_000
    };
  },
  parseResult(result, ctx) {
    return parseVulture(result.stdout).map((item) => {
      const packageInitializer = isPackageInitializer(item.filename);

      return {
        id: `vulture:${item.filename}:${item.first_lineno}:${item.name}`,
        source: "vulture" as const,
        category: "dead_code" as const,
        severity: "low" as const,
        confidence: packageInitializer
          ? ("low" as const)
          : (item.confidence ?? 60) >= 90
            ? ("high" as const)
            : (item.confidence ?? 60) >= 70
              ? ("medium" as const)
              : ("low" as const),
        title: packageInitializer ? `Review package initializer ${item.type}` : `Unused ${item.type}`,
        message: packageInitializer
          ? `${item.name} is in a package initializer and needs manual review before removal.`
          : `${item.name} appears unused according to Vulture.`,
        file: normalizeFilePath(item.filename, ctx.root),
        startLine: item.first_lineno,
        isNew: true,
        isAutofixable: false,
        safeToAutofix: false,
        agentInstruction: packageInitializer
          ? "Review this package initializer manually; verify imports, package exports, and framework discovery before changing it."
          : "Treat this as advisory for Python: verify decorators, reflection, and framework registration before deletion.",
        tags: packageInitializer ? ["python", "dead-code", "review-only"] : ["python", "dead-code"],
        scoreImpact: 0
      };
    });
  },
  installHint: "Install Vulture with: pipx install vulture or uv tool install vulture"
};
