# Implementation summary

Built the public VibeDoctor marketing site as a static Astro 5 project under `website/`, deployed only through GitHub Pages.

## Design decisions

- **Stack:** Astro, HTML/CSS, one small clipboard script. No React, no CMS, no server. Content collections preserve a Markdown article path.
- **Visual system:** Warm paper (`#F5F3ED`), near-black ink, single diagnostic accent (`#D5422B`), self-hosted Instrument Sans Variable + IBM Plex Mono, visible column rules, crop marks, almost no radius or shadow. The page is structured as a numbered diagnostic folio (00–10).
- **Placement:** `website/` inside this repository so product source remains the source of truth for copy, and one `git push` updates the site.
- **Hosting:** `.github/workflows/pages.yml` builds and deploys `website/dist`. `PUBLIC_SITE_URL` / `PUBLIC_BASE_PATH` switch project-pages vs custom domain without moving files.
- **Brand assets:** Official marks live in `website/public/`: `logo-icon.png`, `logo-lockup.png`, `logo-portrait.png`, `og.png`. Favicons are cropped from the icon. Header uses the horizontal lockup; footer and company page use the portrait lockup.

## Verified claims used

Taken from `package.json`, README, CLI `--help`, `src/core/finding.ts`, `src/core/toolRegistry.ts`, `src/mcp/tools`, `src/agentPack`, and `tests/snapshots/`:

- Package `@neuralaxis/vibedoctor@0.2.1`, Node `>=18`, license GPL-3.0-or-later.
- Languages: JavaScript, TypeScript, Python, mixed repositories.
- Commands: `init`, `setup` / `--apply`, `scan --changed|--quick|--full`, `report`, `fix --safe`, `verify`, `explain`, `agent-plan`, `agent init|doctor|plugin`, `privacy-review`, `dpdp *`, `mcp`, `tool retry`, `baseline create`.
- Completeness states COMPLETE / PARTIAL / INVALID and exit codes 0 / 1 / 2.
- Evidence grades verified / observed / heuristic / unproven.
- Finding categories and the published tool registry (built-in + npm + python + manual).
- Agent targets Codex, Copilot, Claude, Cursor; plugin bundles for Codex and Claude.
- MCP tools listed in `src/mcp/tools`.
- Local-first scanning, with disclosure that setup, dependency scanners, and optional AI review may use the network.
- DPDP module is **technical readiness evidence, not legal compliance**.
- Specimen finding `gitleaks:src/config.ts:1` from `tests/snapshots/report.json` and `fixtures/broken-security`.

## Intentionally deferred

- **Privacy policy / terms:** No legal text exists in the repo. Pages were not fabricated.
- **Official logos:** Filed under `website/public/` (icon, lockup, portrait, OG).
- **Custom domain / CNAME:** Unknown. Wiring is documented; no hostname invented.
- **Published articles:** Ten-note pre-launch library under `src/content/articles/`, funnelled as problem → tool → check. `_template.md` remains a draft.
- **Benki description:** Only the official URL is used; product copy was not invented.
- **MDX:** Markdown collections are live; `@astrojs/mdx` is not installed yet.
- **Astro major upgrade:** osv-scanner flagged `astro@5.18.2` (fixed in 6.3.3 / 6.4.6). Latest is 7.x. Left on 5.x to avoid a major-version redesign of a static Pages site. Revisit when upgrading the stack.

## Quality bar (this pass)

- `astro check` + `astro build`: 0 errors, 18 pages (8 product + 10 articles).
- Internal routes return 200; unknown paths return 404. GitHub, Issues, neuralaxis.ai, and benki.tech return 200. npmjs returned 403 to a scripted client and 200 with a browser User-Agent.
- Lighthouse (mobile, local preview, after fixes): Performance 99, Accessibility 100, Best Practices 100, SEO 100. First run was Accessibility 94 (accent `#D5422B` on `#FFFDF8` at 4.44:1; specimen used `h3` after `h1`). Small accent text now uses `#9E2E1C`; the specimen title is not a heading.
- VibeDoctor `npm run health` on the repo: Health 62/100, COMPLETE. No findings under `website/`. osv-scanner reported Astro 5.18.2 advisories fixed in 6.x — left on 5.x (see deferred).
- GitHub Pages workflow is present. Publishing still needs a push to `main` and **Settings → Pages → GitHub Actions**.

## Assumptions

- GitHub Pages will be enabled with **Source: GitHub Actions** on `neural-axis/VibeDoctor`.
- NeuralAxis is the maker (`author: neuralaxis`, package scope `@neuralaxis`, `neuralaxis.ai`).
- Year in the footer is the UTC year at build/render time.
