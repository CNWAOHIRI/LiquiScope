# LiquiScope landing page

Plain HTML/CSS/JS, no build step, no framework — `index.html`, `methodology.html`, `style.css`, `app.js`. Calls the live Worker's public endpoints (`/check`, `/stats`, `/health`) directly from the browser.

## Hosting: Cloudflare Pages (deployed as a static-assets Worker)

Chosen over Vercel because it's the same account/ecosystem the Worker already lives in — no new third-party signup. Free tier, no build step needed since this is static files.

**Live:** https://liquiscope-landing.liquiscope.workers.dev

Deployment note learned the hard way: `wrangler pages deploy` on the current wrangler version "delegates to the latest version of Cloudflare Pages, now part of Cloudflare Workers" — it assigns a `*.workers.dev` subdomain, **not** the classic `*.pages.dev` domain this was originally planned around. It also resolves `wrangler.jsonc` by walking up the directory tree, so running the deploy command from inside `landing/` picked up the *repo-root* `wrangler.jsonc` (the real Worker's config — KV binding, cron triggers, `main: src/index.ts`) and deployed a full duplicate Worker instead of the static files. Fixed by deploying from an isolated directory containing only the 4 static files plus a minimal `wrangler.jsonc` naming the project explicitly:

```jsonc
{
  "name": "liquiscope-landing",
  "compatibility_date": "2026-07-24",
  "assets": { "directory": "." }
}
```

```bash
# from a directory containing ONLY index.html, methodology.html, style.css, app.js
# (and a .assetsignore with ".wrangler" + "wrangler.jsonc" in it — wrangler's own
# tmp/cache files land inside the deploy directory during the run and get swept
# into the asset upload otherwise; this leaked the Cloudflare account ID publicly
# on the first attempt, caught and fixed same-session)
npx wrangler deploy
```

The Worker's CORS allowlist (`src/index.ts`'s `CORS_ALLOWED_ORIGINS`) is set to the real deployed origin above. If a custom domain is added later, that origin needs adding too.

Local preview:

```bash
cd landing && npx serve .   # or: python3 -m http.server 8080
```

Local preview on `http://localhost:8080` or `http://127.0.0.1:5500` (Live Server default) is also pre-allowlisted for CORS, so you can test real `/check`/`/stats`/`/health` calls against the live Worker locally.

## Demo clip (item 3)

No placeholder on the live page right now — a "coming soon" box (and later, briefly, an empty `<video>` element with no source) both shipped and then got pulled per feedback; better to have no section than an obviously-unfinished one. To add the real clip once recorded:

1. Add the video file to `landing/` (e.g. `demo.mp4`, optionally a poster frame `demo-poster.jpg`).
2. Add a section back into `index.html`, right after the widgets `<section>` and before `<footer>`:
   ```html
   <section class="panel">
     <h3 style="margin-top:0; font-size:0.95rem;">See it in action</h3>
     <video style="width:100%; aspect-ratio:16/9; border-radius:var(--radius);" controls poster="demo-poster.jpg">
       <source src="demo.mp4" type="video/mp4" />
     </video>
   </section>
   ```
3. Redeploy (see the deploy instructions above).

## OKX listing badge (item 4) — draft text, for you to paste in

> **Read-only. We never touch your funds, keys, or approvals — LiquiScope only reads public chain data.**

Same line is already live in the Worker's `GET /` response (`dataAccess` field) and on both landing pages (`.badge-readonly`).

## /stats counter framing (item 2)

Chose **cumulative since launch**, not a live tick: at real (low, pre-launch) traffic volumes a live "3 calls today" counter reads as unimpressive rather than credible. A cumulative total with an explicit "since &lt;date&gt;" anchor is honest at any volume and doesn't need reframing later as it grows.

## Status indicator (item 6)

Chose a live client-side `GET /health` check (polled every 60s) over standing up a new UptimeRobot account or persisting the existing `*/10` self-check cron's result to KV. Reasoning: it's zero new infrastructure (no third-party signup, no Worker change beyond the CORS already added for this page), and arguably more meaningful than a cached "last cron result" — it's live proof, at page-load time, that the actual endpoint a judge or agent would call is responding right now.
