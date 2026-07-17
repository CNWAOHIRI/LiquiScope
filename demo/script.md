# LiquiScope — 90-second video script (X post, #OKXAI)

Three screens: **browser** (web UI + OKX.AI), **terminal** (the agent-to-agent x402 moment), **phone** (Telegram alert). Record 16:9 screen capture; phone shot can be a screenshot inset. Narration is written for natural reading pace — total ≈ 85s.

**Demo wallet (verified critical at recording prep):** `0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4` — Aave V3 on Arbitrum, HF 1.034, ~3.3% from liquidation of ~$180K collateral. Re-verify the morning of recording: `npm run test:live` or one free /check call.

---

## Shot 1 — The hook (0:00–0:12) · browser, web UI

Open https://web-beta-six-50.vercel.app, click the **Critical example** chip. The report loads: red CRITICAL badge, health factor 1.03, "-3.3% to liquidation".

> "This is a real wallet, right now. A hundred and eighty thousand dollars of collateral — and if ETH drops three percent, it gets liquidated. The owner probably has no idea."

## Shot 2 — What LiquiScope is (0:12–0:25) · browser, OKX.AI

Cut to the OKX.AI marketplace — LiquiScope's listing page (okx.ai/agents/5074), or the "My agents" view showing **#5074 · LiquiScope · ASP**.

> "LiquiScope sells that warning — as an on-chain agent service. Registered on OKX dot AI, agent five-oh-seven-four. Other AI agents can find it, call it, and pay it. No signup, no API keys."

## Shot 3 — The x402 payment, the star of the video (0:25–0:55) · terminal

Two pre-typed commands. First:

```bash
curl -si -X POST https://liquiscope.liquiscope.workers.dev/report -d '{}' | head -3
```

shows `HTTP/2 402` + the PAYMENT-REQUIRED header on screen.

> "Here's the agent economy in one shot. The full report costs fifteen cents. My agent gets a 402 — payment required…"

Then the paid call (pre-run `onchainos payment pay` off-camera; paste the replay):

```bash
curl -s -X POST https://liquiscope.liquiscope.workers.dev/report \
  -H "PAYMENT-SIGNATURE: $AUTH" \
  -d '{"address":"0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4"}' | jq .summary,.overallRiskTier
```

Report JSON scrolls; end on the summary text + `"critical"`.

> "…signs fifteen cents of stablecoin on X Layer, and gets the full multi-chain report back. Liquidation price, distance to liquidation, and what to do about it. Settled on-chain, automatically."

## Shot 4 — The monitor beat (0:55–1:15) · phone / Telegram screenshot

Show the real Telegram alerts from @keeperhbot: the 🚨 critical alert and the "now monitoring" message.

> "And it doesn't stop at reports. LiquiScope watches positions around the clock — when a wallet slides toward liquidation, the alert hits Telegram before the liquidation bots hit the wallet."

## Shot 5 — Close (1:15–1:28) · browser, listing or web UI

Back to the listing page (or the web UI with the CRITICAL report).

> "LiquiScope. Live on mainnet, listed on OKX dot AI, earning on-chain — built end-to-end by an AI agent in under a week. The agent economy isn't coming. It's here. Hashtag OKX AI."

---

## Pre-recording checklist

- [ ] Re-verify demo wallet is still critical (`npm run test:live` finds a fresh one if not).
- [ ] Balance check: wallet has $0.16 → exactly **one** on-camera paid call. Top up ~$0.30 more if you want a rehearsal take. (Fund USDT → X Layer → `0x5c0A7B5cae9F6ecdF005d80C323d70a4C2c7B556`.)
- [ ] Pre-sign the payment right before recording (signatures expire in ~5 min):
      fetch 402 → `onchainos payment pay --payload '<PAYMENT-REQUIRED value>'` → export AUTH.
- [ ] Marketplace shots (1 alternative + 5): if okx.ai/agents/5074 still 404s (re-review), use the logged-in "My agents" view instead — same identity on screen.
- [ ] Terminal: dark theme, font ≥18pt, `jq` installed, commands in history.
- [ ] Telegram: have the @keeperhbot chat open on the phone, alerts visible.
- [ ] Post with **#OKXAI**, mention agent **#5074**, link okx.ai/agents/5074.
