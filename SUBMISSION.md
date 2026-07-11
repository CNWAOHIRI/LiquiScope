# SUBMISSION.md — OKX.AI Genesis Hackathon form inputs

> Fill-in status: items marked ⏳ finalize after the listing review passes / demo is recorded.

## Project

| Field | Value |
|---|---|
| Project name | LiquiScope |
| One-liner | DeFi liquidation-risk reports sold agent-to-agent: free health check, $0.15 full multi-chain report via x402. |
| Category | Finance |
| Agent ID | **#5074** (ERC-8004, X Layer) |
| ASP wallet | `0x5c0a7b5cae9f6ecdf005d80c323d70a4c2c7b556` |
| Listing link | ⏳ marketplace URL once listed (find via OKX.AI search "LiquiScope") |
| Endpoint | https://liquiscope.liquiscope.workers.dev |
| Repo | ⏳ (push to GitHub if the form asks; repo is local) |

## Services

1. **Wallet Liquidation Check** — free. `POST /check` `{address, chain}` → health factor + risk tier (safe/watch/danger/critical/liquidatable), single chain.
2. **Full Liquidation-Risk Report** — 0.15 USDT via x402 (exact/v2, USD₮0 on X Layer, EIP-3009). `POST /report` `{address}` → Aave v3 (Ethereum/Base/Arbitrum) + Compound v3 (Base/Arbitrum), per-position liquidation price, %-drop-to-liquidation, plain-language summary (Claude, deterministic fallback), per-tier recommendation.

## Revenue Rocket evidence

- ⏳ First settled x402 payment: tx hash + `PAYMENT-RESPONSE` receipt (self-test call, Phase 3).
- Settlement is automatic per call via OKX facilitator (verify + settle, HMAC-authed).

## Tech notes (if asked)

- Cloudflare Workers (free tier), TypeScript + viem; 4 fallback RPCs per chain, multicall batching; 10-min cron self-check.
- LLM layer: claude-haiku-4-5 with cache + template fallback — endpoint never 500s on LLM failure.
- Zero-budget build: free RPC tiers, free hosting, gas-free registration (OKX pays), gas-free chain (X Layer) for payments.
- Friction log of OKX.AI beta rough edges: `docs/friction-log.md` (FL-001…FL-009).

## X post checklist (user task)

- [ ] ≤90s demo video (script: `demo/script.md`)
- [ ] Include **#OKXAI**
- [ ] Mention agent #5074 / LiquiScope + marketplace link
- [ ] Post URL → paste into the Google form

## Form submission checklist (user task)

- [ ] Google form link from hackathon page
- [ ] Paste Agent ID, listing link, endpoint, X post URL
- [ ] Submit before **Jul 17, 23:59 UTC** (target: Jul 17 midday)
