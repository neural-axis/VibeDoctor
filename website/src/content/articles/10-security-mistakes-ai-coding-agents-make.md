---
title: "10 Security Mistakes AI Coding Agents Commonly Make"
seoTitle: "10 Security Mistakes AI Coding Agents Make"
description: "Ten AI coding security risks you’ll see in Cursor, Claude Code, Lovable, Bolt, Replit, and v0 — and how to catch them before production."
pubDate: 2026-08-14
draft: false
rank: 8
stage: problem
related:
  - is-vibe-coding-safe
  - vibe-coding-security-checklist
  - cursor-security-risks
  - how-to-secure-a-lovable-app
  - how-to-secure-a-bolt-new-app
  - how-api-keys-get-exposed-in-ai-generated-apps
---

Ask an agent to “make it work” and it will. **AI generated code security** is mostly the study of *how* it made it work.

These ten mistakes show up across Cursor, Claude Code, Lovable, Bolt.new, Replit Agent, v0, and Copilot. The wrappers differ. The incentives do not: keep the preview green, keep the user talking, leave the sad path for later.

If you want the philosophy, read [Is vibe coding safe?](../is-vibe-coding-safe/). This is the list.

## 1. Hardcoding the key that unblocked the demo

The call 401’d. The agent pasted the key into `src/lib/ai.ts`. You shipped.

**Catch it:** search prefixes, search `VITE_` / `NEXT_PUBLIC_`, search git history, search the production bundle. Rotate anything that hits.

**Tool notes:** Lovable and Bolt have secret stores the agent will ignore if you pasted the key in chat. Cursor will read `.env` if it is in the workspace.

Long form: [how API keys get exposed](../how-api-keys-get-exposed-in-ai-generated-apps/).

## 2. Turning the database into a public API

Supabase RLS off. Firebase rules `allow read, write: if true`. A Prisma app bound to a server that never checks `session.user.id`.

The UI filters “my rows.” The table does not.

**Catch it:** two users, request by id. Dashboard badges are not the test.

[Supabase-specific](../supabase-security-for-vibe-coded-apps/). [Lovable-specific](../how-to-secure-a-lovable-app/).

## 3. Authentication as a React `if`

`if (!user) return <Login />`. The fetch behind the page does not ask.

v0 and Cursor are especially good at beautiful empty states that hide missing 401s.

**Catch it:** call the API signed out. You want failure from the server.

## 4. Trusting the client’s `user_id`, `role`, and `price`

The handler writes `req.body.userId`. The checkout uses `req.body.amount`. The profile update accepts `role: "admin"`.

Agents do this because the TypeScript type said the field exists.

**Catch it:** mutate the JSON in the network panel. If the server obeys, that is the product.

## 5. Public buckets and guessable paths

Uploads “work” when the bucket is public and the path is `/avatars/1.png`. Congratulations, that is the vulnerability.

**Catch it:** signed-out GET of an object URL. Try the next integer.

## 6. Installing whatever clears the error

Bolt’s WebContainer and Cursor’s terminal make this cheap. A package with a similar name, a abandoned last-publish date, a postinstall script.

v0 and Lovable hide the install a bit more; the `package.json` still changes.

**Catch it:** read the diff of the manifest. Then scan the lockfile for known vulns. Do not ship an agent’s typo.

## 7. Leaving the scaffolding in the building

`// TODO add auth`, `SKIP_AUTH=true`, seed admin users, a `/debug/session` route, a second copy of the router. Replit and Cursor leave more of this because the files persist and the agent is polite about “not deleting your work.”

**Catch it:** search the diff for `TODO`, `FIXME`, `bypass`, `temporary`, `debug`. Delete or ticket. Do not launch with the comment as documentation of a hole.

## 8. Webhooks that trust the body

Stripe (or GitHub, or Resend) is “integrated.” The route parses JSON and provisions a plan. No signature. No idempotency.

Lovable Edge Functions and Bolt server functions both grow this shape when the prompt is “add payments.”

**Catch it:** POST garbage. It should fail. POST the same valid event twice. You should not double-provision.

## 9. Admin by URL, preview by hope

`/admin`, `?admin=1`, “only people with the preview link.” Hosted builders emit public URLs. Replit and Bolt share links leak. v0 previews get forwarded.

**Catch it:** publish settings, workspace visibility, an admin **role** checked on the server. A secret path is not a role.

## 10. Declaring victory when a scanner did not run

The worst meta-mistake. Someone ran a tool, it skipped gitleaks, the score looked fine, they shipped. Or the agent “fixed” findings by deleting the tests.

**Catch it:** read coverage. `not installed` and `timed out` are not passes. Re-run the two-user test after the agent’s fix.

```bash
npx @neuralaxis/vibedoctor scan --full
```

VibeDoctor’s completeness grade exists because this mistake is common enough to deserve a status, not a footnote.

## Where each tool usually fails first

| Tool | Typical first mistake |
| --- | --- |
| [Lovable](../how-to-secure-a-lovable-app/) | RLS / service role / Edge Function without JWT |
| [Bolt.new](../how-to-secure-a-bolt-new-app/) | `VITE_` secrets, open npm, share vs publish |
| [Cursor / Claude Code](../cursor-security-risks/) | Accepted auth diffs, `.env` in context, leftovers |
| Replit Agent | Public repl, secrets in the wrong pane, leftover debug |
| v0 | Client-only checks, pretty UI over an open route |

Same ten mistakes. Different first page of the manual.

## What to do with the list

Do not start a new agent chat titled “make it secure.” Work the [15-point checklist](../vibe-coding-security-checklist/) against the exported repo, then the [pre-launch test](../how-to-security-test-an-ai-generated-web-app/). Hand the agent a plan with evidence, not a vibe.

AI coding security risks are not mysterious. They are the shortest path between a prompt and a green preview. Close the short paths before you buy the domain.
