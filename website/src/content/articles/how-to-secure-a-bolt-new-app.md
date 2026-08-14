---
title: "How to Secure a Bolt.new App Before Going Live"
description: "Bolt.new security before you publish: WebContainer dependencies, Secrets vs VITE_, database rules, share vs publish, and a local scan of the export."
pubDate: 2026-08-14
draft: false
rank: 4
stage: tool
related:
  - vibe-coding-security-checklist
  - how-to-secure-a-lovable-app
  - how-api-keys-get-exposed-in-ai-generated-apps
  - how-to-security-test-an-ai-generated-web-app
---

Bolt.new feels like an IDE that happens to live in a browser: a file tree, a terminal, a preview, an agent that will `npm install` its way out of an error. That is why **Bolt.new security** is a different job from [securing a Lovable app](../how-to-secure-a-lovable-app/).

Lovable’s default shape is frontend + Edge Functions + Supabase. Bolt’s default shape is *whatever the agent just scaffolded* — Vite, Next, Expo, a SQLite experiment, a Supabase client, Bolt’s own database and server functions — running in a WebContainer until you publish.

Keep this page tool-specific. If your Bolt app happens to use Supabase, also read [Supabase RLS](../supabase-security-for-vibe-coded-apps/). Do not skip the Bolt-only items below.

## The machine you are on

Bolt runs Node in the browser via WebContainers. That has consequences:

- The agent can add **any npm package**. Supply chain is not theoretical.
- There is a real file tree, including `.env` files the agent will happily write.
- “It runs in the preview” does not mean the host’s env panel has the same values.
- Sharing a project and **publishing a site** are different doors. Bolt has been explicit that env vars should not be visible to viewers — believe that only after you have checked the built JavaScript.

Work in this order: **inventory → secrets → database/auth → server functions → dependencies → share/publish → export and scan.**

## 1. Inventory the stack the agent chose

Before you harden anything, write down what Bolt actually generated.

- Framework: Vite? Next? Something else?
- Where server code lives: Bolt server functions, Next route handlers, none?
- Database: Bolt’s built-in database, Supabase, Firebase, Prisma-to-nowhere?
- Auth: built-in users, Supabase Auth, Clerk, a homemade table?
- Payments, email, AI calls

Two Bolt apps do not share a threat model. A static marketing site with a form is not a multi-tenant SaaS with uploads. The agent will treat them the same unless you do not.

## 2. Secrets: the Secrets tab is not the same as `VITE_`

Bolt stores server secrets under the **database icon → Secrets**. That is the correct home for OpenAI keys, Stripe secret keys, webhook secrets, and database admin credentials. Server functions read them. The browser should not.

Separately, Vite/Next-style env files still exist in the tree.

**Bolt-specific checks:**

- Open Secrets. Confirm each value is something a server function needs.
- Open `.env` / `.env.local`. If a secret is here *and* the name starts with `VITE_`, `NEXT_PUBLIC_`, or `PUBLIC_`, it will ship in the client bundle when referenced from frontend code.
- Search the repo for `import.meta.env` and `process.env`. Read every name.
- Search for `sk-`, `sk_live_`, `service_role`, `AKIA`, `ghp_`.
- If you asked Bolt to “integrate OpenAI,” it may have built the call and then prompted you to add a secret. Confirm the call site is a **server function**, not a React `useEffect`.

Bolt’s own docs say not to store secrets in plain text in code. Agents still do it when you paste a key into the chat “just to get it working.”

If a key was in a file or a prompt, rotate it. Read [how API keys get exposed](../how-api-keys-get-exposed-in-ai-generated-apps/) before you put a new one in a `VITE_` slot.

## 3. Publish vs share vs “private”

Bolt has grown a real distinction:

- **Share the project** — collaborators, sometimes a public project page.
- **Publish the site** — a hostname, with public or private visibility on some plans.

Check all three:

1. Project visibility. Is the source sitting on a link you posted in a launch tweet?
2. Site visibility. Internal tools should not be public just because publish was one click.
3. Environment. Preview and production must not share live Stripe keys with a public preview if you can avoid it.

Environment variables not being shown in the share UI is necessary and not sufficient. The **built bundle** is the ground truth. Open the published site, search the JS for the key prefix.

## 4. Database and auth, in *this* project’s dialect

### If you used Bolt’s database

Open the database settings (auth, tables, file storage, logs, secrets, server functions, users). For each table:

- What is the access rule for read and write?
- Is there a user id, and is it taken from the session or from the request body?
- Are new tables you added yesterday still on “open so the agent could see rows”?

File storage gets the same review. Public buckets are how uploads “just work.”

### If you used Supabase from Bolt

You now have two dashboards. The service role key must live in Bolt Secrets or the host env, never in the Vite client. Policies live in Supabase. Do the two-user test described in the [Supabase note](../supabase-security-for-vibe-coded-apps/).

### Auth

- Sign-up policy matches intent (open, invite, closed).
- Session checks happen in server functions, not only in a React guard.
- The first seeded user is not `admin@example.com`.
- Logout invalidates whatever you use as a session.

## 5. Server functions: assume curl, not the preview

List every server function. For each one, from a mental curl prompt:

1. Is the caller authenticated?
2. Can they act on **this** row?
3. Does the function use a secret it actually needs?
4. Does it trust `price`, `role`, or `userId` from the body?
5. CORS: is every origin allowed?

A function that calls OpenAI with your key and no auth is a public proxy. People will find it.

## 6. The npm tree the agent built while you watched the preview

This is the Bolt-shaped risk Lovable has less of. WebContainers make `npm install leftover-debugger` cheap.

Open `package.json`:

- Do you know each dependency?
- Any install scripts that fetch remote code?
- Did the agent add a second HTTP client, a second auth library, a “temporary” ORM?

Then check the lockfile for known vulnerabilities after you export. Do not trust “the preview started” as a supply-chain review.

## 7. Headers, hosting, and the second env panel

Bolt can publish on its own hosting or you can push to GitHub and deploy to Netlify/Vercel/Northflank/etc.

The second platform has a **second env panel**. People set secrets in Bolt, deploy via GitHub, and production starts with empty env — or worse, with the `.env` that accidentally got committed so the build would work.

**Done means:**

- `.env` is not in git
- Production env is set on the host
- Build-time vs runtime vars are in the right slot (ask the agent which, then verify)
- Preview deployments do not get live payment keys unless you accept that risk in writing

## 8. Export, then look at it like a repository

Download or sync to GitHub. The files are the product.

```bash
npx @neuralaxis/vibedoctor scan --full
```

VibeDoctor runs on your machine against that tree. It will not log into Bolt. It will tell you if the export still has credentials, vulnerable lockfile entries, leftover “skip auth” comments, and whether the security scanners actually completed.

If you also want the human sequence, use the [vibe coding security checklist](../vibe-coding-security-checklist/) and the [pre-launch security test](../how-to-security-test-an-ai-generated-web-app/) (two users, bundle search, webhook signatures).

## A Bolt-specific prompt that does not make things worse

> Do not put secrets in files. Use the Secrets tab for server-only values. Do not prefix secrets with VITE_ or NEXT_PUBLIC_. Do not add npm packages without listing them in your reply and waiting. Do not open database rules to make the preview populate. After you change access rules, tell me how to test with two users.

Then read the diff. Bolt will optimize for the preview unless you make the preview the wrong reward.
