export type SkillTemplate = {
  name: string;
  description: string;
  content: string;
  openAiMetadata: string;
};

function quoteYamlString(value: string): string {
  return JSON.stringify(value);
}

function toDisplayName(name: string): string {
  return name
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function createOpenAiMetadata(name: string, description: string): string {
  return [
    "interface:",
    `  display_name: ${quoteYamlString(toDisplayName(name))}`,
    `  short_description: ${quoteYamlString(description)}`,
    `  default_prompt: ${quoteYamlString(`Use ${name} for this repository.`)}`,
    "  brand_color: \"#2563EB\"",
    "policy:",
    "  allow_implicit_invocation: true",
    ""
  ].join("\n");
}

function createSkill(name: string, description: string, body: string): SkillTemplate {
  return {
    name,
    description,
    openAiMetadata: createOpenAiMetadata(name, description),
    content: [
      "---",
      `name: ${name}`,
      `description: ${quoteYamlString(description)}`,
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

4. Check \`completeness.status\` before changing code:
   - \`complete\`: the score is comparable and findings can be prioritized.
   - \`partial\` or \`invalid\`: run every command in \`recoveryActions\` first.
   - If recovery fails, disclose the missing coverage and request human review before risky edits.

5. Prioritize validated findings in this order:
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
- scan completeness and any missing tool coverage

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
    "vibedoctor-privacy-review",
    "Review VibeDoctor Privacy Review findings with masked evidence, deterministic scan output, and optional API-key adjudication. Use when asked to find PII, review personal data exposure, inspect shift-report data risk, or validate Privacy Review findings.",
    `
# VibeDoctor Privacy Review

Use this skill for personal-data and PII discovery findings.

## Default workflow

1. Run the deterministic privacy scan:

\`\`\`bash
vibedoctor scan --category privacy --report json
\`\`\`

2. Read \`.vibedoctor/report.json\`, focusing on \`privacyFindings\`.

3. Group findings into:
   - confirmed regulated identifiers
   - likely personal data
   - combination-risk fields
   - false positives or needs human review

4. Use masked evidence only. Do not request raw values unless the user explicitly asks and the repository policy allows it.

## Optional API-key review

Only run this command when \`checks.privacy.ai.enabled\` is true and the required env vars are configured:

\`\`\`bash
vibedoctor privacy-review --refresh --format markdown
\`\`\`

## Review rules

- Keep secrets separate from PII; Gitleaks findings are handled by the security workflow.
- Treat medium-confidence Privacy Review findings as review candidates, not automatic truth.
- For regulated identifiers or sensitive attributes, recommend removal, anonymization, or controlled test fixtures.
- For combination risk, explain which fields create the re-identification risk together.

## Output

Return:
- confirmed PII findings
- likely false positives
- evidence used
- recommended action
- whether API-key review was used
`
  ),
  createSkill(
    "vibedoctor-dpdp-readiness-review",
    "Run DPDP technical readiness review using deterministic VibeDoctor DPDP artifacts. Use when asked about DPDP, India data protection technical controls, personal-data maps, consent/erasure gaps, processor signals, or engineering risk against DPDP — never for legal certification.",
    `
# VibeDoctor DPDP Readiness Review

This skill supports **DPDP technical readiness / engineering-risk assessment**.
It is **not** legal advice and **not** a compliance certification.

## Hard rules

1. Consume deterministic artifacts; do not implement a competing compliance engine.
2. Never independently mark DETERMINISTIC controls as passed if the control matrix says otherwise.
3. Never invent evidence.
4. Never claim legal certification.
5. Never calculate a separate legal compliance percentage or score.
6. Declared evidence is not deterministic verification.
7. Preserve provenance and uncertainty in every answer.
8. After code changes, re-run deterministic verification.
9. Treat the bundled legal-source manifest as a versioned offline baseline, not proof that the law is current.

## Legal-source freshness gate

Perform this gate whenever the answer interprets a control against DPDP law, rules, commencement, or enforcement status.

1. Read \`legalSourceVersion\` and the legal citations in the control matrix or report.
2. Use current web research to find the latest official primary sources. Check, as applicable:
   - the Digital Personal Data Protection Act and later amendments
   - final Rules and later amendments or corrigenda
   - commencement and enforcement notifications
   - Data Protection Board or other notifications only when relevant to the controls under review
3. Prefer official Government of India sources, including \`meity.gov.in\`, \`indiacode.nic.in\`, and \`egazette.nic.in\`. Search results, blogs, news, and law-firm summaries may help discovery but are not authority.
4. For each official source used, record its title, URL, Act/Gazette/notification identifier, publication date, effective date or phased schedule, and the date checked. Use exact citations; do not reproduce long passages.
5. Compare the current official sources with the bundled manifest and its \`legalSourceVersion\`.
6. If an official source is newer or materially different, label the result \`LEGAL_SOURCE_DRIFT\`. Identify affected control IDs and citations, keep the deterministic technical statuses unchanged, and recommend updating the versioned catalogue plus qualified legal review.
7. If live research is unavailable, official pages cannot be reached, or currency cannot be established, label the result \`CURRENT_LEGAL_SOURCES_NOT_VERIFIED\`. You may use the bundled manifest as an offline baseline, but do not claim the legal position is current.
8. Never silently use live research to change deterministic findings, scores, or control statuses. Present current-law observations separately from technical scan results.

## Default workflow

1. Run or refresh the deterministic scan:

\`\`\`bash
vibedoctor dpdp scan --full
\`\`\`

2. Read these artifacts (source of truth):
   - \`.vibedoctor/dpdp/data-map.json\`
   - \`.vibedoctor/dpdp/control-matrix.json\`
   - \`.vibedoctor/dpdp/evidence-ledger.json\`
   - \`.vibedoctor/dpdp/review-queue.md\`
   - \`.vibedoctor/dpdp/agent-handoff.md\` (or run \`vibedoctor dpdp handoff\`)

3. Do **not** re-ask questions already answered by deterministic evidence.

4. Group unresolved questions by audience from the review queue:
   - developer
   - security
   - product
   - legal
   - operations
   - founder

5. Ask the **minimum** number of questions needed.

6. Review any supplied policies and \`.vibedoctor/dpdp/evidence.yml\` declarations.
   Compare declared policy against implementation signals in the data map.

7. Produce remediation grouped into:
   - code
   - configuration
   - documentation
   - organisational work

8. After code/config changes:

\`\`\`bash
vibedoctor dpdp verify
\`\`\`

## Output format

\`\`\`text
DPDP technical posture (not legal compliance):
Legal-source freshness: verified as of <date> | LEGAL_SOURCE_DRIFT | CURRENT_LEGAL_SOURCES_NOT_VERIFIED
Official sources checked:
Bundled-manifest drift:
Evidence completeness:
Personal-data categories:
Stores / external recipients:
Verified technical risks (violations):
Partial controls:
Human-review items (by audience):
Skipped capabilities:
Fix-next (code/config first):
Questions still needed:
What was not verified:
\`\`\`

## Scoring language

Only cite scores from the deterministic report:
- technical posture score
- evidence completeness percentage
- open-risk counts by severity
- status counts

Label them as **technical readiness**, never as legal compliance.
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
