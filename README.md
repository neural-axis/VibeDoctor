# VibeDoctor

**A health check for code you didn't write line by line.**

AI writes most of the code now. It ships fast, and it also leaves behind dead
branches, half-removed fallbacks, commented-out experiments, untested files, and
the occasional hardcoded secret. VibeDoctor is the checkup that catches all of
that before it reaches your main branch.

It runs the quality tools your project already uses, normalizes their output into
one finding model, scores the repo, and tells humans **and** coding agents exactly
what to fix next.

```bash
npx @neural-axis/vibedoctor scan
```

```text
Health: 71/100 ⚠️

Blockers: 1
Fix next: 3
Leftovers: 1
Dead code candidates: 1
Refactor candidates: 1

BLOCKERS
1. Hardcoded secret in config (src/config.ts)

FIX NEXT
1. Hardcoded secret (src/config.ts)
2. Dead chain candidate (src/legacy.ts)
3. Ready for refactor (src/report_builder.ts)

READY FOR AGENT
Run:
vibedoctor agent-plan
```

No dashboards, no SaaS sign-up, no config required to start. One command, one
short answer.

## Why VibeDoctor

- **Built for the AI era.** It specifically hunts the debt that generated code
  leaves behind: dead chains, legacy fallbacks, leftover comments, and untested
  surface area, not just lint noise.
- **One score, one priority list.** Fifteen-plus tools collapse into a single
  health score and a ranked "fix next" list instead of a wall of warnings.
- **Agent-native.** Ships skills and instructions for Codex, Claude Code, GitHub
  Copilot, and Cursor, plus an MCP server, so your agent can scan and self-correct.
- **Honest by default.** Missing tools are reported as skipped, never silently
  counted as passing.
- **Zero lock-in.** It orchestrates open tools you already trust and writes plain
  JSON, HTML, Markdown, and SARIF you own.

## What It Checks

VibeDoctor detects the project shape, discovers local tool binaries from
`node_modules/.bin` and Python virtualenv folders, then runs relevant adapters
when available.

It can report on:

- type and lint failures from TypeScript, Pyright, Ruff, and Biome
- secrets and dependency risk from Gitleaks, OSV-Scanner, Semgrep, deptry, and Knip
- dead code from Vulture, Knip, and VibeDoctor's dead-chain detector
- leftover AI or legacy code such as commented-out blocks, fallback flags, and stale TODOs
- refactor-readiness hotspots, duplication, complexity, and coverage gaps
- test coverage from coverage.py, Vitest, and Jest

Missing tools are reported as skipped instead of treated as clean coverage.

## Quickstart

From the repository or package you want to inspect:

```bash
npx @neural-axis/vibedoctor init
npx @neural-axis/vibedoctor setup
npx @neural-axis/vibedoctor scan --quick
npx @neural-axis/vibedoctor scan --changed
```

Prefer a shorter command? Install it once and call the `vibedoctor` binary directly:

```bash
npm install -g @neural-axis/vibedoctor
vibedoctor scan
```

The remaining examples use the `vibedoctor` binary; prefix them with `npx @neural-axis/vibedoctor` if you skip the global install.

Want the strongest first scan? Run `vibedoctor setup --apply`. VibeDoctor will
install the essential project-local npm/Python tools it can install safely, and
print exact manual steps for native tools such as Gitleaks and OSV-Scanner.

For the strongest signal in monorepos, run VibeDoctor from the package or service root you are actively changing. Running from the monorepo root is supported, but package roots usually produce tighter dependency and test-tool signal.

After a scan, VibeDoctor writes:

- `.vibedoctor/report.json` for tools and agents
- `.vibedoctor/report.html` for a browser-readable report
- `.vibedoctor/agent-plan.md` for guided repair work

## Common Workflows

| Goal | Command |
| --- | --- |
| Initialize config | `vibedoctor init` |
| Plan/install scanner tools | `vibedoctor setup` / `vibedoctor setup --apply` |
| Fast local triage | `vibedoctor scan --quick` |
| Review only changed files | `vibedoctor scan --changed` |
| Full repository scan | `vibedoctor scan --full` |
| Scan one category | `vibedoctor scan --category dead_code,leftovers --report json` |
| Apply safe tool fixes | `vibedoctor fix --safe` |
| Create a baseline | `vibedoctor baseline create` |
| Explain one finding | `vibedoctor explain <finding-id>` |
| Verify after edits | `vibedoctor verify` |
| Generate agent plan | `vibedoctor agent-plan --format markdown` |
| Start MCP server | `vibedoctor mcp` |

`scan` and `verify` return a non-zero exit code when the configured score threshold or fail-fast checks are tripped, so they drop straight into a pre-commit hook or CI gate.

## Configuration

`vibedoctor init` writes a `vibedoctor.yml` you can tune. Sensible defaults are
baked in, so editing is optional. The most useful knobs:

- `score.minimum` — the health score that `scan`/`verify` must clear to pass
- `baseline.fail_only_on_new_issues` — only fail on debt introduced since the baseline
- `checks.*` — enable/disable categories and set fail-fast rules for secrets, type errors, test failures, and vulnerabilities
- `paths.include` / `paths.exclude` — scope what gets scanned

Use `vibedoctor baseline create` to snapshot existing debt, then fail builds only
on *new* problems while you pay down the rest over time.

## Tool Setup Philosophy

VibeDoctor prefers tools already installed by the repository because that matches
your real CI versions and config. It never treats a missing tool as a clean pass:
missing tools are shown as skipped with install guidance.

For a smoother first run, `vibedoctor setup` gives you the curated install plan.
The essential set is the smallest group needed to make the main product promise
work across common repos:

- built-in detectors: leftovers, dead-chain candidates, and refactor readiness
- JS/TS: TypeScript, Biome, and Knip
- Python: Ruff, Pyright, and Vulture
- security/dependencies: Gitleaks and OSV-Scanner

`vibedoctor setup --apply` installs automatable package-manager tools. Native
binaries stay explicit for now so the CLI does not silently download executables
into developer or CI machines.

## Reports

Use `scan --report <format>` or `report` commands depending on whether you want a fresh scan or a rendered artifact.

```bash
vibedoctor scan --full --report json
vibedoctor report --html
vibedoctor report --markdown
vibedoctor report --agent
vibedoctor report --sarif
```

JSON is the best format for automation. Terminal output is intentionally short and answers: health score, blockers, fix-next items, leftovers, dead-code candidates, skipped tools, and errored tool causes.

## Agent Pack

VibeDoctor can install repo-scoped instructions and skills for Codex, Claude Code, GitHub Copilot, and Cursor.

```bash
vibedoctor agent init --targets all
vibedoctor agent doctor --targets all
```

Generated files:

| Target | Files |
| --- | --- |
| Codex | `AGENTS.md`, `.agents/skills/<skill>/SKILL.md`, `.agents/skills/<skill>/agents/openai.yaml` |
| Claude Code | `.claude/skills/<skill>/SKILL.md` plus mirrored skill support files |
| GitHub Copilot | `.github/copilot-instructions.md`, `.github/skills/<skill>/SKILL.md` plus mirrored skill support files |
| Cursor | `.cursor/rules/vibedoctor.mdc`, `.cursor/mcp.json` |
| Shared policy | `.vibedoctor/agent-policy.yml`, `.vibedoctor/agent-pack.json` |

The canonical source is `.agents/skills`. `agent sync` mirrors those skills into the target-specific locations.

```bash
vibedoctor agent pack
vibedoctor agent sync --targets claude,copilot,cursor
vibedoctor agent sync --targets all --force
```

This follows the same packaging model used by the major coding agents:

- Codex reads repository instructions from `AGENTS.md` and repo skills from `.agents/skills/<skill>/SKILL.md`. VibeDoctor also emits optional Codex `agents/openai.yaml` metadata for a cleaner app experience.
- Claude Code reads project skills from `.claude/skills/<skill>/SKILL.md`, where the directory name becomes the slash command.
- GitHub Copilot reads repository guidance from `.github/copilot-instructions.md` and can use agent instructions from `AGENTS.md`.
- Cursor uses rule files and MCP configuration for always-on guidance and tool access.

VibeDoctor ships repo-scoped skills, not a Codex or Claude plugin package. That is intentional for now: the CLI installs workflow guidance directly into the repository being scanned.

## MCP Server

Start the MCP server with:

```bash
vibedoctor mcp
```

The server exposes structured tools for changed scans, full scans, safe fixes, report retrieval, agent-plan retrieval, finding explanations, and verification.

## Development

Requirements:

- Node.js 18 or newer
- npm 10.x for lockfile-compatible installs

Install dependencies and run the full local check:

```bash
npm ci
npm run check
```

Useful scripts:

```bash
npm test
npm run typecheck
npm run build
npm run dev -- scan --quick
```

`npm run build` emits production files into `dist/` from `src/` only. Generated output, dependencies, coverage, local virtualenvs, and VibeDoctor report artifacts are intentionally ignored by Git.

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/adapters` | Tool adapters and parsers |
| `src/core` | Project detection, scan planning, scoring, baselines, and command execution |
| `src/cli` | Command-line interface |
| `src/agentPack` | Agent instructions, skills, policy, and target shims |
| `src/mcp` | MCP server and tools |
| `src/reporters` | Terminal, JSON, Markdown, HTML, SARIF, and agent reports |
| `fixtures` | Small sample projects for integration tests |
| `tests` | Unit, integration, and snapshot tests |

## Packaging

Before publish or release packaging, run:

```bash
npm pack --dry-run
```

The `prepack` script rebuilds `dist/`, and the npm package includes only compiled output plus README, license, and package metadata.

## CI

GitHub Actions runs `npm ci` and `npm run check` on Node 20 and 22 for pushes and pull requests to `main`.

## License

VibeDoctor is licensed under GPL-3.0-or-later. You can use, copy, modify, and redistribute it under the GPL terms; distributed derivative works must provide corresponding source under compatible GPL terms.
