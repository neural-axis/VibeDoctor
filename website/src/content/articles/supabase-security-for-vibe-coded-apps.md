---
title: "Supabase Security for Vibe-Coded Apps: RLS, Auth and the Mistakes That Matter"
seoTitle: "Supabase Security for Vibe-Coded Apps: RLS and Auth"
description: "Supabase RLS security for AI-built apps: anon vs service_role, policies that lie, storage, Edge Functions, and the tests that catch them."
pubDate: 2026-08-14
draft: false
rank: 6
stage: tool
related:
  - vibe-coding-security-checklist
  - how-to-secure-a-lovable-app
  - how-to-secure-a-bolt-new-app
  - how-api-keys-get-exposed-in-ai-generated-apps
  - how-to-security-test-an-ai-generated-web-app
---

If you vibe-coded a SaaS in 2025 or 2026, there is a good chance Supabase is already in the repo. Lovable wires it in. Bolt will stand up a database. Cursor will `npm install @supabase/supabase-js` because that is what the training data likes.

That is fine. Supabase is a serious backend. The problem is the **default mental model** AI tools leave you with:

> I have a `supabase` object in the browser. I can `from("invoices").select("*")`. It works. We must be secure.

You are looking at a public API with a published key. **Supabase RLS security** is the only reason that sentence is not a data breach.

This note is the mistakes that actually show up in AI-built apps. Not a Postgres textbook.

## The two keys, said slowly

Supabase gives you (names vary slightly by project generation):

- A **publishable / anon** key. This belongs in the browser. It is not a secret. It identifies your project. Every request still has to pass RLS.
- A **secret / service_role** key. This bypasses RLS. It is root. It belongs in a server environment, an Edge Function secret, or a CI vault. It does not belong in Vite, Next public env, a committed `.env`, a screenshot, or a chat transcript.

If the service role key is in client code, stop reading and rotate it. Your policies are decorative.

The anon key in the client is **not** the bug people think it is. Blog posts that say “never put a Supabase key in the frontend” are mixing the two keys together. The bug is the service role, or RLS that does not exist.

## Mistake 1: RLS is off

A table with RLS disabled is reachable by anyone who has the project URL and the anon key — which is anyone who opened your site and looked at the network tab.

AI tools turn RLS off, or never turn it on, because the Table Editor and the first React query need rows to look clever.

**Check:** Supabase dashboard → Authentication is not enough. Open **Table Editor**. Every table that is not a deliberate public catalog needs the RLS badge. Then open **Authentication → Policies** (or the SQL editor) and confirm a policy exists for each command you use.

RLS enabled with **zero policies** blocks everyone using the anon key. That is safe and looks like a broken app, so the model “fixes” it by disabling RLS. The correct fix is a tight policy.

## Mistake 2: `USING (true)`

This is the policy that says “I thought about security.” It allows the command for every row.

You will see it on `SELECT` “so the homepage works,” and then the same shape copied onto `UPDATE` and `DELETE`.

Public read of a `posts` table can be intentional. Public write is not. Split the commands. Be boring:

```sql
create policy "anyone can read published posts"
on posts for select
using (published = true);

create policy "owner can write posts"
on posts for insert
with check ((select auth.uid()) = user_id);

create policy "owner can update posts"
on posts for update
using ((select auth.uid()) = user_id)
with check ((select auth.uid()) = user_id);
```

`(select auth.uid())` is the form Supabase recommends so the function runs once per query, not once per row.

## Mistake 3: trusting a `user_id` the client sent

```sql
-- the model writes this, or the equivalent in an Edge Function
using (user_id = current_setting('request.jwt.claim.sub', true)::uuid)
```

Worse, and more common in app code:

```ts
await supabase.from("invoices").select("*").eq("user_id", userIdFromReactState);
```

Filtering in the query is not authorization. A stranger changes `userIdFromReactState` or skips your helper and queries the table.

**The policy must use `auth.uid()`** (or a membership join), which comes from the JWT Supabase already verified. If you need the client to pass an `org_id`, the policy still has to prove the caller is in that org.

## Mistake 4: policies for the demo user only

Agents write policies that match the first happy path: a user can read their own `profiles` row. Then you add `messages`, `attachments`, `admin_notes`, and a `waitlist` table at 1 a.m. Those tables ship with RLS off or with a copied `true` policy.

**Ritual:** every new table is a security event. Same day, same PR, policies for `select/insert/update/delete` you actually need, and nothing else.

## Mistake 5: views, RPCs, and `security definer`

A `security definer` function runs as the owner, often bypassing RLS. Models love them because “the query got too hard.” They are a loaded gun.

If you need an RPC:

- Grant execute only to `authenticated` (or a specific role).
- Do the `auth.uid()` check *inside* the function.
- Do not take a `user_id` argument you then blindly trust.
- Prefer `security invoker` unless you can explain why not.

Views that skip RLS will leak. Check them.

## Mistake 6: storage is a second database

Storage policies are not table policies. A private `documents` table with a public bucket named `documents` is a leak with extra steps.

**Check:**

- Bucket public/private flag.
- Storage policies for `select` / `insert` on `storage.objects`.
- Paths include the uid, and the policy checks it.
- You cannot list the bucket from the browser console while signed out.

## Mistake 7: Realtime and “it just works”

Realtime respects RLS, until someone uses the service role on the channel, or you test with RLS off and forget. If a subscription returns another user’s row, your policy is wrong — do not “fix” it by broadening the policy so the toast animation works.

## Mistake 8: Edge Functions as a root client

Supabase Edge Functions get `SUPABASE_SERVICE_ROLE_KEY` injected. That is for jobs that *must* bypass RLS: a webhook creating a row before a user exists, a cleanup cron, an admin export.

Using that client for “fetch the current user’s invoices” means a bug in the function is a full-table read. Prefer a client scoped to the caller’s JWT unless you cannot.

Also: functions are public HTTPS. No JWT check means the internet can invoke them.

## Mistake 9: Auth settings left on “make the demo easy”

Before a custom domain:

- Confirm the **Site URL** and redirect allow-list match production, not `localhost` only, and not `*` .
- Email confirmation is on, or you have a written exception.
- Disable sign-ups if the app is invite-only. A public `/signup` on an internal tool is a feature.
- Providers you are not using are off.
- The first user is not still `admin@example.com` / `password`.

Auth UI in the app can be bypassed. These dashboard settings cannot.

## How to test RLS without kidding yourself

The SQL editor often runs as a privileged role. It will lie to you about what a user can see.

Do this instead:

1. Create users A and B (separate browsers or a private window).
2. Insert a row as A through the app.
3. As B, request that row by primary key from the browser console with the **anon** client and B’s session.
4. Repeat signed out.
5. Repeat for `update` and `delete`.
6. Repeat for storage objects.

If any of those succeed and should not, you do not have a frontend bug. You have an open database.

## Where VibeDoctor fits

VibeDoctor does not log into your Supabase project and it will not prove a policy is correct. Anyone who claims a repo scanner “does RLS” is selling a story.

What it *will* do on the exported app is find the companion failures: a service role key in source, a `.env` that git still has, known-vulnerable versions of the Supabase client or its neighbors, leftover comments that say `// disable RLS for now`, and a completeness grade so you know whether gitleaks and friends actually ran.

```bash
npx @neuralaxis/vibedoctor scan --full
```

Use this page for the dashboard work. Use the [vibe coding security checklist](../vibe-coding-security-checklist/) for the rest of the tree. If the app was born in Lovable, continue in [How to secure a Lovable app](../how-to-secure-a-lovable-app/). Then do the [pre-launch security test](../how-to-security-test-an-ai-generated-web-app/) — especially the two-user IDOR pass above.

The anon key can stay in the browser. The data cannot.
