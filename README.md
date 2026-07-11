# LiquiScope

DeFi liquidation-risk reports as an A2MCP Agent Service Provider on OKX.AI.
**Live endpoint:** https://liquiscope.liquiscope.workers.dev · **Agent ID:** #5074 (X Layer, ERC-8004)

| Endpoint | Price | What you get |
|---|---|---|
| `POST /check` | free | Single-chain health factor + risk tier. Body: `{"address": "0x…", "chain": "base"\|"ethereum"\|"arbitrum"}` |
| `POST /report` | $0.15 (x402, USD₮0 on X Layer) | Full multi-chain analysis: Aave v3 (Ethereum, Base, Arbitrum) + Compound v3 (Base, Arbitrum — all 9 Comet markets), per-position liquidation price of the dominant collateral, %-drop-to-liquidation, plain-language summary + per-tier recommendation. Body: `{"address": "0x…"}` |

Risk tiers by health factor: **safe** ≥ 1.5 > **watch** ≥ 1.15 > **danger** ≥ 1.05 > **critical** ≥ 1.0 > **liquidatable**.

## Architecture

```
POST /check ──► engine ──► JSON
POST /report ─► x402 (402 challenge → verify → settle via OKX facilitator) ─► engine ─► report
                                                                                 │
engine (src/engine/): viem · 4 fallback RPCs per chain · multicall batching     ▼
  aave.ts     contracts resolved at runtime from PoolAddressesProvider   report (src/report/):
  compound.ts Comet proxies pinned from compound-finance/comet            claude-haiku summary
  risk.ts     HF, dominant-collateral liquidation price, tiers            + deterministic fallback
```

- **Hosting:** Cloudflare Workers (free tier, no cold-start penalty). Cron trigger self-checks the full engine path every 10 minutes.
- **Payments:** x402 exact/v2 on X Layer (`eip155:196`), USD₮0, EIP-3009. Challenge in `PAYMENT-REQUIRED` header + body; settlement receipt in `PAYMENT-RESPONSE` header. Verify/settle via the OKX facilitator HTTP API (HMAC-signed, WebCrypto — no Node SDK needed).

## Reliability (the brand)

- Every chain has 4 free public RPCs behind viem's fallback transport; multicall keeps a full Aave scan to ~4 logical round-trips.
- A protocol failing on one chain degrades that slice (`partialErrors` in the response) — never the whole scan.
- The LLM summary (claude-haiku-4-5, 5-min cache) falls back to a deterministic template on any error, timeout, or refusal: **the endpoint cannot 500 because the LLM hiccuped**. `summarySource` tells you which path produced the text.
- All upstream failures surface as 503 + detail (retryable), never bare 500s. Free endpoint rate-limited 30/min/IP.
- E-mode positions: HF is always the on-chain aggregate; liquidation price uses the position-wide weighted-average threshold (exact for single-collateral positions).

## Docs

- [docs/friction-log.md](docs/friction-log.md) — OKX.AI beta rough edges, from minute one.
- [docs/platform-notes.md](docs/platform-notes.md) — what the Onchain OS skills / A2MCP spec actually require.
- [SUBMISSION.md](SUBMISSION.md) — hackathon form details.

## Dev

```bash
npm install
npm run typecheck
npm run test:live   # live mainnet test: discovers real borrowers, checks invariants
npm run dev         # local worker on :8787 (secrets from .dev.vars)
npm run deploy
```

Secrets (via `wrangler secret put`): `ANTHROPIC_API_KEY`, `OKX_API_KEY`, `OKX_SECRET_KEY`, `OKX_PASSPHRASE`.
