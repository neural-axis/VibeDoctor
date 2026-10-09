---
title: "How to Secure a Lovable App Before You Deploy It"
seoTitle: "How to Secure a Lovable App Before You Deploy"
description: "Lovable security checklist: Edge Functions, Secrets, Supabase RLS, auth, public previews, and what to scan after you export the repo."
pubDate: 2026-08-14
draft: false
rank: 3
stage: tool
related:
  - vibe-coding-security-checklist
  - supabase-security-for-vibe-coded-apps
  - how-api-keys-get-exposed-in-ai-generated-apps
  - how-to-security-test-an-ai-generated-web-app
---

Lovable will get you a working product faster than you can explain the product. That is the point. It is also why **Lovable security** is a search people type with a finished app sitting in the other tab.

This is not a generic “secure your React app” note with the word Lovable taped on. Lovable apps have a specific shape: a public frontend, Edge Functions as the real backend, and — very often — Supabase as the database, auth, and storage. The browser is hostile. The Edge Function is the boundary. RLS is the last lock on the door.

If you only remember one sentence: **the frontend is a brochure.** Anyone can read it, change it, and call your backend without using your UI.

Lovable’s own security guide says the same thing, more politely. This note is the pre-deploy pass for people who already clicked Publish once in their head.

## What you are actually shipping

A typical Lovable app is three layers:

1. **Frontend** — React in the browser. Always public. Never trusted.
2. **Edge Functions** — server-side. Auth, payments, secrets, validation.
3. **Database** — Postgres + [row-level security](../supabase-security-for-vibe-coded-apps/). The last policy that still runs if the frontend lies.

Lovable will set up basic RLS and will nag you in the Security view. That is useful. It is not a substitute for you proving that user A cannot read user B.

Work in this order: **secrets → auth → RLS → storage → Edge Functions → publish settings → export and scan.**

## 1. Secrets: Lovable Secrets, not `VITE_`

Lovable has a Secrets feature for a reason. Values that belong there: Stripe secret keys, OpenAI, Resend, webhook signing secrets, the Supabase **service role** key.

Values that may live in frontend env: the Supabase URL and the **anon / publishable** key. Those are designed to be public *if and only if* RLS is correct.

**Do this now:**

- Open the project files and search for `sk-`, `sk_live_`, `service_role`, `eyJ` (JWT-looking blobs), and `Bearer`.
- Search for `VITE_` and read every name. If you would not print it on an invoice, it does not get that prefix.
- Ask Lovable, in those words: *Review frontend code for exposed secrets, API keys, or sensitive information.* Then verify the diff. Do not accept “I moved it” without opening the file.

If a live key was ever in the frontend, treat it as stolen. Rotate it in the provider dashboard. Removing the line from the file is hygiene, not containment.

The longer map of leak paths — git history, bundles, logs, chat — is [how API keys get exposed](../how-api-keys-get-exposed-in-ai-generated-apps/).

## 2. Authentication that the server can see

Lovable apps love this pattern:

```ts
const token = localStorage.getItem("authToken");
if (token) showAdmin();
```

That is a costume. The user can write any token they like, or skip the page and hit the function.

**Done looks like:**

- Sign-in uses Supabase Auth (or another real provider), not a homemade password table the model invented on Tuesday.
- Edge Functions call `supabase.auth.getUser()` (or verify the JWT) on every sensitive request.
- Roles live in a table or `app_metadata` the user cannot update from the client.
- Email confirmation is on unless you have a written reason it is off.

Prompt worth pasting:

> Move every authorization decision out of React components and into Edge Functions. Reject unauthenticated requests with 401. Do not trust user_id from the request body.

## 3. RLS: the actual product

Misconfigured RLS is the most common way a Lovable app leaks. The model needs the table to return rows so the UI is not empty, so it writes a policy that returns rows.

Open **Cloud → Database → RLS policies**. For every table that is not deliberately public:

| Question | Bad answer |
| --- | --- |
| Is RLS enabled? | Off, “so I can see data in the table editor” |
| Who can `SELECT`? | `USING (true)` |
| Who can `INSERT` / `UPDATE` / `DELETE`? | Missing policy, or same as select |
| Does the policy use `auth.uid()`? | It compares to `user_id` sent by the client |
| New table you added last night? | Forgot entirely |

Then do the test the dashboard cannot do for you:

1. Create two users.
2. As user A, create a row.
3. As user B, try to read it through the deployed app **and** through the Supabase client in the browser console, by id.

If user B can see it, you are not ready, no matter what the Security view says.

Team/org apps need a membership table and policies that join through it. “I’ll filter by `org_id` in the React query” is not a policy.

## 4. Storage

Lovable will make uploads work. The fastest way is a public bucket.

**Check:**

- Bucket is private unless the files are meant to be on the open web.
- Storage policies match the table policies (owner can write, nobody else can read).
- Object paths are not `invoices/{id}.pdf` with a public URL.
- File type and size are enforced in an Edge Function, not only in `<input accept>`.

## 5. Edge Functions: the only place Stripe should live

Anything that charges a card, sends mail, mints a signed URL, or uses the service role belongs in an Edge Function.

Audit each function as if a stranger will call it with curl:

1. **Authn** — who is this?
2. **Authz** — may they do this to this object?
3. **Validate** — is the payload the shape you expect, within limits?
4. **Least privilege** — does this function really need the service role, or would the user’s JWT plus RLS suffice?

A function that uses the service role to “just upsert the profile” is a root shell with extra steps. Prefer the user-scoped client unless you are doing an admin job that RLS cannot express.

Also check CORS. `Access-Control-Allow-Origin: *` on a function that accepts credentials is how a random site becomes your frontend.

## 6. Payments, webhooks, and “it worked in test mode”

If you added Stripe (or similar) via prompt:

- Secret key in Secrets, never in the client.
- Price and quantity computed on the server. Never trust `amount` from the browser.
- Webhook signature verified on the raw body.
- Test keys and live keys are not mixed.
- Success screens do not grant entitlement. The webhook does.

## 7. Publish settings are a security control

Lovable preview and publish are easy to confuse when you are tired.

- An app that is an internal tool should be **workspace**, not public.
- “Anyone with the link” is still the internet.
- Review who is in the workspace. Agents do not revoke contractors.
- Before a custom domain: walk Lovable’s **Security view** and treat critical findings as blockers, not suggestions.

Then export or sync to GitHub. You need the files.

## 8. After export: look at it as a repository

Hosted builders hide the boring files. The boring files are where the key is.

Once the repo is on disk:

```bash
npx @neuralaxis/vibedoctor scan --full
```

VibeDoctor is not a Lovable-hosted scanner and it will not log into your Supabase project. It will tell you if the exported tree still contains credentials, known-vulnerable packages, leftover “TODO add auth” comments, and whether the security scanners actually finished. That is the honest complement to Lovable’s own Security view: one looks at the project in Lovable, the other looks at the code you are about to own.

Use the [vibe coding security checklist](../vibe-coding-security-checklist/) as the human pass. Use [how to security-test an AI-generated web app](../how-to-security-test-an-ai-generated-web-app/) for the abuse cases (IDOR, webhook replay, storage enumeration).

## A Lovable-specific prompt you can paste after the scan

> Here is a VibeDoctor report / agent-plan. Fix the findings in order. Do not weaken RLS to make a query succeed. Do not put secrets in frontend env. Do not mark buckets public. After each change, keep auth checks in Edge Functions.

If the agent “fixes” a finding by deleting the check, that is a regression. Read the diff.

## Related

Bolt.new has the same *class* of problem and a different machine: WebContainers, a Secrets tab on the database icon, Netlify-shaped deploys. Do not reuse this page as a Bolt runbook — use [How to secure a Bolt.new app](../how-to-secure-a-bolt-new-app/).
