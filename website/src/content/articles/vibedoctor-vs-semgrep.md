---
title: "VibeDoctor vs Semgrep: Diagnosis and Security Rules"
description: "Semgrep is a security analysis engine VibeDoctor can use. See where local rules, repository diagnosis and agent repair plans fit together."
pubDate: 2026-10-10
stage: check
related: [vibedoctor-vs-snyk, gitleaks-alternatives, how-to-security-test-an-ai-generated-web-app]
---

VibeDoctor and Semgrep overlap because VibeDoctor can run Semgrep as one of its engines. If you already use Semgrep, adding VibeDoctor changes how you organize repository evidence; it does not automatically improve Semgrep's detection.

## Engine versus diagnosis

[Semgrep Community Edition](https://semgrep.dev/products/community-edition) analyzes source with customizable rules and supports local CLI scans. Semgrep also offers platform products with their own capabilities. This article compares the local rule-scanning role with VibeDoctor's repository workflow, not every Semgrep offering.

| Need | Starting point |
| --- | --- |
| Write a precise security rule for a dangerous API | Semgrep and a tested rule |
| Tune a rule's false positives | Semgrep rule tests and configuration |
| Combine security with failed types, tests, dead code and flow signals | VibeDoctor |
| Turn combined evidence into ordered agent work | VibeDoctor reports and MCP tools |
| Operate a team security platform | Evaluate the relevant Semgrep platform features |

This is a comparison by VibeDoctor's makers. It is not a head-to-head benchmark, and no detection-rate advantage is claimed.

## Use the engine directly when the rule is the task

Suppose every payment handler must verify the provider's signature before processing an event. A rule targeting your framework can help prevent a known unsafe pattern from returning. Test that rule against both intentionally broken and valid handlers.

Semgrep documents [local CLI scans](https://semgrep.dev/docs/category/local-and-cli-scans). Choose rule sources deliberately, inspect findings and check scan errors. A matching pattern is useful evidence; an absent match is not proof that your application's payment logic is correct.

## Use VibeDoctor when the repository needs a repair sequence

An AI-written feature can have several connected problems: a frontend calls an absent route, the fallback hides the error, unused code remains, and the tests exercise only the happy path. VibeDoctor's built-in flow checks and applicable engines help put these findings into one report.

```bash
npx @neuralaxis/vibedoctor scan --full --report agent-json
```

Semgrep must be available for its part of that scan. VibeDoctor reports a missing, failed or timed-out engine instead of counting it as clean. Check [how scanning works](/how-it-works/) before interpreting the score.

## A sensible combined workflow

Keep your existing tested Semgrep rules and security gate. Run VibeDoctor to identify the next repository repair, reproduce it and make a focused change. Then rerun both the regression test and the security rules relevant to that change.

For access control, add a two-user runtime test. For secrets, inspect source and the production bundle. For external integrations, verify actual signatures and failure paths. These checks resolve uncertainties that neither a static rule nor a combined score can settle alone.

See the [AI-generated app security test](../how-to-security-test-an-ai-generated-web-app/) for that verification sequence.
