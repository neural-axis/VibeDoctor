#!/usr/bin/env node
import { Command } from "commander";
import fs from "node:fs";
import path from "node:path";
import { runAgentDoctorCommand, runAgentInitCommand, runAgentPackCommand, runAgentPluginCommand, runAgentSyncCommand } from "./commands/agent";
import { runAgentPlanCommand } from "./commands/agentPlan";
import { runBaselineCreateCommand } from "./commands/baseline";
import { runExplainCommand } from "./commands/explain";
import { runSafeFixCommand } from "./commands/fix";
import { runInit } from "./commands/init";
import { runMcpServer } from "../mcp/server";
import { runPrivacyReviewCommand } from "./commands/privacyReview";
import {
  runDpdpExplainCommand,
  runDpdpHandoffCommand,
  runDpdpInitCommand,
  runDpdpMapCommand,
  runDpdpReportCommand,
  runDpdpReviewQueueCommand,
  runDpdpScanCommand,
  runDpdpVerifyCommand
} from "./commands/dpdp";
import { runReportCommand } from "./commands/report";
import { runScanCommand } from "./commands/scan";
import { runSetupCommand } from "./commands/setup";
import { runToolRetryCommand } from "./commands/tool";
import { profilePolicy, withExecutionPolicy, type ExecutionProfile } from "../core/executionPolicy";

function getVersion(): string {
  try {
    // After `npm version patch` + publish, package.json is shipped (see "files").
    // When executed from dist/cli/index.js (in the installed package), it lives at ../../package.json.
    const pkgPath = path.resolve(__dirname, "..", "..", "package.json");
    const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
    if (pkg && typeof pkg.version === "string") {
      return pkg.version;
    }
  } catch {
    // fall through to hardcoded fallback
  }
  return "0.1.0";
}

async function main(): Promise<void> {
  const program = new Command();

  program.name("vibedoctor").description("Brutally simple repo health diagnosis.").version(getVersion());

  program
    .command("init")
    .description("Create vibedoctor.yml and .vibedoctor baseline scaffolding")
    .action(async () => {
      process.stdout.write(`Created ${await runInit(process.cwd())}\n`);
      process.exit(0);
    });

  program
    .command("scan")
    .description("Run the full applicable diagnosis and print a ranked health report")
    .option("--changed", "Optimize for git-changed files")
    .option("--quick", "Narrower opt-in profile")
    .option("--full", "Alias for the default full applicable diagnosis")
    .option("--category <categories>", "Comma-separated finding categories")
    .option("--report <format>", "terminal|json|html|agent|agent-json|envelope", "terminal")
    .option("--root <dir>", "Repository to scan (default: the current directory)")
    .option(
      "--profile <name>",
      "default|static|trusted. static runs only external read-only analysers: no project-local tools, tests, executable project config or network",
      "default"
    )
    .option("--allow-network", "Allow network-backed tools (Semgrep registry, OSV) under --profile static|trusted")
    .action(async (options) => {
      const root = path.resolve(options.root ?? process.cwd());
      if (!["default", "static", "trusted"].includes(options.profile)) {
        process.stderr.write(`Unknown --profile "${options.profile}". Use default, static or trusted.\n`);
        process.exit(64);
      }
      if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
        process.stderr.write(`--root is not a directory: ${root}\n`);
        process.exit(64);
      }
      const profile = options.profile as ExecutionProfile;
      const scan = () => runScanCommand(root, { ...options, version: getVersion() });
      let result: Awaited<ReturnType<typeof runScanCommand>>;
      try {
        result =
          profile === "default"
            ? await scan()
            : await withExecutionPolicy(
                profilePolicy(profile, { targetRoot: root, allowNetwork: Boolean(options.allowNetwork) }),
                scan
              );
      } catch (error) {
        // In envelope mode a crash produces no envelope and a distinct exit code (70), so a
        // caller never mistakes it for a completed scan whose policy gate failed (1).
        if (options.report === "envelope") {
          process.stderr.write(`vibedoctor: scan failed: ${error instanceof Error ? error.message : String(error)}\n`);
          process.exit(70);
        }
        throw error;
      }
      // Force exit once stdout has flushed: some child processes / native tool wrappers
      // (especially on Windows) can leave event-loop handles open even after 'close', and
      // exiting before a large piped write drains would truncate the report.
      process.stdout.write(result.output, () => process.exit(result.exitCode));
    });

  program
    .command("setup")
    .description("Print or install scanner tools for the selected setup set")
    .option("--apply", "Install automatable tools")
    .option("--include <level>", "essential|recommended|all|npm|python|manual|built-in  (default: recommended)", "recommended")
    .action(async (options) => {
      const result = await runSetupCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  program
    .command("fix")
    .description("Run safe autofix commands")
    .option("--safe", "Only allow safe fixes", true)
    .action(async () => {
      process.stdout.write(await runSafeFixCommand(process.cwd()));
      process.exit(0);
    });

  program
    .command("report")
    .description("Emit a full report")
    .option("--full", "Render the full human-readable report")
    .option("--json", "Render JSON")
    .option("--html", "Render HTML")
    .option("--markdown", "Render Markdown")
    .option("--agent", "Render agent markdown")
    .option("--sarif", "Render SARIF")
    .action(async (options) => {
      const format = options.full ? "full" : options.html ? "html" : options.markdown ? "markdown" : options.agent ? "agent" : options.sarif ? "sarif" : "json";
      process.stdout.write(await runReportCommand(process.cwd(), format));
      process.exit(0);
    });

  const agent = program.command("agent").description("Manage the VibeDoctor agent pack");
  agent
    .command("init")
    .description("Create AGENTS.md, canonical skills, policy, and optional target shims")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all", "codex")
    .option("--force", "Overwrite generated files")
    .action(async (options) => {
      process.stdout.write(await runAgentInitCommand(process.cwd(), options));
      process.exit(0);
    });

  agent
    .command("pack")
    .description("Regenerate canonical AGENTS.md and .agents skills from templates")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .option("--force", "Overwrite generated files")
    .action(async (options) => {
      process.stdout.write(await runAgentPackCommand(process.cwd(), options));
      process.exit(0);
    });

  agent
    .command("sync")
    .description("Copy canonical skills into agent-specific locations")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .option("--force", "Overwrite generated files")
    .action(async (options) => {
      process.stdout.write(await runAgentSyncCommand(process.cwd(), options));
      process.exit(0);
    });

  const tool = program.command("tool").description("Inspect and recover individual scanner tools");
  tool
    .command("retry")
    .description("Retry one scanner with an extended deadline")
    .argument("<tool-id>")
    .option("--timeout <seconds>", "Override the retry deadline in seconds", (value) => Number(value))
    .action(async (toolId, options) => {
      const result = await runToolRetryCommand(process.cwd(), toolId, options.timeout);
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  agent
    .command("plugin")
    .description("Generate installable Codex and Claude plugin bundle files")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,claude|all", "all")
    .option("--force", "Overwrite generated plugin files")
    .action(async (options) => {
      process.stdout.write(await runAgentPluginCommand(process.cwd(), options));
      process.exit(0);
    });

  agent
    .command("doctor")
    .description("Check whether the agent-pack setup is healthy")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .action(async (options) => {
      const result = await runAgentDoctorCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  const baseline = program.command("baseline").description("Manage baselines");
  baseline
    .command("create")
    .description("Create a baseline file from the current findings")
    .action(async () => {
      process.stdout.write(await runBaselineCreateCommand(process.cwd()));
      process.exit(0);
    });

  program
    .command("agent-plan")
    .description("Generate an AI-agent-oriented fix plan")
    .option("--format <format>", "markdown|json", "markdown")
    .option("--for <target>", "codex|copilot|claude|cursor")
    .action(async (options) => {
      process.stdout.write(await runAgentPlanCommand(process.cwd(), options.format, options.for));
      process.exit(0);
    });

  program
    .command("explain")
    .description("Explain a finding")
    .argument("<finding-id>")
    .option("--format <format>", "text|json", "text")
    .action(async (findingId, options) => {
      process.stdout.write(await runExplainCommand(process.cwd(), findingId, options.format));
      process.exit(0);
    });

  program
    .command("verify")
    .description("Re-run scan in changed mode for agent verification")
    .action(async () => {
      const result = await runScanCommand(process.cwd(), { changed: true });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  program
    .command("privacy-review")
    .description("Create a structured Privacy Review artifact for Privacy Review findings")
    .option("--refresh", "Refresh the full scan before reviewing")
    .option("--format <format>", "json|markdown", "json")
    .action(async (options) => {
      const result = await runPrivacyReviewCommand(process.cwd(), {
        refresh: options.refresh,
        format: options.format === "markdown" ? "markdown" : "json"
      });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  const dpdp = program
    .command("dpdp")
    .description("DPDP technical readiness assessment (not legal certification)");

  dpdp
    .command("init")
    .description("Create optional DPDP context and declared-evidence scaffolding")
    .action(async () => {
      const result = await runDpdpInitCommand(process.cwd());
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("scan")
    .description("Run deterministic DPDP technical readiness scan")
    .option("--full", "Full repository scan (default)", true)
    .option(
      "--changed",
      "Collect evidence only from git changed files (falls back to full scope if no delta); control matrix remains full catalogue"
    )
    .option("--report <format>", "terminal|json|html|markdown", "terminal")
    .action(async (options) => {
      const result = await runDpdpScanCommand(process.cwd(), {
        full: !options.changed,
        changed: Boolean(options.changed),
        report: options.report
      });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("map")
    .description("Print the personal-data processing map JSON (uses cached artifacts unless --refresh)")
    .option("--refresh", "Force a new scan before printing", false)
    .action(async (options) => {
      const result = await runDpdpMapCommand(process.cwd(), { refresh: Boolean(options.refresh) });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("review-queue")
    .description("Print human-review questions grouped by audience (uses cached artifacts unless --refresh)")
    .option("--refresh", "Force a new scan before printing", false)
    .action(async (options) => {
      const result = await runDpdpReviewQueueCommand(process.cwd(), { refresh: Boolean(options.refresh) });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("report")
    .description("Emit DPDP readiness report (uses cached artifacts unless --refresh)")
    .option("--json", "JSON report")
    .option("--html", "HTML report")
    .option("--markdown", "Markdown report")
    .option("--refresh", "Force a new scan before reporting", false)
    .action(async (options) => {
      const result = await runDpdpReportCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("handoff")
    .description("Generate agent handoff markdown from deterministic artifacts (cached unless --refresh)")
    .option("--refresh", "Force a new scan before generating handoff", false)
    .action(async (options) => {
      const result = await runDpdpHandoffCommand(process.cwd(), { refresh: Boolean(options.refresh) });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("verify")
    .description(
      "Re-run DPDP collection on changed files for post-fix verification (same scope as scan --changed; falls back to full if no git delta)"
    )
    .action(async () => {
      const result = await runDpdpVerifyCommand(process.cwd());
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  dpdp
    .command("explain")
    .description("Explain a DPDP control or finding id (uses cached artifacts unless --refresh)")
    .argument("<control-or-finding-id>")
    .option("--refresh", "Force a new scan before explaining", false)
    .action(async (id: string, options) => {
      const result = await runDpdpExplainCommand(process.cwd(), id, { refresh: Boolean(options.refresh) });
      process.stdout.write(result.output);
      process.exit(result.exitCode);
    });

  program
    .command("mcp")
    .description("Start the VibeDoctor MCP server over stdio")
    .action(async () => {
      await runMcpServer(process.cwd());
    });

  await program.parseAsync(process.argv);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
