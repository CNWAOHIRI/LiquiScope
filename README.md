# LiquiScope

DeFi liquidation-risk reports as an A2MCP Agent Service Provider on OKX.AI.
**Live endpoint:** https://liquiscope.liquiscope.workers.dev · **Agent ID:** #5074 (X Layer, ERC-8004)

> The `feat/engine-depth` branch (portfolio score, recommendations, stress scenarios, Watch Mode, GET /proof — documented below) is built and tested but **not yet merged/deployed**. The live endpoint above still serves the pre-engine-depth shape until that branch is merged.

| Endpoint | Price | What you get |
|---|---|---|
| `POST /check` | free | Single-chain quick health factor + risk tier. Body: `{"address": "0x…", "chain": "base"\|"ethereum"\|"arbitrum"\|"optimism"}` |
| `POST /report` | $0.15 (x402, USD₮0 on X Layer) | Full cross-protocol, cross-chain analysis: every position, liquidation price + %-drop of the dominant collateral, plain-language summary, **plus** `portfolio_score`, `recommendations`, and an optional `?stress_pct=-20` hypothetical price-move scenario (see below). Body: `{"address": "0x…"}` |
| `POST /watch` | $0.02/day, 3-day min (x402) | Recurring health-factor alert. Body: `{wallet, chain, protocol, hf_threshold, notify_webhook, duration_days}`. Checked on a rotating cron; fires a webhook POST the moment `hf_threshold` is crossed, deduped per-crossing. |
| `GET /watch/:id/status` | free | Subscription status: last checked HF, alert state, expiry. |
| `GET /proof` | $0.15 (x402) | Historical "would-have-warned-you" replay. `?wallet=&chain=&protocol=` — replays the wallet's HF trajectory over the best achievable free-tier RPC lookback and flags any past liquidation-eligible crossings. |

Risk tiers by health factor: **safe** ≥ 1.5 > **watch** ≥ 1.15 > **danger** ≥ 1.05 > **critical** ≥ 1.0 > **liquidatable**.

## Coverage matrix

| Protocol | Ethereum | Base | Arbitrum | Optimism |
|---|---|---|---|---|
| Aave v3 | ok | ok | ok | ok |
| Compound v3 | **beta** (see below) | ok | ok | unsupported |

`GET /report`'s `coverage` field reports this live, per request, as `"ok" \| "beta" \| "error" \| "unsupported"`. **beta** means the read succeeds and is computed by the exact same formula as every "ok" source, but has never been checked against a real live position — every position from a beta source is stamped `provisional: true` so a paid report never silently presents an unconfirmed number as equivalent to a battle-tested one. Currently only Compound v3 / Ethereum mainnet is beta: no fixture wallet was found because free-tier RPCs cap `eth_getLogs` ranges too tightly for event-based wallet discovery to be practical (see `docs/friction-log.md` FL-012/013/014 — as tight as 50 blocks on some providers). The math itself is verified by construction and direct on-chain feed inspection, just not against a real borrower yet.

**Beta status re-evaluated 2026-07-24** (engine-depth build): still beta, for the same reason — re-tested the `eth_getLogs` ceiling with fresh numbers this session (FL-014) and it hasn't eased. This is a live, revisited decision each time the engine is touched, not a stale label.

## Portfolio score (in `/report`'s `portfolio_score` field)

A single 0-100 number + label summarizing a wallet's entire cross-protocol, cross-chain exposure — designed to survive "how did you get 72?":

```
base_score  = piecewise-linear interpolation of the WORST health factor across
              all positions, anchored at the exact tier breakpoints above
              (1.0→10, 1.05→30, 1.15→55, 1.5→80, 3.0→100)
concentration_penalty = up to 15 points, scaled by the Herfindahl-Hirschman
              Index of collateral value across unique asset symbols
              (0 = perfectly diversified, 1.0 = single asset)
final_score = round(base_score * (1 - 0.15 * HHI))
```

HF dominates (it's the actual liquidation trigger); concentration is a capped secondary tilt — a single-asset wallet with an otherwise-safe HF never gets penalized below its own tier's floor. Zero debt-bearing positions returns `{score: null, label: "no_active_positions"}`, never a fabricated number. Full derivation: `src/report/portfolioScore.ts`.

`recommendations` (same response) computes concrete repay-debt / add-collateral amounts to reach HF 1.5 for any position below it, solved from the identity `weightedCollateralUsd = healthFactor × debtUsd` — no separate model, just the same math run backwards. `?stress_pct=-20` recomputes HF/score/recommendations under a hypothetical uniform collateral-price move, via the provably exact rescaling `HF_stressed = HF_real × (1 + stress_pct/100)` — same code path as the real numbers, not a parallel one. Details: `src/report/recommendations.ts`, `src/report/stress.ts`.

## Watch Mode

`POST /watch` — $0.02/day, 3-day minimum, x402-paid, price scales linearly with `duration_days`. Checked on a Cloudflare Cron Trigger (`*/15 * * * *`) via a shard-blob KV design (`src/watch/storage.ts`): subscriptions are grouped ~8-per-shard in one JSON blob, not one KV key each — the free tier's 1000-writes/day account-wide cap would otherwise cap out around 40 subscribers. Alert delivery is idempotent: a webhook fires once per threshold-crossing (latched `alert_state`, only flips after a *confirmed* delivery), resets on recovery, and a failed/timed-out check is retried next tick rather than dropped or double-fired. Latency degrades gracefully as subscriber count grows past free-tier capacity (15 min → 30 min → 45 min → … in steps of `TARGET_SUBS_PER_SHARD` shards, see `src/watch/budget.ts`) instead of silently failing past some cliff. `GET /watch/:id/status` (free) returns last-checked HF, alert state, and expiry.

## GET /proof — historical "would-have-warned-you" mode

`?wallet=&chain=&protocol=`, x402-paid. Free-tier RPC archive depth isn't advertised and varies by provider, so instead of promising a fixed lookback window, the actual achievable range is *probed* per request (binary search, ~5-6 reads) and reported honestly — `lookback.achieved_days` may be less than the 30-day target, and the response says so explicitly rather than padding the number. The trajectory is sampled at a handful of points across that window (`TRAJECTORY_SAMPLES`) using a lean, HF-only read that computes the exact same health factor via the exact same formula as a live read, just without the display-only data a trajectory point doesn't need — historical block-pinned reads don't multicall-batch the way live reads do, so this distinction is a real, measured subrequest-budget necessity (see `docs/friction-log.md` FL-015), not premature optimization. A sample that fails to read is marked `readable: false`, never silently dropped or faked. Incidents are historical crossings below HF 1.0 (the same "liquidatable" boundary used everywhere else), with first-crossing time, lowest HF observed, and recovery tracked per market.

## Architecture

```
POST /check ──► engine ──► JSON
POST /report ─► x402 ─► engine ─► portfolio_score + recommendations + stress_scenario ─► report
POST /watch  ─► x402 (duration-scaled) ─► KV shard-blob ─► cron (15min) ─► webhook
GET  /proof  ─► x402 ─► lookback probe ─► lean historical replay ─► incidents

engine (src/engine/): viem · 4 fallback RPCs per chain (2 for historical reads) · multicall batching
  adapters/aaveV3.ts     PoolAddressesProvider-resolved; getHealthFactorAt for /proof
  adapters/compoundV3.ts Comet proxies pinned from compound-finance/comet; same lean-read pattern
  risk.ts                HF tiers, dominant-collateral liquidation price
  rpc.ts                 getClient (live) vs getHistoricalClient (historical, tighter retry/provider budget)
```

- **Hosting:** Cloudflare Workers (free tier, no cold-start penalty). Two cron patterns share one Worker: `*/10` self-check, `*/15` Watch Mode sweep.
- **Payments:** x402 exact/v2 on X Layer (`eip155:196`), USD₮0, EIP-3009. Challenge in `PAYMENT-REQUIRED` header + body; settlement receipt in `PAYMENT-RESPONSE` header. Verify/settle via the OKX facilitator HTTP API (HMAC-signed, WebCrypto — no Node SDK needed). Price/description are per-call parameters (`x402.ts`), not hardcoded, so `/watch`'s duration-scaled pricing and `/proof`'s flat price reuse the same verify/settle flow as `/report`.

## Reliability (the brand)

- Every chain has 4 free public RPCs behind viem's fallback transport for live reads; multicall keeps a full Aave scan to ~1 logical round-trip per wallet (measured). Historical reads (GET /proof) use a separate, tighter-budgeted client — see above.
- A protocol failing on one chain degrades that slice (`partialErrors` / `coverage` in the response) — never the whole scan. The coverage matrix distinguishes `ok`/`beta`/`error`/`unsupported` per protocol×chain, live, every request.
- The LLM summary (claude-haiku-4-5, 5-min cache) falls back to a deterministic template on any error, timeout, or refusal: **the endpoint cannot 500 because the LLM hiccuped**. `summarySource` tells you which path produced the text.
- All upstream failures surface as 503 + detail (retryable), never bare 500s. Free endpoint rate-limited 30/min/IP.
- E-mode positions: HF is always the on-chain aggregate; liquidation price uses the position-wide weighted-average threshold (exact for single-collateral positions).
- Every new field across every endpoint is additive — existing `/check` and `/report` fields never change shape, name, or type. Verified via programmatic field-level diffing against real production responses, not eyeballing.

## Docs

- [docs/friction-log.md](docs/friction-log.md) — OKX.AI beta rough edges, from minute one.
- [docs/platform-notes.md](docs/platform-notes.md) — what the Onchain OS skills / A2MCP spec actually require.
- [docs/build-journal.md](docs/build-journal.md) — session-by-session build record.
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
KV binding: `WATCH_KV` (Watch Mode subscription storage — see `wrangler.jsonc`).
