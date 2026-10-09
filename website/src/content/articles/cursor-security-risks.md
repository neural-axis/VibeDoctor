---
title: "Cursor Security Risks: What to Check in AI-Generated Code"
seoTitle: "Cursor Security Risks: What to Check in AI Code"
description: "Cursor AI security is the gap between code that compiles and code that is safe to ship: accepted diffs, .env in context, MCP, and leftovers."
pubDate: 2026-08-14
draft: false
rank: 5
stage: tool
related:
  - vibe-coding-security-checklist
  - 10-security-mistakes-ai-coding-agents-make
  - how-api-keys-get-exposed-in-ai-generated-apps
  - how-to-security-test-an-ai-generated-web-app
---

Cursor will generate working code all afternoon. **Cursor security** is about the hour after that, when you still have a git repo, a diff you accepted, and a model that was rewarded for making the red squiggle go away.

This is not “is Cursor a virus.” It is the difference between an AI that produces a passing TypeScript build and an AI that produces production-safe code. Those are different jobs. Cursor is excellent at the first. The second is still yours.

If you built in Lovable or Bolt, start with those notes. If the files live on your disk and Agent/Composer has been touching them, stay here.

## The actual Cursor threat model

Four surfaces matter more than “the model might hallucinate a package name”:

1. **The diff you accepted** — auth skipped, RLS loosened, a key pasted into `config.ts`.
2. **The context you gave it** — `.env`, customer exports, production logs, another repo’s secrets.
3. **The tools you attached** — MCP servers, terminals, browsers, deploy buttons.
4. **The residue** — TODOs, fallback flags, a second implementation, `.env` now tracked in git.

Cursor’s own product advice has grown around this: ignore files, secret tabs for cloud agents, warnings that snapshotting `.env.local` will persist it. The failure is still “I hit accept.”

## 1. Working is not authorized

Composer will wire a complete CRUD screen that compiles and looks expensive. The list query filters by `user.id` in the client. The `GET /api/items/:id` handler does not.

**Check every new endpoint the agent added in this session**, not the ones you remember writing last year.

- Unauthenticated request is rejected on the server.
- Authenticated user B cannot read A’s id.
- Role checks are not `if (req.body.admin)`.

This is the same IDOR you get from hosted builders. In Cursor it arrives as a confident, well-typed handler.

## 2. `.env` in the prompt is a publish

Cursor can read `.env` when the file is in the workspace. People have watched the agent print the values back. Even when it does not print them, they may have entered the context window.

**Do:**

- Put `.env` in `.cursorignore` / `.gitignore` (both; they do different jobs).
- Prefer a secrets manager or the host env panel for anything live.
- Never paste production values into chat to “debug the missing key.”
- If a cloud agent snapshots the repo, exclude env files from the snapshot.

If the model has seen a live key, rotate it. Assume logs and transcripts are a second copy.

The full leak taxonomy is [how API keys get exposed in AI-generated apps](../how-api-keys-get-exposed-in-ai-generated-apps/).

## 3. Rules files are not a security boundary

`.cursorrules`, project rules, and “always use RLS” docs are hints. They are also an attack surface: a malicious rule or a README the agent was told to obey can steer it.

Do not treat a rules file as enforcement. Treat CI and a local scan as enforcement. If a rule says “never commit secrets” and gitleaks still finds one, the rule lost.

## 4. MCP and the terminal are production access

An MCP server that can read Slack, query prod, or apply Terraform is not a linter. An agent with `all` tools and a bored operator will find the shortest path.

**Minimums:**

- Attach the smallest MCP set for the task.
- Do not give write credentials to a server you have not read.
- Watch the first terminal commands. `git add -A` plus a new `.env` is a ritual now.
- Disable auto-run for destructive commands until you trust the repo’s habits.

## 5. Dependencies the agent chose

Cursor will install a package to satisfy an import it just wrote. Review `package.json` / `pyproject.toml` on every agent session that touched them.

- Do you recognize the name?
- Is it the popular package or a lookalike?
- Did a lockfile jump a major version of something load-bearing?

Then scan the lockfile. “It imported cleanly” is not OSV.

## 6. Leftovers are how Cursor writes backdoors

Agents leave `// skip auth for local testing`, `BYPASS_RLS`, commented middleware, and a `debugRoute`. They leave it because you said “keep going.”

Search the diff, not the whole history, after each session:

```text
TODO  FIXME  HACK  skip auth  disable RLS
temporary  for now  bypass  debug
```

VibeDoctor’s leftover detector exists for this exact residue. It is not cute style. It is the comment that documents the hole.

## 7. Tests the agent wrote can launder the bug

A generated test that instantiates the handler with a fake admin user will stay green while production is open. Read the test. If it never makes a request as user B, it is a compile check.

## A Cursor session protocol that does not slow you down

1. Branch.
2. Tell the agent the constraint in the same bubble as the feature: *Do not add secrets to files. Do not weaken auth to make the UI work. List new dependencies and wait.*
3. Accept in hunks. Auth and env hunks get a slower eye than CSS.
4. Run the app as two users if data is personal.
5. Scan the tree you are about to keep.

```bash
npx @neuralaxis/vibedoctor scan --full
```

That is the release command. After a 20-line edit on an existing baseline, `scan --changed` is enough. Do not treat a changed-scope pass as a ship diagnosis.

VibeDoctor can also write an agent protocol into the repo:

```bash
npx @neuralaxis/vibedoctor agent init --targets cursor
npx @neuralaxis/vibedoctor agent-plan --format markdown
```

The point of the protocol is not ceremony. It is: recover incomplete scanners, apply the plan, run `verify`. Cursor is one of the supported agent targets. The model still needs a human to refuse a diff that “fixes” a finding by deleting the check.

## What “production-safe” means here

| Working code | Production-safe code |
| --- | --- |
| Types pass | Unauthenticated writes fail |
| The page renders | User B is denied |
| Env var is referenced | Env var is not in git or the bundle |
| Tests pass | Tests include an unauthorized case |
| Agent says “done” | Coverage table says scanners finished |

If you want the cross-tool list, read [10 security mistakes AI coding agents commonly make](../10-security-mistakes-ai-coding-agents-make/). If you are about to ship, use the [15-point checklist](../vibe-coding-security-checklist/) and the [security-test note](../how-to-security-test-an-ai-generated-web-app/).

Cursor is not the risk. Unreviewed, working code is the risk. That was true when the intern wrote it, too. The intern is just faster now.
