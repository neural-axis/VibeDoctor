# VibeDoctor

VibeDoctor is a repo health CLI for JavaScript, TypeScript, Python, and mixed codebases.

```bash
npx vibedoctor scan
```

It orchestrates existing quality tools, normalizes the noise into a single finding model, scores project health, and emits a short "fix this next" report for humans and coding agents.

## Commands

```bash
vibedoctor init
vibedoctor scan
vibedoctor scan --changed
vibedoctor scan --quick
vibedoctor scan --full
vibedoctor fix --safe
vibedoctor report --json
vibedoctor report --html
vibedoctor report --agent
vibedoctor baseline create
vibedoctor agent init
vibedoctor agent init --targets all
vibedoctor agent pack
vibedoctor agent sync
vibedoctor agent doctor
vibedoctor agent-plan --format markdown
vibedoctor agent-plan --format json --for codex
vibedoctor explain <finding-id>
vibedoctor verify
vibedoctor mcp
```

## Agent Pack

VibeDoctor now includes an agent-pack layer for Codex, Copilot, Claude Code, and Cursor.

```bash
vibedoctor agent init --targets all
```

That generates:

- `AGENTS.md`
- canonical skills in `.agents/skills/*`
- guardrails in `.vibedoctor/agent-policy.yml`
- compatibility shims for `.claude/skills`, `.github/copilot-instructions.md`, `.github/skills`, `.cursor/rules`, and `.cursor/mcp.json`

Use these commands to maintain it:

```bash
vibedoctor agent pack
vibedoctor agent sync --targets claude,copilot,cursor
vibedoctor agent doctor --targets all
```

For Codex, open the agent and run:

```bash
/skills
```

You should see the VibeDoctor skills after `agent init`.

## MCP server

Start the MCP server with:

```bash
vibedoctor mcp
```

The server exposes structured tools for:

- changed and full scans
- safe fixes
- report retrieval
- agent-plan retrieval
- finding explanations
- verification

## Current implementation

The codebase now includes:

- project detection for Python, JavaScript, TypeScript, mixed repos, lockfiles, test tools, and config files
- config loading with safe defaults plus YAML and JSON support
- a shared finding model, baseline matching, explainable scoring, and tool execution primitives
- adapters for Ruff, Biome, TypeScript, Pyright, Semgrep, Gitleaks, OSV-Scanner, Knip, Vulture, deptry, jscpd, Lizard, Radon, coverage.py, Vitest, and Jest
- custom leftover detection, refactor-readiness detection, and dead-chain detection
- terminal, JSON, Markdown, HTML, SARIF, and agent-oriented reports
- agent-pack generation, guardrail policy, cross-agent skill shims, and an MCP server
- fixtures and tests for mixed-repo detection, config behavior, finding normalization, scoring, dead chains, refactor candidates, agent plans, and tool-runner edge cases

## Development

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

## Packaging

Before publish or release packaging, run:

```bash
npm pack --dry-run
```

The `prepack` script rebuilds `dist/`, and the package includes only compiled output plus README and license metadata.

## License

VibeDoctor is licensed under GPL-3.0-or-later. You can use, copy, modify, and redistribute it under the GPL terms; distributed derivative works must provide corresponding source under compatible GPL terms.

## CI

GitHub Actions runs `npm ci` and `npm run check` on Node 20 and 22 for pushes and pull requests to `main`.

`scan` and `verify` return a non-zero exit code when the configured score threshold or fail-fast checks are tripped.
