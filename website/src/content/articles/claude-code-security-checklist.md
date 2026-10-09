---
title: "Claude Code Security Checklist Before You Ship"
description: "Review Claude Code permissions, sandboxing and MCP tools, then test the generated app's secrets, authorization, failure paths and privacy."
pubDate: 2026-10-10
stage: tool
related: [windsurf-security-checklist, cursor-security-risks, how-to-security-test-an-ai-generated-web-app]
---

Claude Code can help implement and repair an app, but the release decision still needs evidence. Review the permissions of the coding session, then verify the behavior of the generated application.

Anthropic's [security guidance](https://code.claude.com/docs/en/security) describes permission modes, sandbox controls and prompt-injection safeguards. Defaults can differ by version and surface; inspect your session's actual settings instead of relying on an old tutorial.

## 1. Inspect the session's authority

Use `/permissions` to review allowed operations and project-specific configuration. Know which commands require review and which actions may run automatically. Apply the sandbox and managed controls appropriate to your environment.

Keep test accounts and synthetic data in the development environment. Avoid placing production administration credentials in a session that is meant to edit ordinary application code. Review permissions again after adding a plugin or MCP server.

## 2. Treat outside text as untrusted context

Repository comments, dependency documentation, issue descriptions and fetched pages can contain instructions that were not written by you. A tool result should not authorize a new upload, credential read or deployment.

Review proposed commands that send data, execute remote code or change account access. Inspect hooks and project instructions before relying on them. Ask the agent to identify the exact files and verification steps for the intended change.

## 3. Verify the generated app

Map every browser interaction to its server handler. Test authentication and ownership with two users. Changing a record identifier must not grant access to another user's data.

Trace credentials from configuration to their use. Inspect the production bundle and API responses for exposure. Review logging and model calls for unnecessary personal data. Simulate a controlled upstream failure and check that it produces a failure response rather than a fabricated success.

## 4. Use evidence to guide the next repair

```bash
npx @neuralaxis/vibedoctor scan --full --report agent-json
```

VibeDoctor runs against the repository and reports findings plus scan completeness. The [agent integration](/agents/) supports structured repair work and a local MCP server. Give Claude Code a reproducible finding, the relevant location and the expected behavior.

A useful repair request is:

> Reproduce this finding first. Fix the named failure without changing unrelated code. Add a regression test, rerun the relevant checks and report any verification that could not complete.

## 5. Review and release

Read the diff and confirm the regression test fails before the repair and passes afterward when practical. Recheck production configuration independently. A repository report cannot prove a hosted database policy, payment webhook or organization-wide privacy process is correct.

Finish with the [AI app security test](../how-to-security-test-an-ai-generated-web-app/) and [production readiness checklist](../production-readiness-checklist-ai-app/). Keep unresolved uncertainties visible in the release record.
