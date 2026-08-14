---
title: "Vibe Coding Security Checklist: 15 Things to Check Before You Ship"
description: "A vibe coding security checklist for the hour before you deploy an AI-built app: secrets, auth, RLS, APIs, leftovers, and a local scan."
pubDate: 2026-08-14
draft: false
rank: 1
stage: check
related:
  - how-to-security-test-an-ai-generated-web-app
  - how-to-secure-a-lovable-app
  - how-to-secure-a-bolt-new-app
  - supabase-security-for-vibe-coded-apps
  - production-readiness-checklist-ai-app
---

You already have something that runs. A login works. A table fills. A preview URL looks like a product.

That is the most dangerous moment in vibe coding. The model optimized for “it works when I click around.” Production is what happens when someone who is not you clicks around, then stops clicking and starts sending requests.

This is the flagship [vibe coding security checklist](../vibe-coding-security-checklist/). Fifteen checks, in the order that usually saves you. It is written for people who built with Lovable, Bolt.new, Cursor, Claude Code, Replit, v0, or a mix — and are about to put a hostname on it.

If you want the “why is this even a category” piece first, read [Is vibe coding safe?](../is-vibe-coding-safe/). If you already know the answer and just need to look, stay here.

## How to use this checklist

Do not treat this as a personality test. Treat it as a pre-flight.

- Check the **exported repository**, not only the hosted preview. Preview UIs hide files.
- For each item, write down **where you looked** and **what “done” means**. A tick with no evidence is how you ship the same hole twice.
- If you use Supabase, open the dashboard in another tab and keep it open. Most of the damage lives there, not in React.
- After the manual pass, run a local scan on the tree. A passing preview is not a diagnosis.

VibeDoctor’s job in this story is the last mile: secrets, vulnerable lockfiles, leftover “skip auth” comments, and a completeness grade so a skipped scanner is not mistaken for a clean repo.

## 1. Secrets in source, not in a secrets manager

**Look for:** `sk-`, `sk_live_`, `ghp_`, `AKIA`, `service_role`, Stripe, OpenAI, Resend, and anything that looks like a JWT sitting in `src/`, `lib/`, or a “config” file the model invented.

**Why vibe-coded apps fail here:** the agent needed the call to succeed *now*. Pasting the key into the file is faster than wiring an environment variable, and the preview still works.

**Done means:** no live credential in the tree. Placeholders and `process.env.NAME` only. If a key ever lived in git, rotate it. Deleting the line is not enough. Git remembers.

See [how API keys get exposed in AI-generated apps](../how-api-keys-get-exposed-in-ai-generated-apps/) for the client-bundle and git-history variants of this same hole.

## 2. The public-prefix trick (`VITE_`, `NEXT_PUBLIC_`, `PUBLIC_`)

Frameworks that compile for the browser will inline any variable whose name says it is public. A `VITE_STRIPE_SECRET_KEY` is not a secret. It is a billboard.

**Look for:** every `import.meta.env.*` and `process.env.*` referenced from frontend files. Ask one question: would I print this value on a slide?

**Safe on the client:** Supabase project URL, the **anon / publishable** key, analytics write keys that are designed to be public, feature flags that are not secrets.

**Never on the client:** `service_role`, Stripe secret keys, OpenAI, webhook signing secrets, database URLs, SMTP passwords.

## 3. `.env` is not a security control if git has it

`.env` is a convenience. `.gitignore` is the control. Agents forget the second one constantly.

**Look for:**

- `.env`, `.env.local`, `.env.production` in `git ls-files`
- `.env.example` that contains a real value instead of a placeholder
- A README that says “paste your key here” and then shows a live key

**Done means:** examples are fake, git is clean, and the host’s env panel (Netlify, Vercel, Lovable Secrets, Bolt Secrets) is the only place live values live.

## 4. Authentication exists on the path that matters

A login page is not authentication. Authentication is: an unauthenticated request to a write endpoint is rejected.

**Look for:**

- Routes that check `localStorage.getItem("token")` and then render an admin table
- Edge functions / server routes that trust a `user_id` in the JSON body
- “Skip auth for now” comments the model left behind on purpose

**Done means:** every create, update, delete, download, and admin action verifies a session **on the server**. The UI hiding a button is decoration.

## 5. Authorization is not “the UI only shows my rows”

This is the IDOR that vibe-coded apps ship by default. The list view filters `where user_id = me`. The detail view fetches `/api/invoices/42`. Object 42 belongs to someone else. The API does not care.

**Check:** log in as user A, copy an id belonging to user B, paste it into the URL, the API, or the Supabase client. If you get the row, you are not ready.

**Done means:** the server (or RLS) decides ownership. The client does not.

## 6. The database does not trust the client

If the app talks to Postgres through Supabase (or a similar “client SDK + policies” setup), **row-level security is the product**. The anon key is supposed to be public. RLS is what makes that a feature instead of a breach.

**Look for:**

- Tables with RLS off
- Policies that are `USING (true)`
- Policies that compare `user_id` to a value the client sent, not `auth.uid()`
- A `service_role` key anywhere the browser can see

This is large enough to be its own note: [Supabase security for vibe-coded apps](../supabase-security-for-vibe-coded-apps/).

## 7. Storage buckets are not “just files”

The model will make uploads work by marking the bucket public. That is the whole vulnerability.

**Look for:** public buckets, guessable object paths (`user-id/invoice.pdf` with no policy), missing file-type and size checks, and signed URLs that never expire.

**Done means:** private buckets, storage policies that match the table policies, and uploads that go through a path you could explain to a stranger.

## 8. Server functions authenticate, then authorize, then talk to the world

Lovable Edge Functions, Bolt server functions, Vercel/Netlify functions, and “API routes” the agent invented are where Stripe, email, and admin work should live. They are also where agents leave the door open: no JWT check, CORS `*`, the service role key used for every request.

**Check each function:**

1. Does it verify the caller?
2. Does it check that the caller may do *this* action to *this* row?
3. Does it validate input, or just forward the JSON to Stripe?

## 9. Admin is a role, not a secret URL

`/admin`, `?admin=true`, and “only people who know the link” are not access control. Hosted previews are crawled. Share links leak in Slack.

**Done means:** an admin role stored where the client cannot edit it, checked on the server, and a workspace/private publish setting if the app is not meant for the open internet.

## 10. Dependencies the model added while you were not looking

Agents install packages to make the error go away. Sometimes the package is huge. Sometimes it is abandoned. Sometimes it is the wrong package with a similar name.

**Look for:** a `package.json` you did not review, lockfile churn, and postinstall scripts. Then check known vulnerabilities in the lockfile — do not eyeball versions.

A local OSV-style scan of the lockfile is the adult version of “the install succeeded.”

## 11. Debug, seed, and “temporary” leftovers

Vibe coding leaves residue: seed admin users, `DEBUG = true`, commented-out auth, `TODO: add RLS`, fallback flags, and a second implementation the model did not delete.

These are not style nits. A leftover `bypassAuth` is a backdoor with documentation.

If you built in Cursor or Claude Code, this is the whole plot of [Cursor security risks](../cursor-security-risks/). The broader list lives in [10 security mistakes AI coding agents commonly make](../10-security-mistakes-ai-coding-agents-make/).

## 12. Sessions, cookies, and “remember me” the model invented

If you rolled your own auth (please reconsider), check cookie flags: `HttpOnly`, `Secure`, `SameSite`. If you used a provider, check the redirect URLs, the site URL, and whether email confirmation is actually on.

A surprising number of shipped vibe apps have confirmation disabled “so testers can get in,” then never turn it back on.

## 13. Webhooks and inbound email

Stripe, Resend, GitHub, and Telegram will call you. Those calls are unauthenticated until you verify a signature.

**Look for:** webhook routes that trust the body, no raw-body signature check, and secrets named in frontend env.

**Done means:** verify the signature, reject the rest, and never process the same event twice if that would charge someone twice.

## 14. Personal data in logs, screenshots, and chat transcripts

The model will `console.log(user)` because that is how it debugs. Hosted logs, browser consoles, and the AI chat itself then contain emails, tokens, and sometimes card metadata.

**Done means:** no tokens in logs, no full request bodies in error trackers, and you have not pasted production `.env` into a chat to “just check.”

## 15. Scan the exported tree before the domain goes live

This is the item people skip because the preview looks finished.

Clone or export the project. Look at it as a repository, not as a chat. Then run a check that is allowed to fail.

```bash
npx @neuralaxis/vibedoctor scan --full
```

VibeDoctor runs locally. It folds secret detection, known-vulnerable dependencies, security rules, leftover AI comments, and type/lint signal into one ranked report, and it tells you if a scanner did not actually run. A `PARTIAL` result is not a pass with an asterisk. It is missing evidence.

What to do with the output:

1. Treat secrets and service-role leaks as stop-ship.
2. Recover any `SKIPPED` / timed-out required tool before you argue with the score.
3. Hand `.vibedoctor/agent-plan.md` back to the same agent that built the app, with instructions to fix, not to “make the scan green.”

The longer version of this last step is [how to security-test an AI-generated web app](../how-to-security-test-an-ai-generated-web-app/). The wider “is this actually a product” version is the [production-readiness checklist](../production-readiness-checklist-ai-app/).

## Tool-specific shortcuts

The fifteen items above apply to every stack. The failure mode is not identical.

| If you built with | Read next |
| --- | --- |
| Lovable + Supabase | [How to secure a Lovable app](../how-to-secure-a-lovable-app/) |
| Bolt.new | [How to secure a Bolt.new app](../how-to-secure-a-bolt-new-app/) |
| Cursor / Claude Code / Copilot | [Cursor security risks](../cursor-security-risks/) |
| Any of the above + Supabase | [Supabase RLS, auth, and the mistakes that matter](../supabase-security-for-vibe-coded-apps/) |

## What this checklist is not

It is not a pentest. It is not “what is SQL injection.” It is not a promise that a green scan means you are safe.

It is the set of questions that sit closest to the moment you type a custom domain into a registrar. Ten people who have a Lovable app open in another tab are worth more than a thousand people studying OWASP for a class.

Work the list. Then measure the tree.
