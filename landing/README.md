# LiquiScope landing page

Plain HTML/CSS/JS, no build step, no framework — `index.html`, `methodology.html`, `style.css`, `app.js`. Calls the live Worker's public endpoints (`/check`, `/stats`, `/health`) directly from the browser.

## Hosting: Cloudflare Pages

Chosen over Vercel because it's the same account/ecosystem the Worker already lives in — no new third-party signup (the standing instruction was to ask before adding any new third-party service; Pages isn't one, it's the existing Cloudflare account). Free tier, no build step needed since this is static files.

```bash
# one-time, from the landing/ directory
npx wrangler pages deploy . --project-name=liquiscope-landing
```

This assigns `https://liquiscope-landing.pages.dev` — **not yet deployed**. The Worker's CORS allowlist (`src/index.ts`'s `CORS_ALLOWED_ORIGINS`) already includes this exact origin, chosen in advance so the first deploy works without a follow-up CORS change. If a custom domain is added later, that origin needs adding too.

**Not deployed yet** — per the standing instruction to see it before it goes live. Local preview:

```bash
cd landing && npx serve .   # or: python3 -m http.server 8080
```

Note: local preview on `http://localhost:8080` or `http://127.0.0.1:5500` (Live Server default) is also pre-allowlisted for CORS, so you can test the real `/check`/`/stats`/`/health` calls against the live Worker before any deploy.

## Demo clip slot (item 3)

`index.html` has a placeholder `<div class="demo-slot" id="demo-slot">` (see `style.css`'s `.demo-slot`, a 16:9 dashed box). To drop in the real clip once recorded:

1. Add the video file to `landing/` (e.g. `demo.mp4`).
2. Replace the placeholder div in `index.html` with:
   ```html
   <video class="demo-slot" controls poster="demo-poster.jpg">
     <source src="demo.mp4" type="video/mp4" />
   </video>
   ```
   (Drop `.demo-slot`'s dashed-border/placeholder styling in `style.css` once real content replaces it — cosmetic only.)

## OKX listing badge (item 4) — draft text, for you to paste in

> **Read-only. We never touch your funds, keys, or approvals — LiquiScope only reads public chain data.**

Same line is already live in the Worker's `GET /` response (`dataAccess` field) and on both landing pages (`.badge-readonly`).

## /stats counter framing (item 2)

Chose **cumulative since launch**, not a live tick: at real (low, pre-launch) traffic volumes a live "3 calls today" counter reads as unimpressive rather than credible. A cumulative total with an explicit "since &lt;date&gt;" anchor is honest at any volume and doesn't need reframing later as it grows.

## Status indicator (item 6)

Chose a live client-side `GET /health` check (polled every 60s) over standing up a new UptimeRobot account or persisting the existing `*/10` self-check cron's result to KV. Reasoning: it's zero new infrastructure (no third-party signup, no Worker change beyond the CORS already added for this page), and arguably more meaningful than a cached "last cron result" — it's live proof, at page-load time, that the actual endpoint a judge or agent would call is responding right now.
