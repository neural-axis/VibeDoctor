---
title: "How API Keys and Secrets Get Exposed in AI-Generated Apps"
description: "How an exposed API key happens in AI-generated code: .env in git, VITE_ prefixes, frontend bundles, chat logs, and what to rotate first."
pubDate: 2026-08-14
draft: false
rank: 7
stage: problem
related:
  - vibe-coding-security-checklist
  - 10-security-mistakes-ai-coding-agents-make
  - supabase-security-for-vibe-coded-apps
  - how-to-security-test-an-ai-generated-web-app
---

An **exposed API key** in an AI-generated app is rarely a Hollywood breach. It is a string the model needed in order to continue, placed somewhere a build tool, a browser, or git would later copy for free.

This is **API key security** as it actually happens in vibe-coded work: `.env` files, `VITE_` prefixes, frontend bundles, git history, logs, and the chat transcript that still has last Tuesday’s token in it.

If you only do one thing after this page: search the built JavaScript on the production hostname, then rotate anything you find.

## The rule the model does not feel

A secret is a value that lets someone act as you. If it can reach a user’s browser, a public git repo, a screenshot, or a support log, it is not a secret. It is a delay.

Placeholders (`sk-your-key-here`, `${OPENAI_API_KEY}`, `process.env.OPENAI_API_KEY`) are fine. Live values are not.

Some values are **designed** to be public: a Supabase **anon / publishable** key, a Stripe **publishable** key, most analytics write keys. The Supabase **service role** key and the Stripe **secret** key are not in that club. Mixing them up is the whole [Supabase](../supabase-security-for-vibe-coded-apps/) article.

## Leak 1: the file that “isn’t committed”

The agent writes `.env`. Sometimes it adds `.gitignore`. Sometimes it writes `.env` first, you run `git add .` because the preview died, and now the file is in history forever.

**Check:**

```bash
git ls-files | findstr /i ".env"
git log --all --full-history -- .env .env.local .env.production
```

On macOS/Linux, use `rg` or `git log --all -- .env`.

**Done:** the file is untracked, history is cleaned *or* the key is rotated (cleaning history without rotating is theatre), and `.env.example` contains fake values only.

## Leak 2: the public prefix

Vite inlines `import.meta.env.VITE_*`. Next inlines `process.env.NEXT_PUBLIC_*`. Astro inlines `PUBLIC_*`.

The agent names the Stripe secret `VITE_STRIPE_SECRET_KEY` because it wants the frontend to charge a card. The build system does its job. The key is now in a hashed JS file on your CDN.

**Check:** every frontend reference. If the value would mint charges, send mail, or bypass RLS, the prefix is wrong. Move the call to a server function and put the value in a real secret store (Lovable Secrets, Bolt Secrets, Vercel/Netlify env, GitHub Actions secrets).

## Leak 3: hardcoded in source “for now”

```ts
export const API_TOKEN = "ghp_example_secret_value_1234567890";
```

That shape is how these apps die. The model saw it in training data and in your previous message when you pasted a key “just this once.”

Search the tree for provider prefixes (`sk-`, `sk_live_`, `ghp_`, `AKIA`, `AIza`, `xoxb-`, `dop_v1_`) and for `eyJ` blobs that look like JWTs.

VibeDoctor’s gitleaks adapter plus a credential heuristic exist for this case: high-entropy, structured tokens stay loud; a variable named `format_key` should not page you at the same volume.

## Leak 4: the frontend bundle

Even if git is clean, a CI build that had the secret in the environment **and** a `VITE_` reference will bake it into `dist/`. Those files are copied to hosting. Old deploys may linger.

**Check:** open the live site, view source, open the largest JS asset, search for the prefix of your vendors.

If you find it: rotate first, redeploy second, then invalidate the old deploy if the host lets you.

## Leak 5: git history after you “fixed it”

You deleted the line. GitHub still has the parent commit. Forks have it. Actions logs have it. The key is live until the provider says it is not.

**Done means the provider dashboard shows a new secret and the old one is revoked.** Force-pushing is optional hygiene for a private repo and insufficient for a public one.

## Leak 6: logs, error trackers, and screenshots

`console.log(process.env)`, a debug middleware that dumps headers, a Sentry event with the request body, a Slack screenshot of the `.env` so a contractor can “get set up.”

Agents add verbose logging to make the demo debuggable. They do not remove it.

**Check:** production log queries for `Bearer`, `sk-`, `Authorization`. Then delete the log line in source.

## Leak 7: the chat is a copy of the secret

Pasting a production key into Lovable, Bolt, Cursor, ChatGPT, or Claude is handing a second store a live credential. Cursor can also *read* `.env` out of the workspace and echo it.

Assume vendor retention is not zero. Rotate if the key was real.

This is a [Cursor-shaped](../cursor-security-risks/) problem as much as a hosted-builder one.

## Leak 8: mobile, desktop, and “it’s compiled”

Expo and Electron apps are not a vault. A secret in the client binary will be extracted. Same rule: public keys in the client, secret work on a server you control.

## What to do in the first hour

1. **Identify** every third-party account the app talks to.
2. **Search** source, git history, and the production JS.
3. **Rotate** anything that appeared, and anything that *might* have appeared in chat.
4. **Move** remaining live values to a server-side secret store.
5. **Scan** the tree so you are not hunting by hand next time.

```bash
npx @neuralaxis/vibedoctor scan --full
```

Gitleaks (when installed) is the secret-shaped scanner in that run. If it is `not installed`, the report should say so. A score without that row is not a secrets review.

Then continue with the [vibe coding security checklist](../vibe-coding-security-checklist/) — keys are item one, not the whole job. Auth and RLS will leak the data even when the keys are perfect.

## What not to do

- Do not commit a new key to “replace” the old one in the same file.
- Do not prefix a secret so the frontend can “just call OpenAI.”
- Do not rely on `.env` being listed in `.gitignore` as proof it was never added.
- Do not skip rotation because the repo is private. Private repos have more valid secrets, not fewer.

An exposed API key is a boring incident. Keep it boring: find, rotate, stop putting live strings where a compiler can see them.
