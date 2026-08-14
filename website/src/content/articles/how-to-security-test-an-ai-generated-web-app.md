---
title: "How to Security-Test an AI-Generated Web App Before Launch"
description: "A practical website security test for AI-generated apps: export the repo, abuse the API, check secrets, then run a local VibeDoctor scan."
pubDate: 2026-08-14
draft: false
rank: 9
stage: check
related:
  - vibe-coding-security-checklist
  - production-readiness-checklist-ai-app
  - how-api-keys-get-exposed-in-ai-generated-apps
  - supabase-security-for-vibe-coded-apps
---

A **website security test** for an AI-built app is not a red-team engagement and it is not a CVE reading list. It is a few hours of dishonest use, pointed at the app you are about to bless with a domain.

The model tested the happy path. You need the other path: the user who never opens your React tree and talks to the API anyway.

This is the closest article in the library to actually running VibeDoctor. The human work still comes first. The scanner is what keeps you honest about the files.

## 0. Freeze a copy

You cannot test a moving chat.

- Export or `git clone` the project.
- Record the commit or export timestamp.
- Put production-like env values in the **host’s** secret store, not in a file you will commit.
- If the app is already on a preview URL, treat that URL as public while you work.

If you do not have the files on disk, you are testing a demo, not a release.

## 1. Map what you actually shipped

Write a half-page inventory. If you cannot, you are not ready to test.

- Auth provider and who may sign up
- Tables / collections and whether each is personal, shared, or public
- File storage
- Payments and webhooks
- Email / SMS
- Admin
- Background jobs / Edge Functions / “API routes”
- Third-party keys (OpenAI, Stripe, Maps, analytics)

AI apps hide whole backends behind one `lib/supabase.ts`. The inventory is how you notice the `debug` function the model added in pass four.

## 2. Static pass on the tree (20 minutes)

Before you click anything, search the repo like an attacker who cloned it.

```text
sk_live_   sk-    ghp_    AKIA    service_role
password   apiKey   BEGIN PRIVATE   webhook
VITE_     NEXT_PUBLIC_    PUBLIC_
TODO      FIXME     skip auth    disable RLS
```

Open `package.json` and read every dependency as if you had to defend it on a call. Agents add packages you will not recognize. That is a finding, not a style note.

Then run the local diagnosis:

```bash
npx @neuralaxis/vibedoctor init
npx @neuralaxis/vibedoctor setup
npx @neuralaxis/vibedoctor scan --full
```

Read the coverage table first, not the score. If gitleaks or osv-scanner is `not installed` or `timed out`, the report is `PARTIAL`. That is a test-environment problem, not a clean app.

What VibeDoctor is for here:

- Hardcoded credentials and high-entropy tokens
- Known-vulnerable lockfile entries
- Semgrep-shaped insecure patterns, when that tool is present
- Leftover AI comments and half-removed auth
- A ranked list and an `agent-plan.md` you can hand back to Cursor or Claude

What it is **not** for:

- Proving your RLS policies are correct
- Clicking through the live site
- A pentest report you can show an auditor as if a human signed it

The [vibe coding security checklist](../vibe-coding-security-checklist/) is the human twin of this step.

## 3. Build a second user. Then be rude.

Create users A and B. If the product has an admin, that is user C.

**Authn**

- Open every “logged-in only” URL while signed out. You want a 401/403 from the **server**, not a React redirect you can bypass.
- Replay a request from A’s session after logout. Sessions should die.
- If email confirmation is off, write down why.

**Authz (this is the test that finds the bug)**

- As A, create an object (invoice, doc, message).
- Copy its id.
- As B, fetch `/api/.../{id}` or run the Supabase client against that id.
- As B, try `PATCH` and `DELETE`.
- As signed-out, try the same.

If B reads A’s row, you have an IDOR. In Supabase apps this is almost always [RLS](../supabase-security-for-vibe-coded-apps/), not a missing `if` in React.

**Admin**

- Hit `/admin` as B.
- Hit the admin Edge Function as B with a guessed JSON body.
- Change your own `role` column from the client if the table is exposed. If it works, anyone is admin.

## 4. Ignore the UI

Open the browser network tab. Repeat the create/list calls with curl or the console, mutating:

- `user_id`
- `org_id`
- `price` / `amount` / `quantity`
- `role`
- file `content-type`

Frontend validation is a courtesy. If the server accepts `amount: 1` on a $1,000 SKU, that is the product.

## 5. Storage and exports

- Upload a tiny HTML file or a double extension (`notes.pdf.html`) if you allow uploads.
- Try to read A’s object URL as B and signed out.
- If paths are sequential (`/files/1`, `/files/2`), walk them.
- Download the “export my data” path as B with A’s id.

## 6. Secrets that only appear at runtime

Static search misses keys that are injected at build time and then baked into the JavaScript bundle.

- Open the deployed app.
- View source / the largest JS chunk.
- Search for `supabase`, `sk_`, `eyJ`, `service_role`.

If a secret is in the bundle, rotate it. Then read [how API keys get exposed](../how-api-keys-get-exposed-in-ai-generated-apps/) so you do not put it back with a `VITE_` prefix.

## 7. Webhooks and inbound routes

For each URL a third party will POST to:

- Send a random JSON body. It should fail signature check.
- Send a valid-looking event twice. You should not double-charge or double-provision.
- Confirm the signing secret is not in the frontend.

## 8. Headers and host mistakes (fast)

On the production hostname:

- HTTPS redirects
- No directory listing
- Preview deployments are not the custom domain with debug on
- Cookie flags if you set cookies yourself
- `robots.txt` is not your only auth

This is shallow on purpose. Deep header theology is a different job. The [production-readiness checklist](../production-readiness-checklist-ai-app/) covers the non-security half (perf, a11y, deploys).

## 9. Close the loop with the same agent that built it

Do not paste “fix security” into the chat. Paste evidence.

```text
Here is .vibedoctor/agent-plan.md and the two-user test notes.
Fix in listed order. Do not disable RLS. Do not move the service
role key into VITE_. After each change I will re-run:
npx @neuralaxis/vibedoctor scan --changed
```

If you use Cursor, Claude, Codex, or Copilot, `npx @neuralaxis/vibedoctor agent init --targets all` wires the protocol so the agent is supposed to recover `PARTIAL` scanners and run `verify` instead of declaring victory.

Then **you** repeat the two-user test. Agents regress policies to make the UI green.

## A one-sitting script

| Minute | Work |
| --- | --- |
| 0–10 | Export, inventory |
| 10–30 | Repo search + `scan --full` |
| 30–70 | Two-user IDOR + admin |
| 70–90 | Bundle search, webhooks, storage |
| 90–120 | Agent-plan fixes + `scan --changed` + re-test |

If you cannot spare two hours, you cannot spare the incident either.

## When to stop

Stop-ship:

- Any live secret in source or bundle
- Service role in the client
- User B can read or write user A
- Payments trust the client’s price
- Required scanners never ran and you shipped on the score anyway

Everything else goes on a dated list. Ship with known debt if you must — but write it down. “We’ll add RLS later” is how later becomes a screenshot on Twitter.

Start with the [15-point checklist](../vibe-coding-security-checklist/) if you have not already. Then measure the tree, not the vibe.
