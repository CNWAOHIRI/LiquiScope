# LiquiScope — 90-second demo script (X video, #OKXAI)

Format: screen recording of a terminal (large font, dark theme) + the OKX.AI marketplace page.
Target ≤ 90s. Narration lines are written to be read aloud at a natural pace.

## Shot list

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

## Prep checklist (before recording)

- [ ] `<AT_RISK_WALLET>`: re-run `npm run test:live` the same day to find a fresh HF≈1.0–1.1 wallet (positions move; don't reuse a stale one).
- [ ] Fund Agentic Wallet with ~$1 USD₮0 on X Layer for the on-camera paid call.
- [ ] Listing live on the marketplace (post-review) so Shot 1/5 show the real page.
- [ ] Terminal: font ≥ 18pt, `jq` installed, commands in shell history.
