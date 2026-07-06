import { promises as fs } from "node:fs";
import path from "node:path";
import { pathExists, readTextIfExists } from "../core/paths";
import type { Finding } from "../core/finding";
import type { ToolAdapter, ToolAdapterContext } from "./shared";

export const telemetryDetectorAdapter: ToolAdapter = {
  id: "telemetry-detector",
  category: "privacy",
  async detect(_project, config) {
    return config.checks.privacy.enabled && config.checks.privacy.detectTelemetryOptOut;
  },
  async runStandalone(ctx) {
    const findings: Finding[] = [];
    const packageFiles = ctx.project.projectFiles.filter((f) => path.basename(f) === "package.json");

    let hasTelemetryFramework = false;
    let targetPackageJson = "package.json";

    for (const file of packageFiles) {
      const content = await readTextIfExists(path.join(ctx.root, file));
      if (!content) {
        continue;
      }

      try {
        const pkg = JSON.parse(content) as Record<string, unknown>;
        const deps = {
          ...((pkg.dependencies as Record<string, unknown>) ?? {}),
          ...((pkg.devDependencies as Record<string, unknown>) ?? {})
        };

        if ("next" in deps || "gatsby" in deps || "gatsby-cli" in deps) {
          hasTelemetryFramework = true;
          targetPackageJson = file;
          break;
        }
      } catch {
        // Ignore malformed package.json files
      }
    }

    if (!hasTelemetryFramework) {
      return { findings };
    }

    // Check if .env or .env.local disables telemetry
    const envFiles = [".env", ".env.local", ".env.development", ".env.production"];
    let isOptedOut = false;

    for (const envFile of envFiles) {
      const content = await readTextIfExists(path.join(ctx.root, envFile));
      if (!content) {
        continue;
      }

      const hasNextDisabled = /^\s*NEXT_TELEMETRY_DISABLED\s*=\s*1\s*$/m.test(content);
      const hasDoNotTrack = /^\s*DO_NOT_TRACK\s*=\s*1\s*$/m.test(content);
      
      // If either environment variable disables it in any .env file, we consider it configured
      if (hasNextDisabled || hasDoNotTrack) {
        isOptedOut = true;
        break;
      }
    }

    // Also check current process env as a fallback
    if (process.env.NEXT_TELEMETRY_DISABLED === "1" || process.env.DO_NOT_TRACK === "1") {
      isOptedOut = true;
    }

    if (!isOptedOut) {
      findings.push({
        id: `privacy:telemetry:opt-out`,
        source: "telemetry-detector",
        category: "privacy",
        severity: "low",
        confidence: "high",
        title: "Telemetry enabled in project dependencies",
        message: "Next.js or Gatsby is installed, but telemetry opt-out variables are not configured in your .env files.",
        file: targetPackageJson,
        isNew: true,
        isAutofixable: true,
        safeToAutofix: true,
        agentInstruction: "Add 'NEXT_TELEMETRY_DISABLED=1' and 'DO_NOT_TRACK=1' to your root .env file.",
        tags: ["privacy", "telemetry", "opt-out"],
        evidence: {
          detector: "telemetry-detector",
          reasons: ["Telemetry-heavy package detected in package.json", "No opt-out configuration found in .env files"]
        },
        scoreImpact: 5
      });
    }

    return { findings };
  },
  buildFixCommand(ctx) {
    const escapedRoot = ctx.root.replace(/\\/g, "\\\\");
    const script = [
      "const fs = require('node:fs');",
      "const path = require('node:path');",
      `const envPath = path.join('${escapedRoot}', '.env');`,
      "let content = '';",
      "if (fs.existsSync(envPath)) {",
      "  content = fs.readFileSync(envPath, 'utf8');",
      "}",
      "const varsToAdd = [];",
      "if (!content.includes('NEXT_TELEMETRY_DISABLED=')) {",
      "  varsToAdd.push('NEXT_TELEMETRY_DISABLED=1');",
      "}",
      "if (!content.includes('DO_NOT_TRACK=')) {",
      "  varsToAdd.push('DO_NOT_TRACK=1');",
      "}",
      "if (varsToAdd.length > 0) {",
      "  const prefix = content && !content.endsWith('\\n') ? '\\n' : '';",
      "  fs.appendFileSync(envPath, prefix + varsToAdd.join('\\n') + '\\n', 'utf8');",
      "  console.log('Successfully enabled telemetry opt-out in .env');",
      "}"
    ].join(" ");

    return {
      cmd: "node",
      args: ["-e", script],
      cwd: ctx.root
    };
  },
  installHint: "Built-in telemetry opt-out detector. No external install needed."
};
