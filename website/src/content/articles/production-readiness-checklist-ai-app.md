---
title: "Your AI App Works. But Is It Production Ready? A Pre-Launch Checklist"
description: "A production readiness checklist for AI-built apps: security, headers, auth, dependencies, accessibility, performance, and a final local scan."
pubDate: 2026-08-14
draft: false
rank: 10
stage: check
related:
  - vibe-coding-security-checklist
  - how-to-security-test-an-ai-generated-web-app
  - 10-security-mistakes-ai-coding-agents-make
  - how-api-keys-get-exposed-in-ai-generated-apps
---

A working preview is not a release. A **production readiness checklist** for an AI-built app has to cover more than XSS trivia and less than a 40-page launch playbook.

This is the wide pass: security, headers, auth, dependencies, accessibility, performance, and the deployment mistakes agents make when “just put it online” is the prompt. Use it when the product works and you are asking whether it is an **AI app launch** or a public incident.

Security is necessary and not sufficient. If you have not done the security-shaped work yet, start with the [vibe coding security checklist](../vibe-coding-security-checklist/) and the [security-test note](../how-to-security-test-an-ai-generated-web-app/). Then come back.

## 1. You can name what you are launching

Write it down:

- Who it is for
- Whether sign-up is open
- What personal data you keep
- What happens if the host bill goes unpaid (the database still exists)

If you cannot name the data, you are not ready to promise anyone an account.

## 2. Security stop-ships are actually clear

Do not launch with any of these open:

- Live secret in source, git history, or the JS bundle
- Service-role / admin database key in the client
- User B can read or write user A
- Payments trust the client’s price
- A public bucket of private files

Details live in the [secrets](../how-api-keys-get-exposed-in-ai-generated-apps/) and [ten mistakes](../10-security-mistakes-ai-coding-agents-make/) notes. This line on the launch list is binary.

## 3. Auth in production configuration

- Site URL and OAuth redirect allow-list point at the real domain, not only `localhost`
- Email confirmation matches the decision you wrote down
- Invite-only apps have sign-up disabled
- Session expiry is not “never” because that made QA easier
- You have a way to revoke a user without redeploying

## 4. Dependencies and the lockfile

- You have read `package.json` / `pyproject.toml` since the last agent session
- The lockfile is committed
- Known-vulnerable packages are upgraded or explicitly accepted
- No leftover “experimental” HTTP client from prompt four

A lockfile scan is part of a full VibeDoctor run. Do not substitute “npm install succeeded.”

## 5. Headers and host hygiene

On the **custom domain**, not only the preview:

- HTTPS, and HTTP redirects to it
- Preview/basic-auth if the staging site has real data
- No directory listing
- Cookies you set yourself are `Secure` + `HttpOnly` + a sane `SameSite`
- Error pages do not dump stacks

You do not need a perfect CSP on day one. You do need to not ship with `index of /`.

## 6. Accessibility is a launch bug, not a phase

Agents produce pretty, unlabelled UI. Before you call it done:

- Every input has a visible label (not only a placeholder)
- Focus is visible
- Keyboard can reach login, pay, and submit
- Images that mean something have alt text; decorative ones do not lie
- Colour is not the only error signal
- `prefers-reduced-motion` does not leave the page unusable

This is not a full WCAG audit. It is the difference between “we launched” and “half the users cannot pay.”

VibeDoctor will not grade your contrast. Do not pretend a repo scan covers this.

## 7. Performance: the first load, not the Lighthouse flex

AI apps drag in icon packs, three fonts, and a client-side fetch waterfall.

- One font family unless you have a reason
- Images sized; not 4k hero PNGs
- The first meaningful view does not wait for five sequential APIs
- A loading state that is not an infinite spinner if the function 500s

If the first paint is unusable on a phone, you did not launch a web app. You launched a trailer.

## 8. The deploy is reproducible

Agents love “download the zip and drag it to Netlify.” That is a demo.

**Production:**

- A git repo with a main branch you understand
- Env vars set **on the host**, not in a committed file so the build passes
- Preview deploys do not share live payment keys unless you accept that
- You can roll back without asking the model to remember last Thursday
- Logs exist somewhere you will actually look

Lovable, Bolt, Vercel, Netlify, and “I deployed from the chat” each have two env panels. Confirm both.

## 9. Privacy and the boring pages

If you collect emails or files:

- A real privacy page, not a lorem block the agent wrote
- A way to delete an account
- Logs that do not print tokens
- You know which region the database lives in

If you are in India and you think you need DPDP, VibeDoctor’s `dpdp scan` produces **technical readiness evidence**, not a legal opinion. Do not put “DPDP compliant” on the homepage because a tool printed a score.

## 10. Observability that will wake a human

- Errors go somewhere (even an email)
- Payments have a reconciliation path
- You know how to rotate the keys you used
- Someone is on the hook the week after launch

An AI-built app with no owner is an abandoned building with a domain.

## 11. The final automated check on the tree

After the human list, freeze a commit and run a local diagnosis.

```bash
npx @neuralaxis/vibedoctor scan --full
```

Read, in order:

1. Completeness — `COMPLETE` / `PARTIAL` / `INVALID`
2. Blockers — secrets, failing required tools
3. Coverage table — what did not run
4. `.vibedoctor/agent-plan.md` — the next edits

Then, if you want the same agent that built the app to work the plan:

```bash
npx @neuralaxis/vibedoctor agent-plan --format markdown
npx @neuralaxis/vibedoctor agent init --targets all
```

Re-test the stop-ships after it finishes. Agents will weaken a check to clear a finding. [How to security-test](../how-to-security-test-an-ai-generated-web-app/) is the loop.

## What VibeDoctor covers on this checklist

| Item | VibeDoctor |
| --- | --- |
| Secrets, leftover debug, lockfile vulns, lint/types | Yes, locally, with disclosed coverage |
| RLS / live IDOR / webhook signatures | No. That is you and two browsers |
| Accessibility, performance, legal copy | No |
| “Is this a good product?” | No |

That split is the point. A **production readiness checklist** that pretends a scanner did the whole launch is how you get a green badge on an open database.

## Ship / don’t ship

**Don’t:** any stop-ship in §2, no rollback, no idea what data you hold.

**Ship with a dated list:** known a11y gaps, a font you will delete, a header you will tighten, a `PARTIAL` scan you recovered the next morning.

**Ship clean:** two-user test passed, secrets rotated and gone from the bundle, lockfile reviewed, host env set, first-load acceptable, someone awake.

Your AI app works. Production-ready means you can defend the hostname. Run the list. Then run the scan.
