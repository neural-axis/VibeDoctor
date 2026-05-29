export type SkillTemplate = {
  name: string;
  description: string;
  content: string;
};

function createSkill(name: string, description: string, body: string): SkillTemplate {
  return {
    name,
    description,
    content: [
      "---",
      `name: ${name}`,
      `description: ${description}`,
      "---",
      "",
      body.trim(),
      ""
    ].join("\n")
  };
}

export const AGENT_SKILLS: SkillTemplate[] = [
  createSkill(
    "vibedoctor-health-scan",
    "Run and interpret VibeDoctor health scans for JavaScript, TypeScript, Python, and mixed repositories. Use when asked to assess app health, check code quality, verify generated code, find blockers, review changed files, or decide what to fix next.",
    `
# VibeDoctor Health Scan

Use VibeDoctor before risky edits, after meaningful edits, and before merge.

Respect \`.vibedoctor/agent-policy.yml\` if it exists.

## Default workflow

1. Run a changed-file scan first:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

2. If there are no changed files or the user asks for a full repo check, run:

\`\`\`bash
vibedoctor scan --full --report json
\`\`\`

3. Read \`.vibedoctor/report.json\`.

4. Prioritize findings in this order:
   - security blockers
   - correctness blockers
   - failing tests
   - dependency vulnerabilities
   - high-confidence dead code
   - leftover legacy, fallback, or commented code
   - refactor-readiness candidates
   - efficiency suggestions

## Output to user

Give only:
- health score
- blockers
- safest next command
- top 3 fixes
- whether work is safe to continue

Do not paste the full JSON unless the user asks.
`
  ),
  createSkill(
    "vibedoctor-safe-fix",
    "Safely apply VibeDoctor-approved autofixes such as formatting, lint fixes, unused imports, and simple tool fixes. Use when the user asks to clean, fix lint, improve health score, or apply safe automatic fixes without changing behavior.",
    `
# VibeDoctor Safe Fix

Only apply safe fixes allowed by \`.vibedoctor/agent-policy.yml\`.

## Safe commands

Run:

\`\`\`bash
vibedoctor fix --safe
\`\`\`

Then verify:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

## Rules

- Do not delete files.
- Do not remove dead code unless another skill produced a reviewed deletion plan.
- Do not upgrade dependencies unless the user asked and policy allows it.
- Do not change public APIs.
- Do not rewrite business logic.
- If tests fail after safe fix, stop and report the failing command.

## User summary

Report:
- number of issues fixed
- files changed
- remaining blockers
- verification result
`
  ),
  createSkill(
    "vibedoctor-dead-code-cleanup",
    "Review and clean high-confidence dead code chains, unused exports, unused files, unused dependencies, commented-out code, legacy fallbacks, and AI-created leftovers found by VibeDoctor. Use when asked to remove dead code, clean leftovers, reduce legacy baggage, or simplify AI-generated code.",
    `
# VibeDoctor Dead Code Cleanup

Use VibeDoctor findings as evidence, not as automatic truth.

## Workflow

1. Run:

\`\`\`bash
vibedoctor scan --full --category dead_code,leftovers --report json
\`\`\`

2. Read \`.vibedoctor/report.json\`.

3. Group findings into:
   - high-confidence deletion candidates
   - medium-confidence review candidates
   - low-confidence do-not-delete candidates

4. For each dead chain, verify:
   - no active imports
   - no route registration
   - no test dependency
   - no dynamic import or reflection warning
   - no public API export
   - no framework magic usage

5. Only delete high-confidence code after verification and policy approval.

## Never delete automatically

Do not delete if the finding involves:
- public exports
- migrations
- plugin systems
- reflection
- dynamic imports
- environment-gated fallbacks
- backward compatibility comments
- payment, auth, or security code

## Cleanup plan format

\`\`\`text
Dead chain:
- file A
- file B
- file C

Evidence:
- no active entrypoint
- no tests
- only internal references

Action:
- safe to remove / review required / do not remove

Verification:
- test command
- VibeDoctor scan command
\`\`\`
`
  ),
  createSkill(
    "vibedoctor-refactor-readiness",
    "Use VibeDoctor to decide whether large, complex, duplicated, or messy files are ready for refactor. Use when asked to refactor large files, split files, reduce complexity, simplify generated code, or improve maintainability.",
    `
# VibeDoctor Refactor Readiness

Do not refactor just because a file is large.

## Workflow

1. Run:

\`\`\`bash
vibedoctor scan --category refactor_readiness,maintainability,tests --report json
\`\`\`

2. Read \`.vibedoctor/report.json\`.

3. For each candidate, classify:

\`\`\`text
READY FOR REFACTOR
ADD TESTS FIRST
DO NOT TOUCH
\`\`\`

## Ready for refactor when

- high pain score
- tests exist
- tests pass
- coverage is acceptable
- few external callers
- no high security sensitivity
- public API can be preserved

## Add tests first when

- the file is complex
- coverage is low
- payment, auth, or security logic is involved
- behavior is unclear

## Refactor rules

- Preserve public APIs.
- Make one extraction at a time.
- Run tests after each extraction.
- Prefer small named helpers over clever abstractions.
- Do not combine refactor with behavior changes.

## Output

Return:
- file name
- why it is ready or not ready
- exact extraction plan
- tests to add or run
`
  ),
  createSkill(
    "vibedoctor-pr-review",
    "Review pull requests and changed files using VibeDoctor. Use when asked to review a PR, check agent-generated code, prepare a PR, summarize app health, or ensure a branch is safe before merge.",
    `
# VibeDoctor PR Review

Focus on changed code.

## Workflow

1. Run:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

2. If available, run tests for changed packages.

3. Read:
   - \`.vibedoctor/report.json\`
   - git diff
   - test output

## Review priority

1. security regressions
2. test failures
3. type errors
4. dependency changes
5. dead code introduced
6. fallback or legacy leftovers introduced
7. refactor risk

## PR comment format

\`\`\`md
## VibeDoctor Review

Health: <score>/100

### Blockers
- ...

### Should fix
- ...

### Safe cleanup
- ...

### Verification
- command: result
\`\`\`

Do not flood the PR with every low-severity lint issue.
`
  ),
  createSkill(
    "vibedoctor-ci-repair",
    "Diagnose and repair CI failures using VibeDoctor, test output, type errors, lint errors, and dependency issues. Use when builds fail, tests fail, GitHub Actions fail, or validation pipelines fail.",
    `
# VibeDoctor CI Repair

Fix the smallest cause first.

## Workflow

1. Inspect the failing command or CI logs.
2. Run:

\`\`\`bash
vibedoctor scan --changed --report json
\`\`\`

3. If the failure is unclear, run:

\`\`\`bash
vibedoctor scan --full --report json
\`\`\`

4. Fix in this order:
   - syntax and type errors
   - failing tests
   - missing dependencies
   - lint blockers
   - security gates
   - coverage gates

## Rules

- Do not disable tests.
- Do not lower thresholds.
- Do not remove security checks.
- Do not edit CI config unless the failure is actually caused by CI config.
- Prefer reproducing locally before patching.

## Final response

Include:
- root cause
- files changed
- command that now passes
- remaining risks
`
  )
];
