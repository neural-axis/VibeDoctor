---
title: "Is Vibe Coding Safe? The Security Risks Nobody Notices Until Production"
seoTitle: "Is Vibe Coding Safe? The Security Risks to Check"
description: "Is vibe coding safe? The security risks in AI-built apps are not sci-fi. They are missing auth, open RLS, and secrets that only show up in production."
pubDate: 2026-08-14
draft: false
rank: 2
stage: problem
related:
  - vibe-coding-security-checklist
  - 10-security-mistakes-ai-coding-agents-make
  - how-to-secure-a-lovable-app
  - how-to-secure-a-bolt-new-app
  - cursor-security-risks
---

**Is vibe coding safe?** The honest answer is: safe enough to learn, safe enough to demo, and not safe enough to point a real domain at until a human has been unkind to the result.

That sentence disappoints two camps. One wants a moral panic about models writing malware. The other wants a blessing to deploy the preview URL.

Neither is looking at the actual failure mode.

## What people mean by “safe”

They usually mean one of three things:

1. **Will the AI sneak a backdoor into my app?** Rare. Not the thing that pages you at 2 a.m.
2. **Will my prompt or repo be trained on?** A vendor-policy question. Important. Not what this library is for.
3. **If I ship this, can a stranger read my users?** This is the question. The answer, on an unreviewed vibe-coded app, is too often yes.

Vibe coding is a way of producing software: you describe the next increment, a model writes most of the diff, you accept what looks right. Lovable, Bolt.new, Cursor, Claude Code, Replit Agent, v0 — different wrappers, same bargain.

The bargain is speed on the **happy path**. Security lives on the **sad path**: the user who is not logged in, the user who is logged in as someone else, the request that never went through your React tree.

## The demo-to-production gap

In the builder, this is a successful session:

- Sign up works
- A row appears in a table
- Stripe returns a test session
- The preview is pretty

In production, success is:

- User B cannot read user A
- The service role key is not in the JavaScript bundle
- The webhook rejects unsigned bodies
- The admin route is not “secret” because it is `/admin`
- Yesterday’s debug function is gone

Models are rewarded, in the room, for the first list. They will disable [RLS](../supabase-security-for-vibe-coded-apps/), put `VITE_` in front of a secret, and comment `// TODO: add auth` because those moves make the demo continue. Nobody notices until the hostname is real and the user table is interesting.

That is vibe coding security in practice. Not Skynet. A missing `auth.uid()`.

## The risks that hide until production

### The database is on the internet

Supabase, Firebase, and “backend-as-a-client-SDK” setups expose an API to the browser on purpose. Policies are the product. AI tools treat policies as an obstacle to the first `select(*)`.

You will not see this in the preview if you only log in as yourself.

### The secret is in the bundle, not the chat

The app “uses env vars.” The var is named `VITE_OPENAI_KEY`. The build inlines it. View-source on production is the leak. [How API keys get exposed](../how-api-keys-get-exposed-in-ai-generated-apps/) is the long form.

### Auth is a redirect

The model hides the settings page when `user` is null. The settings API still answers. This passes every click-test you will do in a hurry.

### Dependencies you did not choose

The agent installed a package to silence an error. You shipped its lockfile. Supply-chain and CVE risk arrived without a scene in the chat.

### Leftovers

Seed users. `DEBUG`. A second implementation. “Temporary” public buckets. These survive because deleting them does not change the screenshot.

## When vibe coding is fine

- Throwaway prototypes
- Internal tools with no personal data and a closed door
- Learning a stack
- A spike you will rewrite with your eyes open

“Internal” still needs a closed door. A preview URL in Slack is not a VPN.

## When it is not fine

- Accounts, money, health, school, HR, or anyone else’s files
- A custom domain
- Sign-ups from the open internet
- A database that already has more than your email in it

At that point you do not need another feature prompt. You need a [checklist](../vibe-coding-security-checklist/) and a [test you can fail](../how-to-security-test-an-ai-generated-web-app/).

## Does the tool change the answer?

The class of bug is shared. The knobs are not.

| Tool | What is special |
| --- | --- |
| [Lovable](../how-to-secure-a-lovable-app/) | Frontend + Edge Functions + Supabase. Security view helps. RLS still needs a two-user test. |
| [Bolt.new](../how-to-secure-a-bolt-new-app/) | WebContainer, npm anything, Secrets tab, publish vs share. The download is the real artifact. |
| [Cursor / agents](../cursor-security-risks/) | You already have a repo. The risk is accepted diffs, `.env` in context, MCP, leftovers. |
| Replit / v0 / others | Same happy-path bias. Check *their* secret store and *their* public URL settings. Do not copy a Lovable runbook blindly. |

The common list of unforced errors is [10 security mistakes AI coding agents commonly make](../10-security-mistakes-ai-coding-agents-make/).

## What “safe enough to ship” looks like

Not a feeling. A short pile of evidence:

1. Two users, and B cannot touch A.
2. No live secret in the tree or the JS bundle.
3. Payments and webhooks do not trust the client.
4. Publish settings match the intended audience.
5. A local scan of the exported repo, with scanners that actually finished.

That last item is what [VibeDoctor](../../) is for: a local health check on JavaScript, TypeScript, Python, and mixed repositories. Secrets, lockfile vulns, leftovers, incomplete coverage. It will not certify your RLS. It will stop you shipping a `service_role` key because the preview looked done.

```bash
npx @neuralaxis/vibedoctor scan --full
```

## So… is it safe?

Vibe coding is safe the way a power tool is safe. The tool is not haunted. The work is still work. The people who get hurt are the ones who confuse a working preview with a reviewed system.

If you already built the thing, skip the philosophy. Open the [15-point checklist](../vibe-coding-security-checklist/) and start at secrets.
