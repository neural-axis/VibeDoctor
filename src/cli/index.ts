#!/usr/bin/env node
import { Command } from "commander";
import { runAgentDoctorCommand, runAgentInitCommand, runAgentPackCommand, runAgentSyncCommand } from "./commands/agent";
import { runAgentPlanCommand } from "./commands/agentPlan";
import { runBaselineCreateCommand } from "./commands/baseline";
import { runExplainCommand } from "./commands/explain";
import { runSafeFixCommand } from "./commands/fix";
import { runInit } from "./commands/init";
import { runMcpServer } from "../mcp/server";
import { runReportCommand } from "./commands/report";
import { runScanCommand } from "./commands/scan";
import { runSetupCommand } from "./commands/setup";

async function main(): Promise<void> {
  const program = new Command();

  program.name("vibedoctor").description("Brutally simple repo health diagnosis.").version("0.1.0");

  program
    .command("init")
    .description("Create vibedoctor.yml and .vibedoctor baseline scaffolding")
    .action(async () => {
      process.stdout.write(`Created ${await runInit(process.cwd())}\n`);
    });

  program
    .command("scan")
    .description("Run relevant checks and print a short health report")
    .option("--changed", "Only report changed-file issues")
    .option("--quick", "Quick mode")
    .option("--full", "Full mode")
    .option("--category <categories>", "Comma-separated finding categories")
    .option("--report <format>", "terminal|json|html|agent|agent-json", "terminal")
    .action(async (options) => {
      const result = await runScanCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    });

  program
    .command("setup")
    .description("Print or install the recommended external scanner tools")
    .option("--apply", "Install automatable tools")
    .option("--include <level>", "essential|recommended", "essential")
    .action(async (options) => {
      const result = await runSetupCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    });

  program
    .command("fix")
    .description("Run safe autofix commands")
    .option("--safe", "Only allow safe fixes", true)
    .action(async () => {
      process.stdout.write(await runSafeFixCommand(process.cwd()));
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
    });

  agent
    .command("pack")
    .description("Regenerate canonical AGENTS.md and .agents skills from templates")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .option("--force", "Overwrite generated files")
    .action(async (options) => {
      process.stdout.write(await runAgentPackCommand(process.cwd(), options));
    });

  agent
    .command("sync")
    .description("Copy canonical skills into agent-specific locations")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .option("--force", "Overwrite generated files")
    .action(async (options) => {
      process.stdout.write(await runAgentSyncCommand(process.cwd(), options));
    });

  agent
    .command("doctor")
    .description("Check whether the agent-pack setup is healthy")
    .option("--target <target>", "Single target alias for --targets")
    .option("--targets <targets>", "codex,copilot,claude,cursor|all")
    .action(async (options) => {
      const result = await runAgentDoctorCommand(process.cwd(), options);
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
    });

  const baseline = program.command("baseline").description("Manage baselines");
  baseline
    .command("create")
    .description("Create a baseline file from the current findings")
    .action(async () => {
      process.stdout.write(await runBaselineCreateCommand(process.cwd()));
    });

  program
    .command("agent-plan")
    .description("Generate an AI-agent-oriented fix plan")
    .option("--format <format>", "markdown|json", "markdown")
    .option("--for <target>", "codex|copilot|claude|cursor")
    .action(async (options) => {
      process.stdout.write(await runAgentPlanCommand(process.cwd(), options.format, options.for));
    });

  program
    .command("explain")
    .description("Explain a finding")
    .argument("<finding-id>")
    .option("--format <format>", "text|json", "text")
    .action(async (findingId, options) => {
      process.stdout.write(await runExplainCommand(process.cwd(), findingId, options.format));
    });

  program
    .command("verify")
    .description("Re-run scan in changed mode for agent verification")
    .action(async () => {
      const result = await runScanCommand(process.cwd(), { changed: true });
      process.stdout.write(result.output);
      process.exitCode = result.exitCode;
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
  process.exitCode = 1;
});
