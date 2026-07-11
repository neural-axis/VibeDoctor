import { AGENT_SKILLS } from "./skills";

export { AGENT_SKILLS, type SkillTemplate } from "./skills";

export function renderAgentsMd(): string {
  return `# AGENTS.md

## VibeDoctor workflow

Use VibeDoctor as the source of truth for code-health checks.

Before major edits:
\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

Read \`completeness.status\` before editing. If it is \`partial\` or \`invalid\`, run the report's \`recoveryActions\` first. Never compare a partial score with a complete score or assume a timed-out tool passed.

After edits:
\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

Before PR or merge:
\`\`\`bash
vibedoctor scan --full --report json
\`\`\`

## Fix order

Always fix in this order:

1. security blockers
2. failing tests
3. type errors
4. dependency vulnerabilities
5. Privacy Review findings with regulated identifiers or sensitive attributes
6. high-confidence dead code
7. leftovers and legacy baggage
8. refactor-readiness items
9. efficiency suggestions

## Safety rules

- Do not delete dead code unless VibeDoctor marks it high confidence and you independently verify no active references.
- Do not remove backward compatibility code unless the user explicitly approves or the path is proven unused.
- Do not refactor large files without tests.
- Do not change public APIs during cleanup unless the task explicitly asks.
- Do not lower test, lint, security, or coverage thresholds.
- Do not send raw personal data to an AI service unless repository config and the user explicitly allow it.
- Do not silence VibeDoctor findings without explaining why.
- Respect .vibedoctor/agent-policy.yml when it exists.

## Verification

After each meaningful change, run the smallest relevant verification command.

At the end, report:

\`\`\`text
Health score:
Scan completeness:
Commands run:
Files changed:
Remaining blockers:
Suggested next step:
\`\`\`
`;
}

export function renderCursorRule(): string {
  return `---
description: Use VibeDoctor for code health, safe fixes, dead code, leftovers, refactor-readiness, and PR verification.
alwaysApply: true
---

When making code changes, use VibeDoctor as the code-health verification layer.

Prefer:
- \`vibedoctor scan --changed --report json\` before and after edits
- \`vibedoctor fix --safe\` for safe cleanup
- \`vibedoctor agent-plan --format markdown\` when planning multiple fixes

Do not delete dead code, remove compatibility paths, refactor large files, or send raw personal data to AI unless VibeDoctor evidence, repository policy, and user approval support it.
`;
}

export function renderCopilotInstructions(): string {
  return `Use VibeDoctor for repository health checks.

Before editing generated or AI-written code, run:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

After changes, run:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

For pull requests, summarize:
- health score
- blockers
- changed files checked
- tests run
- remaining VibeDoctor findings

Do not remove dead code, legacy fallbacks, compatibility shims, or large blocks of comments unless VibeDoctor marks them as high-confidence cleanup candidates and references are verified.
Do not send raw personal data to external AI review unless the user explicitly approves and repository policy allows it.
`;
}

export function renderCursorMcpConfig(): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        vibedoctor: {
          type: "stdio",
          command: "vibedoctor",
          args: ["mcp"]
        }
      }
    },
    null,
    2
  )}\n`;
}

export function renderGenericMcpConfig(): string {
  return `${JSON.stringify(
    {
      mcpServers: {
        vibedoctor: {
          command: "vibedoctor",
          args: ["mcp"]
        }
      }
    },
    null,
    2
  )}\n`;
}

export const DEFAULT_SKILL_NAMES = AGENT_SKILLS.map((skill) => skill.name);
