# LiquiScope — demo script v2 (autonomous agent + landing page)

Format: browser (landing page) + terminal (the demo agent's own live narration — this is the
centerpiece now, not typed curl commands). **Hard target: 90 seconds**, same budget as v1 — the
shot timings below already sum to exactly 90s; if the live agent run is running long when you
record it, cut away to Shot 3 mid-narration rather than waiting for the log to finish.

Supersedes v1 (below the checklist) — that version predates Watch Mode, GET /proof, the landing
page, and the demo agent itself; kept for reference, not for reuse.

## Shot list

**Shot 1 — hook (0:00–0:10), landing page**
Open https://liquiscope-landing.liquiscope.workers.dev. Let the read-only badge and the two live
widgets (agents-calling counter, service status) sit on screen for a beat — they're real, polling
data, not mockups.

> "This is LiquiScope — a DeFi liquidation-risk service, live on OKX dot AI. But the interesting part isn't the website. It's that other agents pay to use it autonomously. Watch."

**Shot 2 — the agent decides, live (0:10–0:55), terminal**
Run, live, no pre-recording:

```bash
cd ~/liquiscope-demo-agent && npm run run -- 0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4 arbitrum
```

Let the full narration play out on screen — the free check, the risk-tier decision, the real
$0.15 payment for the report, the real $0.06 payment to register monitoring. Don't talk over it;
the agent is narrating itself.

> "No script, no mocked payments — this is a real agent I built, with its own funded wallet. It checks a wallet for free first. If it's healthy, it stops — no reason to pay for more. This one's critical, so it decides to pay for the full report. Then, because the position is this close to liquidation, it decides on its own to register ongoing monitoring — a second real payment."

**Shot 3 — the proof (0:55–1:15), terminal or explorer**
Paste one of the two transaction hashes the run just printed into an X Layer block explorer, or
just highlight it in the terminal output with the cursor.

> "Both payments settle on-chain for real — X Layer, stablecoin, gasless for the agent. That's a real transaction hash, not a mock. Fifteen cents and six cents, decided and spent by the agent itself, in under a minute."

**Shot 4 — close (1:15–1:30), landing page**
Back to the landing page; scroll to the methodology section briefly, then hold on the header.

> "LiquiScope. Live on OKX dot AI, paid entirely on-chain, and now something other agents can use without a human in the loop. Hashtag OKX AI."

## Prep checklist (before recording)

- [ ] **Time a dry run first, off-camera**: `cd ~/liquiscope-demo-agent && time npm run run -- 0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4 arbitrum`. This costs a real $0.21 (same as the on-camera take), but tells you exactly how long Shot 2 actually runs — the 45s budget is an estimate, not measured. If it's longer, either trim your voiceover further or plan the cut to Shot 3 at a specific line rather than guessing live.
- [ ] **Re-verify the wallet is still critical.** Positions move — the dry run above doubles as this check. If it's no longer watch-or-worse, find a fresh at-risk wallet via the main repo's `npm run test:live` and swap the address before the real take.
- [ ] **Check the demo wallet's balance**: `npm run balance` in `~/liquiscope-demo-agent` — the dry run above plus the real take is $0.42 total. Balance was $0.46362 as of the last check, which covers both with almost nothing left over — top up before recording if you want margin for a second real take.
- [ ] Terminal: font ≥ 18pt, dark theme, output not truncated by window width (the narration lines wrap).
- [ ] Landing page loads clean in the recording browser — no dev tools open, no console errors visible.
- [ ] Optional, if you want a real webhook fire on camera instead of just the registration: this hasn't been demonstrated yet (the demo agent's registered subscriptions use a placeholder `notify_webhook` that can never succeed). Would need a real receiver (e.g. a fresh https://webhook.site URL) passed in place of `DEMO_WEBHOOK` in `~/liquiscope-demo-agent/src/run.ts`, then either wait ~15 min for the next cron tick after registering, or accept the registration-only beat as sufficient (the agent's narration already explains what happens next).

---

## v1 (superseded — reference only)

Format: screen recording of a terminal (large font, dark theme) + the OKX.AI marketplace page.
Target ≤ 90s. Narration lines are written to be read aloud at a natural pace.

**Shot 1 — hook (0:00–0:12), marketplace page**
Show LiquiScope's listing on OKX.AI (agent #5074, avatar visible).

> "Every day, DeFi wallets get liquidated because nobody warned them. LiquiScope is an agent service on OKX dot AI that sells exactly that warning — to other agents, for fifteen cents."

**Shot 2 — free check (0:12–0:35), terminal**
Run (pre-typed, just hit enter):

```bash
curl -s -X POST https://liquiscope.liquiscope.workers.dev/check \
  -H 'content-type: application/json' \
  -d '{"address":"<AT_RISK_WALLET>","chain":"arbitrum"}' | jq
```

Highlight `"riskTier": "critical"` and the health factor with the cursor.

> "The free check: one wallet, one chain. This is a real mainnet position — health factor one point zero four. Critical. One bad hour of ETH and it's gone."

**Shot 3 — the paid x402 flow (0:35–1:05), terminal**
First show the 402 challenge:

```bash
curl -si -X POST https://liquiscope.liquiscope.workers.dev/report -d '{}' | head -4
```

> "The full report is paid — standard x402. No accounts, no API keys: the agent gets a 402, pays fifteen cents in stablecoin on X Layer, and retries."

Then the paid call (pre-recorded with the funded wallet via `onchainos payment pay`), showing the full report JSON scrolling, ending on `summary` + `recommendation`.

> "Multi-chain scan — Aave and Compound across Ethereum, Base and Arbitrum. Liquidation price per position, how far away it is, and a plain-language recommendation. This wallet: WETH falls three point six percent, liquidation starts at seventeen forty-nine."

**Shot 4 — the beat (1:05–1:20), split or cut**
Show the same wallet on a liquidations dashboard / explorer (or the `liquidatable` tier on a historical address).

> "Positions like this get liquidated with millions in penalties — this report would have been the warning. Fifteen cents against a five-figure haircut."

**Shot 5 — close (1:20–1:30), marketplace page**

> "LiquiScope. Live now on OKX dot AI — built entirely with agents, listed and paid entirely on-chain. Hashtag OKX AI."

## Prep checklist (before recording, v1)

- [ ] `<AT_RISK_WALLET>`: re-run `npm run test:live` the same day to find a fresh HF≈1.0–1.1 wallet (positions move; don't reuse a stale one).
- [ ] Fund Agentic Wallet with ~$1 USD₮0 on X Layer for the on-camera paid call.
- [ ] Listing live on the marketplace (post-review) so Shot 1/5 show the real page.
- [ ] Terminal: font ≥ 18pt, `jq` installed, commands in shell history.
