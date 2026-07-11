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

## Outstanding (as of 2026-07-12)

- [ ] OKX review verdict on #5074 → update listing in place to the two real services
      (free check + $0.15 report); re-review deadline Jul 15.
- [ ] User: 90s demo video (`demo/script.md`; find a fresh at-risk wallet via `npm run test:live`,
      balance covers exactly one on-camera paid call — top up if retries needed).
- [ ] User: X post with #OKXAI; Google form by **Jul 17, 23:59 UTC**.
