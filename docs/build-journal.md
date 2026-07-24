# LiquiScope build journal

Chronological record of the build sessions (agent-assisted). Complements the
[friction log](friction-log.md) (OKX.AI rough edges) and [platform notes](platform-notes.md) (spec digest).

## 2026-07-11 — Phase 1: pipeline proven end-to-end

- Repo scaffolded; friction log opened before first OKX interaction.
- Onchain OS skills v4.2.2 installed project-local (`-g` broken, FL-002); platform introspected → `docs/platform-notes.md`.
- **hello-world probe** (ETH gas price Worker) built, verified locally, committed.
- `onchainos` CLI installed (checksum-verified installer; needed manual approval — FL-005).
- **Agentic Wallet created** via email OTP (`nwaohiriemekaa@gmail.com`), account "Account 1",
  address `0x5c0a7b5cae9f6ecdf005d80c323d70a4c2c7b556` (same on all EVM chains incl. X Layer).
- Cloudflare: registered `liquiscope.workers.dev` subdomain via raw API (wrangler 4 has no command, FL-006);
  hello-world deployed; TLS cert lagged ~150s (FL-007).
- **ASP registered on-chain**: LiquiScope **#5074**, X Layer, tx `0x5bc7d16b0ed43937d0203614a288aa62e0412e9158980635194bde4148e31904`.
  Avatar generated in pure Python (no PIL on host). `validate-listing` passed after camelCase key discovery (FL-008).
- `okx-a2a` runtime installed (activate hard-requires it, FL-009); **listing activated → submitted for review**.
  Status same evening: "Listing under review — AI quality review suggested pass".

## 2026-07-11 (cont.) — Phase 2: the real service

- Main Worker scaffolded at repo root (`src/engine/`, `src/report/`, TypeScript + viem).
- **Engine**: Aave v3 (Ethereum/Base/Arbitrum; contracts resolved at runtime from PoolAddressesProvider;
  e-mode approximated via position-wide weighted-avg liquidation threshold) + Compound v3
  (Base/Arbitrum, 9 Comet proxies verified from `compound-finance/comet` deployments/; WETH-market
  ETH-denominated feeds converted via Aave oracle). Multi-RPC fallback (4/chain) + multicall batching.
- **Risk math**: HF, dominant-collateral liquidation price, %-drop, tier ladder 1.5/1.15/1.05.
- **Live test harness** (`scripts/test-live.ts`): discovers real borrowers from Borrow/Withdraw events
  (free RPCs cap `eth_getLogs` at 50 blocks → windowed walk). Golden fixtures included an
  HF-1.04 Aave wallet (−3.6% to liquidation) and an HF-1.07 Comet borrower. All invariants passed.
- **Report layer**: `claude-haiku-4-5` via raw fetch + 5-min cache + deterministic template fallback —
  endpoint can never 500 from the LLM path.
- **Endpoints**: free `POST /check` (30/min/IP), paid `POST /report` (x402 exact/v2, $0.15 USD₮0 on
  `eip155:196`, EIP-3009; facilitator verify/settle at `web3.okx.com/api/v6/pay/x402/*` with
  HMAC-signed `OK-ACCESS-*` headers via WebCrypto). `btoa` fails on `₮` → UTF-8-safe base64 helper.
- **Deployed** to https://liquiscope.liquiscope.workers.dev; live `/check` verified against the critical wallet.
- Secrets set as Worker secrets (ANTHROPIC_API_KEY + OKX API triplet); LLM path and facilitator auth
  smoke-tested. Cron self-check (*/10) added. README, `demo/script.md`, `SUBMISSION.md` written.

## 2026-07-12 — Phase 3: Revenue Rocket

- Funding detour: user's USDT0 conversion landed in their exchange account, then OKX Wallet "Wallet A" —
  three distinct wallets; only the Agentic Wallet signs x402. Resolved with QR + checksummed address;
  0.160555 USDT0 arrived on X Layer.
- **First settled x402 payment, end-to-end**: 402 → `onchainos payment pay` (TEE) → replay with
  `PAYMENT-SIGNATURE` → HTTP 200 + LLM report + `PAYMENT-RESPONSE`.
  Settlement tx `0x02b96d9e9d04a254c3c9f0fca675057d46678a062da5cec098e1bc6ad840b4e0`,
  block 65039522, confirmed on-chain. Self-payment → balance unchanged.
- Live bug found+fixed during the first payment: facilitator returns numeric `code: 0`
  (docs show string) — FL-010.

## 2026-07-24 (cont. from a prior session) — Phase 4: engine-depth

Branched `feat/engine-depth` off `main` (post `feat/cross-protocol-engine` merge: Aave v3 on all
4 chains, Compound v3 on 3, additive `/report` back-compat shim, Compound/Ethereum beta-labeled).
Confirmed `feat/trust-depth` (`/proof`/`/stats`) did **not** already exist — item 5 built fresh.
Five features + housekeeping; **not merged/deployed** — isolated on the branch per explicit
standing instruction, awaiting go-ahead.

**Items 2-4 (portfolio_score, recommendations, stress_scenario)** — additive `/report` fields.
`liquidationThreshold` added to `DominantCollateral` (engine + compat shim) to power the
add-collateral math. `portfolio_score`: 0-100 anchored to the existing HF tier ladder, minus up to
15 pts for collateral concentration (HHI). `recommendations`: repay/add-collateral amounts solved
from `weightedCollateralUsd = healthFactor × debtUsd` — no new model. `stress_scenario`
(`?stress_pct=`): exact HF rescaling `HF_stressed = HF_real × factor`, proven algebraically, same
code path as live numbers. Tested against the $2.3M Optimism whale (score 78, real 27/73
WETH/wstETH split hand-verified), the HF-1.04 critical Arbitrum wallet (score 19, recs bring HF to
exactly 1.5), a 4-chain wallet, and an empty wallet (honest `null`/`no_active_positions`, no fake
score). One bug caught+fixed: unrounded stressed HF produced a float artifact
(`0.8254400000000001`) inconsistent with the same number shown elsewhere in the response.

**Item 1 (Watch Mode)** — `POST /watch`, $0.02/day, 3-day min, x402. Shard-blob KV (`~8`
subs/shard) instead of one-key-per-subscription, because the free tier's 1000-writes/day cap is
account-wide, not per-key — a naive design would've capped ~40 subscribers. `x402.ts` generalized
to accept a per-call amount/description (default params preserve `/report`'s exact prior
behavior). Cron budget (`watch/budget.ts`) derived from two measured ceilings — KV writes and
Workers subrequests (50/invocation) — with the tighter one winning; real subrequest cost measured
at ~1/wallet/check (multicall batching did better than the conservative pre-build estimate),
yielding `PER_TICK_SHARD_BUDGET = 4` and a 15→30→45min... graceful latency curve as subscriber
count grows, instead of a silent cliff. Alert dedup is idempotent by construction: `alert_state`
only flips `ok→fired` after a *confirmed* webhook delivery. Tested end-to-end via local
`wrangler dev --test-scheduled` + a real local webhook receiver against the HF-1.04 wallet: real
fire (HF 1.0318), dedup on repeat tick, recovery reset (no notification, v1 scope), re-crossing
fires again with an incremented dedup sequence, expiry pruning, 402 pricing scaling correctly by
duration. One bug caught+fixed pre-ship: the first cron draft used the full multi-protocol
`scanWallet` per check (wasteful) and silently deleted subscriptions on a transient RPC failure by
conflating "expired" with "check failed" — fixed to call only the subscribed protocol's adapter
and leave failed checks untouched for retry.

**Item 5 (GET /proof)** — historical "would-have-warned-you" replay, x402 $0.15 (default, matches
`/report`). Adapters gained an optional `blockNumber` param (additive, threaded through every
on-chain read). Lookback isn't promised, it's *probed*: binary search over days-back (not raw
block numbers — Arbitrum's block counts would need dozens of probes) finds the real achievable
window per request, reported honestly when less than the 30-day target. **Real bug caught during
testing**: the first working version reused the full adapter read path for historical samples —
measured 160 actual HTTP calls for one `/proof` request, over 3x the free Workers plan's
50-subrequest ceiling. Root cause (also measured): historical block-pinned reads don't
multicall-batch the way live same-block reads do, and failing historical reads burn a fetch
attempt per (fallback provider × retry) before giving up. Fixed with a lean HF-only reader per
adapter (same formula, same authoritative number, skips display-only fields) plus a separate
historical RPC client (`retryCount: 0`, first 2 providers only, live paths unaffected) and a lower
`TRAJECTORY_SAMPLES` (10→6). Re-measured: 32 calls for the same real request. Tested against the
HF-1.04 wallet (16 of 30 days achieved, some in-range samples honestly marked unreadable, the
readable ones matched previously-verified live HF), the Optimism whale (full 30 days, zero
failures, rising HF trajectory, zero incidents), an empty wallet, and a compound-v3/arbitrum probe
that correctly converged to `achievedDays: 0` for a combination the free RPCs genuinely couldn't
serve any history for.

**Item 6 (housekeeping)** — FL-014: re-tested the `eth_getLogs` range ceiling with fresh,
specific numbers (recent, not historical, 2000-block range): publicnode calls it an "archive
request" anyway, 1rpc.io states an explicit 50-block cap. Confirms it's a free-infra ceiling, not
an archive-tier gap. FL-015: documents the /proof multicall-batching/archive-depth findings above.
15-min-budgeted scan for wider-range providers: no single free provider clearly better across the
board (50-1000 block caps, unstandardized, per general research); no action taken, none required.
Compound/Ethereum beta status re-evaluated and dated in `scan.ts` — same underlying blocker,
re-confirmed this session, not a stale label.

**README**: full rewrite — it had never been updated for the `cross-protocol-engine` merge either
(still showed 3 Aave chains, 2 Compound chains, no coverage matrix). Now documents all 5
endpoints, the coverage matrix with live beta status, the portfolio-score formula worked through,
Watch Mode's design, and /proof's probing approach — flagged inline that engine-depth isn't
merged/deployed yet.

Constraints held throughout: zero-budget (free-tier KV/Cron/RPC only, friction-logged not
silently upgraded), additive-only (`/check`/`/report`'s existing fields unchanged), idempotent
everywhere it matters (webhook delivery, cron ticks, alert dedup), no merge/deploy/listing change
without explicit go-ahead.

## Outstanding (as of 2026-07-24)

- [ ] `feat/engine-depth` awaiting merge/deploy go-ahead.
- [ ] OKX review verdict on #5074 → update listing in place to the two real services
      (free check + $0.15 report); re-review deadline Jul 15.
- [ ] User: 90s demo video (`demo/script.md`; find a fresh at-risk wallet via `npm run test:live`,
      balance covers exactly one on-camera paid call — top up if retries needed).
- [ ] User: X post with #OKXAI; Google form by **Jul 17, 23:59 UTC**.
