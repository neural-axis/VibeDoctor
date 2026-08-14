# VibeDoctor website

Public marketing site for **VibeDoctor**, a NeuralAxis product. Static Astro build, light editorial report aesthetic, GitHub Pages only.

Live path (project pages): `https://neural-axis.github.io/VibeDoctor/`

Custom domain can be added later without restructuring the site.

## Local development

Requires Node.js 18+.

```bash
cd website
npm install
npm run dev
```

Astro prints a local URL. Pages:

| Path | Page |
| --- | --- |
| `/` | Homepage |
| `/how-it-works/` | Scan / evidence / scanner matrix |
| `/agents/` | Agent pack, protocol, MCP |
| `/privacy/` | Local-first + DPDP technical readiness |
| `/articles/` | Pre-launch article library (10 notes) |
| `/products/` | Shipped products only (footer, not primary nav) |
| `/company/` | Bridge to neuralaxis.ai (footer) |

```bash
npm run check    # astro check
npm run build    # output in website/dist
npm run preview  # serve the production build
```

## Adding an article

Create `src/content/articles/your-slug.md`:

```md
---
title: "A passing build is not a diagnosis"
description: "Why completeness belongs in the report."
pubDate: 2026-08-14
draft: false
rank: 11
stage: check
related:
  - vibe-coding-security-checklist
---

Body in Markdown. Link other notes with relative paths: `../slug/`.
```

`rank` orders the index. `stage` is `problem`, `tool`, or `check`. `related` is a list of other article ids.

Drafts (`draft: true`) stay off the index. MDX can be added later with `@astrojs/mdx` without changing the URL scheme.

## Deployment (GitHub Pages)

The workflow `.github/workflows/pages.yml` builds `website/` on pushes to `main` that touch the site, then deploys the `website/dist` artifact with official GitHub Pages actions.

One-time repository settings (required; a 404 from `deploy-pages` means this is still off):

1. Open [Settings → Pages](https://github.com/neural-axis/VibeDoctor/settings/pages).
2. **Build and deployment → Source** → **GitHub Actions** (not “Deploy from a branch”).
3. If the org has locked Pages, an owner must allow it under the org’s Pages / Actions policies.
4. Re-run **Actions → Deploy website**. After a green deploy job, the site is at `https://neural-axis.github.io/VibeDoctor/`.

Operational loop: edit → commit → push → Pages publishes. No Vercel, Netlify, or extra host.

### Custom domain later

1. Add `website/public/CNAME` containing the hostname, e.g. `vibedoctor.example`.
2. In the repo, set Actions variables (Settings → Secrets and variables → Actions → Variables):
   - `PUBLIC_SITE_URL` = `https://vibedoctor.example`
   - `PUBLIC_BASE_PATH` = `/`
3. Point DNS at GitHub Pages and add the custom domain under Settings → Pages.
4. Rebuild. Internal links already go through `import.meta.env.BASE_URL`, so the tree does not need to move.

If those variables are unset, the build uses project-page defaults:

- `PUBLIC_SITE_URL=https://neural-axis.github.io`
- `PUBLIC_BASE_PATH=/VibeDoctor/`

## Design notes

The site is supposed to read like a printed engineering report, not a SaaS landing template. Copy is limited to capabilities verified in this repository (`@neuralaxis/vibedoctor@0.2.1`). Official marks are in `public/` (`logo-lockup.png`, `logo-portrait.png`, `logo-icon.png`, `og.png`). See `IMPLEMENTATION.md`.
