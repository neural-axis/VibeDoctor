# VibeDoctor

A health check for code you did not write line by line.

VibeDoctor is a local code-health CLI for JS, TS, Python, and mixed repositories. It turns scattered tool output into a ranked health report, safe repair workflow, Privacy Review artifact, MCP server, and reusable agent skills.

```bash
npx @neuralaxis/vibedoctor scan --changed
```

For a stronger first run:

```bash
npx @neuralaxis/vibedoctor init
npx @neuralaxis/vibedoctor setup --apply
npx @neuralaxis/vibedoctor scan --quick
```

Install once if you prefer the short binary:

```bash
npm install -g @neuralaxis/vibedoctor
vibedoctor scan --full
```

## Release Demos

<video src="docs/assets/vibedoctor-product-release-demo-v0.1.1.mp4" controls muted playsinline width="100%"></video>

[Direct video link](docs/assets/vibedoctor-product-release-demo-v0.1.1.mp4)

## Why VibeDoctor

- It focuses on the failure modes AI-heavy repos accumulate: dead branches, stale fallbacks, leftovers, weak coverage, and accidental sensitive-data exposure.
- It collapses many tool results into one finding model, one score, and a ranked fix list instead of a wall of unrelated warnings.
- It is agent-native without locking you into a hosted service: reports stay local and output remains plain JSON, HTML, Markdown, and SARIF.
- It tells agents whether a scan is complete, provides exact recovery commands for failed tools, and prevents partial scores from masquerading as authoritative health checks.

## What VibeDoctor Checks

VibeDoctor detects the project shape, discovers local tool binaries, runs the checks that make sense for the repo, and reports missing tools as skipped instead of pretending they passed.

- Type and lint failures from TypeScript, Pyright, Ruff, Biome, and similar local tools.
- Secrets and dependency risk from Gitleaks, OSV-Scanner, Semgrep, deptry, Knip, and project-native scanners when available.
- Privacy and PII exposure from VibeDoctor's deterministic detector, with optional Presidio support.
- Dead code from Vulture, Knip, and VibeDoctor's dead-chain detector.
- AI and legacy leftovers such as commented-out blocks, stale TODOs, fallback flags, and half-removed code.
- Refactor-readiness hotspots, duplication, complexity, and coverage gaps.
- Test and coverage signal from local JS and Python tooling.

After a scan, VibeDoctor writes machine-readable and human-readable artifacts under `.vibedoctor/`, including `report.json`, `report.html`, and `agent-plan.md`.

## Tool Setup Philosophy

VibeDoctor prefers repository-local tools and config so the scan matches the versions you actually use in development and CI. Missing tools are reported as skipped with install guidance instead of being counted as clean.

## Common CLI Workflows

| Goal | Command |
| --- | --- |
| Initialize config | `vibedoctor init` |
| Plan scanner setup | `vibedoctor setup` |
| Install automatable recommended tools | `vibedoctor setup --apply` |
| Fast local triage | `vibedoctor scan --quick` |
| Review changed files | `vibedoctor scan --changed` |
| Full repository scan | `vibedoctor scan --full` |
| Scan selected categories | `vibedoctor scan --category dead_code,leftovers --report json` |
| Scan privacy findings only | `vibedoctor scan --category privacy --report json` |
| Render reports | `vibedoctor report --html`, `--markdown`, `--sarif`, or `--agent` |
| Apply safe tool fixes | `vibedoctor fix --safe` |
| Create a baseline | `vibedoctor baseline create` |
| Explain a finding | `vibedoctor explain <finding-id>` |
| Verify after edits | `vibedoctor verify` |
| Retry a timed-out scanner | `vibedoctor tool retry <tool-id> [--timeout 600]` |
| Generate an agent repair plan | `vibedoctor agent-plan --format markdown` |

`scan` and `verify` return exit code `1` when completed health gates fail and exit code `2` when required checks are incomplete. Reports label incomplete scores as `PARTIAL` or `INVALID` and include machine-readable `recoveryActions`.

Timeouts and required checks are configurable:

```yaml
runtime:
  default_timeout_seconds: 120
  tool_timeouts:
    biome: 180
    semgrep: 300
  required_tools:
    - biome
    - semgrep
  fail_on_incomplete_scan: true
```

## Privacy Review

Privacy Review is deterministic-first and advisory by default. The built-in privacy detector finds regulated identifiers, personal-data fields, sensitive attributes, and combination-risk patterns while storing masked evidence in reports.

```bash
vibedoctor scan --category privacy --report json
vibedoctor privacy-review --refresh --format markdown
```

By default, privacy findings affect the privacy category score but do not lower the overall health score or fail CI. To make privacy findings blocking, opt in through config:

- `checks.privacy.fail_on_regulated_identifiers`
- `checks.privacy.fail_on_sensitive_attributes`

The `privacy-review` command writes `.vibedoctor/privacy-review.json` with structured review decisions and merge-back metadata. Optional AI adjudication only runs when `checks.privacy.ai.enabled` is true and the configured API-key environment variables are present.

## Agent Skills And Plugins

VibeDoctor has two agent surfaces.

Repo-local install:

```bash
vibedoctor agent init --targets all
vibedoctor agent doctor --targets all
```

This writes repository-scoped guidance and skills:

- `AGENTS.md`
- `.agents/skills/<skill>/SKILL.md`
- `.agents/skills/<skill>/agents/openai.yaml`
- `.claude/skills/<skill>/SKILL.md`
- `.github/skills/<skill>/SKILL.md`
- `.github/copilot-instructions.md`
- `.cursor/rules/vibedoctor.mdc`
- `.cursor/mcp.json`
- `.vibedoctor/agent-policy.yml`

Plugin bundle:

```bash
vibedoctor agent plugin --target codex
vibedoctor agent plugin --target claude
vibedoctor agent plugin --targets all --force
```

This materializes an installable bundle under `plugins/vibedoctor/`:

- `plugins/vibedoctor/.codex-plugin/plugin.json`
- `plugins/vibedoctor/.claude-plugin/plugin.json`
- `plugins/vibedoctor/skills/<skill>/SKILL.md`

Codex discovers the plugin from `.codex-plugin/plugin.json`, which points to `./skills/`. Claude Code uses the plugin namespace for skill commands, for example:

```text
/vibedoctor:vibedoctor-health-scan
/vibedoctor:vibedoctor-privacy-review
```

The canonical skill catalog is exported from the package root as `AGENT_SKILLS`, `DEFAULT_SKILL_NAMES`, and `SkillTemplate`, and the same templates generate repo skills, Claude skills, Copilot/Cursor shims, and packaged plugin skills.

## MCP Server

Start the MCP server over stdio:

```bash
vibedoctor mcp
```

The MCP server exposes structured tools for changed scans, full scans, safe fixes, report retrieval, agent-plan retrieval, finding explanations, and verification. Agent configs generated by `vibedoctor agent init --targets all` include target-specific MCP wiring where supported.

## Configuration

`vibedoctor init` writes `vibedoctor.yml`. Editing is optional, but these are the most common controls:

- `score.minimum`: health score required for `scan` and `verify` to pass.
- `baseline.fail_only_on_new_issues`: fail only on debt introduced after the baseline.
- `checks.*`: enable categories and fail-fast gates for secrets, type errors, test failures, and vulnerabilities.
- `checks.privacy.*`: tune deterministic privacy detection, masking, optional Presidio support, optional AI review, and CI blocking behavior.
- `paths.include` and `paths.exclude`: scope scanned files.

Use `vibedoctor baseline create` to snapshot existing debt, then fail builds only on new problems while you pay down the rest.

## Development And Release

Requirements:

- Node.js 18 or newer
- npm 10.x

Run the local verification set:

```bash
npm test
npm run typecheck
npm run build
npm pack --dry-run
```

Useful development commands:

```bash
npm run dev -- scan --quick
npm run dev -- agent init --targets all
npm run dev -- agent plugin --targets all --force
```

`npm run build` emits production files into `dist/`. Plugin bundles under `plugins/` are generated on demand by `vibedoctor agent plugin ...` and are ignored in this repository by default.

## Project Layout

| Path | Purpose |
| --- | --- |
| `src/adapters` | Tool adapters and parsers |
| `src/core` | Project detection, scan planning, scoring, baselines, and command execution |
| `src/cli` | Command-line interface |
| `src/agentPack` | Agent instructions, skills, policy, shims, and plugin generation |
| `src/mcp` | MCP server and tools |
| `src/reporters` | Terminal, JSON, Markdown, HTML, SARIF, and agent reports |
| `plugins/vibedoctor` | Generated Codex and Claude plugin bundle |
| `fixtures` | Sample projects for tests |
| `tests` | Unit, integration, and snapshot tests |

## License

VibeDoctor is licensed under GPL-3.0-or-later.
