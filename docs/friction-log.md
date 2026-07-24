# LiquiScope — OKX.AI Friction Log

Running log of rough edges hit while building an A2MCP ASP on OKX.AI (beta).
Format: date/time (UTC), what we tried, what happened, workaround, severity.

---

## 2026-07-11

### FL-001 — (log opened)
- **What:** Project start. Log opened before any OKX.AI interaction, per working rules.
- **Status:** n/a

### FL-002 — Global skill install fails, docs say to use `-g`
- **What:** `npx skills add okx/onchainos-skills --yes -g` (the exact command from https://www.okx.ai/tutorial/asp step 2) failed for all 8 skills: "PromptScript: PromptScript does not support global skill installation".
- **Workaround:** re-ran without `-g` → project-local install to `.agents/skills/` succeeded, symlinked for Claude Code.
- **Severity:** low (easy workaround) but the official tutorial command is copy-paste broken for Claude Code users.

### FL-003 — www.okx.ai TLS chain incomplete
- **What:** Fetching https://www.okx.ai/tutorial/asp with a strict-TLS client failed: "unable to verify the first certificate" (server not sending full cert chain). Browsers cope; some HTTP libraries don't.
- **Workaround:** fetched via a proxy scraper. web3.okx.com docs pages were fine.
- **Severity:** low.

### FL-004 — Docs are prompt-first, spec-light
- **What:** The A2MCP "spec" is one example JSON block in the guide; no schema for the free-endpoint response shape, no category/taxonomy docs, no listing-review criteria beyond "compliant endpoint". Registration field limits live only inside the skill files (`validate-listing` rules), not in public docs.
- **Workaround:** introspected the installed skill markdown directly (`.agents/skills/okx-ai/references/identity-register.md` is the real spec).
- **Severity:** medium — without reading skill internals you'd discover field limits one rejection at a time.

### FL-005 — onchainos installer flow trips agent-harness safety classifiers
- **What:** Skill preflight fallback says: download `install.sh` from the GitHub release, verify SHA256, execute. Claude Code's auto-mode classifier denied executing the downloaded script (external-code policy) even after checksum verification — required an explicit user approval round-trip.
- **Workaround:** user said "run the installer"; ran with sandbox disabled. Installed fine to `~/.local/bin/onchainos` (silently — zero stdout on success, which also cost a verification round).
- **Severity:** medium for agent-first platforms — a `brew`/`npm` distribution channel would avoid both the classifier trip and the silent-success ambiguity. Ironic that an agent-native platform's own bootstrap is the step agents can't do autonomously.

### FL-006 — Cloudflare: new accounts can't deploy Workers non-interactively
- **What:** `wrangler deploy` on a fresh account uploads but refuses to publish: no workers.dev subdomain registered. The interactive prompt auto-answers "no" in non-interactive contexts, and wrangler 4 removed the `subdomain` command entirely — dashboard-only per the error message.
- **Workaround:** `PUT /accounts/{id}/workers/subdomain` with wrangler's stored OAuth token registered `liquiscope.workers.dev` directly; redeploy then succeeded.
- **Severity:** low (one-time), but a real wall for fully-autonomous agent deploys on fresh accounts.

### FL-007 — Fresh workers.dev subdomain: TLS cert lags DNS
- **What:** Immediately after subdomain registration + deploy, HTTPS requests fail with `sslv3 alert handshake failure` — DNS resolves but the edge cert isn't provisioned yet.
- **Workaround:** poll until the cert goes live (minutes-scale). Relevant for OKX listing review: never submit the endpoint URL until a real 200-over-HTTPS is observed.
- **Severity:** low.

### FL-008 — `validate-listing` PARSE error suggests wrong field names
- **What:** `agent validate-listing --service` rejected a valid JSON array with a PARSE error whose own `fix` example shows lowercase keys (`servicedescription`, `servicetype`) — but the actual required keys are camelCase (`serviceName`, `serviceDescription`, `serviceType`), documented only in `agent create --help`. Following the error's example verbatim fails again with the same error.
- **Workaround:** read `agent create --help` for the real element shape.
- **Severity:** medium — a self-contradicting error message sends every first-time ASP through at least two failed attempts.

### FL-009 — `agent activate` hard-depends on the okx-a2a Node daemon
- **What:** `onchainos agent activate` refuses to run until `@okxweb3/a2a-node` is globally npm-installed and its daemon is up (`okx-a2a doctor --fix`) — even for a pure A2MCP (API-only) listing that never uses agent-to-agent chat. Registration (`agent create`) had no such gate. Nothing in the tutorial or register docs mentions this dependency; the doctor also silently installs a launchd autostart.
- **Workaround:** install + `doctor --fix` (needs Node ≥22.14 and a logged-in AI provider CLI), then re-run activate.
- **Severity:** medium — surprise global install with OS-level autostart, discovered only at the final publish step; also a second agent-harness classifier trip (global npm install of an agent-chosen package needs manual approval).

### FL-010 — Facilitator API: numeric `code` vs documented string; `timeout` + `success:true`
- **What (2026-07-12):** (a) The x402 facilitator (`/api/v6/pay/x402/verify`) returns `"code": 0` as a JSON **number**, while OKX's own API examples show `"code": "0"` as a string — a strict-equality check against `"0"` treats every success as failure. (b) `settle` with `syncSettle:true` returned `{"success": true, "status": "timeout", "amount": null}` for a payment that settled fine on-chain seconds later — "timeout" only means the sync wait expired, but paired with a null amount it reads like a failure.
- **Workaround:** compare `String(code) !== "0"`; treat `success:true` as authoritative and verify the tx hash on-chain.
- **Severity:** medium — both cost a debugging round-trip on the very first real payment.

## 2026-07-24 — cross-protocol/cross-chain engine extension

### FL-011 — bgd-labs/aave-address-book file layout isn't obvious from the repo root
- **What:** Verifying Aave's PoolAddressesProvider per chain requires the file `src/AaveV3<Chain>.sol` (e.g. `AaveV3Optimism.sol`); a first guess at `raw.githubusercontent.com/.../src/Aave${net}.sol` (missing the `V3`) silently 404s as an empty string rather than an error, and the GitHub Contents API 301-redirects on the un-normalized `src` path, returning a `{"message":"Moved Permanently"}` object that breaks naive JSON list-parsing.
- **Workaround:** list the directory first (`-L` to follow the redirect) to get exact filenames, then fetch each `AaveV3<Chain>.sol` and pull the address from the `// https://<explorer>/address/0x...` comment directly above the `POOL_ADDRESSES_PROVIDER` constant (more reliable to grep than the multi-line Solidity declaration itself).
- **Severity:** low — but worth noting the address for Optimism and Arbitrum is **identical** (`0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb`), confirmed genuine (not a copy-paste error) via each chain's own explorer-specific link in the source comment. Aave deploys this contract via a deterministic factory on some chains.

### FL-012 — free-RPC `eth_getLogs` archive rejections can hang a naive fallback client for minutes
- **What:** `eth_getLogs` over any but the most recent block range on some free RPCs (observed: `1rpc.io/eth`) returns a well-formed JSON-RPC error ("Archive requests require a personal token") rather than a network-level failure. Our `fallback()` transport config (`rank: false`, chosen deliberately so every request tries the primary RPC first) does **not** treat a formatted RPC error as a signal to rotate to the next RPC in the list — it just retries the same unresponsive RPC per `http()`'s own `retryCount`. A naive "walk back through N block-windows until you find events" discovery loop (used only in `scripts/test-live.ts` to hunt for real fixture wallets, never in the production read path) burned 10+ minutes retrying the same dead RPC before we noticed CPU time was ~0 despite the process running — i.e. it was blocked on I/O, not doing work.
- **Workaround:** added a hard wall-clock budget (`Date.now() < deadline`) around the discovery loop, checked every iteration, so a bad RPC degrades to "found fewer wallets" instead of hanging. **Does not affect the production engine** — the real adapters never call `eth_getLogs`; they only call view functions (`getUserAccountData`, `borrowBalanceOf`, …) via `readContract`, a completely different code path unaffected by this failure mode (confirmed: direct adapter calls against known wallets completed in ~0.5–1.1s throughout, including while the discovery script was hung).
- **Severity:** medium for any future tooling that leans on `eth_getLogs` against free RPCs; zero production impact.

### FL-013 — one adapter × chain slice (Compound v3 / Ethereum mainnet) shipped without a live positive fixture
- **What:** Found real, math-validated live positions for every new/existing adapter × chain combination except Compound v3 on Ethereum mainnet — recent `Withdraw` event activity on the two supported Comet markets (USDC, WETH) was too sparse to find a real borrower within a reasonable RPC budget (see FL-012; the naive event-scan approach just isn't reliable against free-tier archive limits for a low-traffic market).
- **Workaround:** verified what could actually be verified without a wallet: (a) the market addresses themselves, from the canonical `compound-finance/comet` deployments folder; (b) the `ethDenominated: true` assumption for the WETH market, by reading its base price feed directly on-chain — it returns exactly `1.0`, confirming the feed prices WETH in WETH terms (matching the already-proven Base/Arbitrum WETH-market pattern) rather than guessing by analogy. The adapter code itself is unchanged from the already-real-world-tested Base/Arbitrum implementation; only the address and this one flag are new per chain.
- **Severity:** low-medium — the math is verified by construction and direct feed inspection, but there is no end-to-end "real wallet, real numbers" proof for this one slice the way there is for the other six. Flagging honestly rather than claiming full coverage; worth a follow-up once a live borrower surfaces (or via a paid archive RPC).

## 2026-07-24 — engine-depth (watch mode, GET /proof)

### FL-014 — free RPC `eth_getLogs` range limits are a hard free-tier ceiling, not an archive-depth gap — confirmed with fresh data
- **What:** Revisited FL-012/013's open question directly: is the block-range restriction on free RPCs specifically about querying OLD history (archive tier), or a flat ceiling that applies even to the MOST RECENT blocks? Tested `eth_getLogs` for WETH `Transfer` events over the most recent 2000 blocks (not historical — freshly queried against each provider's own current chain head) across the four Ethereum RPCs this project's fallback list uses:
  - `ethereum-rpc.publicnode.com`: rejected — `"Archive requests require a personal token"`, even though the range was the last 2000 blocks, not old history. Whatever internally classifies a request as "archive" here isn't about age.
  - `cloudflare-eth.com`: rejected — generic `"Internal error"` (unhelpful, but consistent with a range/complexity cap tripping).
  - `eth.llamarpc.com`: returned an HTML page instead of JSON (looked like a block/challenge page, not a clean RPC error) — inconclusive, but effectively unusable for this call shape either way.
  - `1rpc.io/eth`: rejected with an explicit, specific limit — `"eth_getLogs is limited to 0 - 50 blocks range"`. Not ~2000; **50**.
  - Corroborated against general provider-comparison research (not just this project's 4 RPCs): free-tier `eth_getLogs` caps commonly range roughly 50–1,000 blocks or a fixed result-count ceiling, vary per provider with no standard, and are enforced by hard rejection rather than truncation. [SQD: eth_getLogs limits](https://sqd.dev/learn/eth-getlogs-limits/), [QuickNode 2026 RPC provider comparison](https://blog.quicknode.com/best-ethereum-rpc-providers-2026-a-full-comparison/).
- **Conclusion:** confirms the user's framing exactly — this is a free-infrastructure ceiling on `eth_getLogs` itself (rate/complexity-limiting a potentially-expensive query type), not merely an archive-tier gap on old data. It affects any future feature built on event scanning (e.g. a fixture-wallet discovery tool), not the production adapters, which never call `eth_getLogs` (see FL-012 — they use `readContract`/view functions only).
- **Severity:** low production impact (unchanged from FL-012), but now backed by fresh, specific numbers instead of an assumption — useful for anyone planning log-scanning tooling against this project's free-RPC list.

### FL-015 — historical `eth_call` reads (block-pinned) don't multicall-batch, and free-RPC archive depth is spotty even within a supposedly-achieved window
- **What:** Building GET /proof (historical health-factor replay) surfaced two related, previously-unmeasured findings:
  1. viem's `batch.multicall` config collapses CONCURRENT reads issued for the same ("latest") block into very few actual HTTP calls (measured elsewhere in this build: ~1 call per wallet for 8 concurrent live reads). That collapsing does **not** happen the same way across reads pinned to DIFFERENT historical block numbers — each block-pinned `readContract` call becomes its own round-trip, and a single historical position read (which internally does several sequential, data-dependent reads) measured ~10 real HTTP calls, not ~1.
  2. Free-RPC archive depth, once you can reach historical state at all, is not a clean threshold. Binary-search probing a real wallet on Arbitrum found an "achieved" lookback of 16 days — but 3 of 6 samples still WITHIN that 16-day window failed to read. The boundary isn't reliable call-to-call, likely because viem's fallback rotates across multiple providers with independently varying (and possibly rate-limited) archive behavior.
- **Workaround:** built a lean HF-only read path (`getHealthFactorAt` on each adapter, computing the exact same health factor via the exact same formula, just skipping every display-only field a trajectory point doesn't need) and a separate historical RPC client (`getHistoricalClient` in `rpc.ts`) with `retryCount: 0` and only the first 2 fallback providers instead of 4 — cut one real `/proof` request's measured HTTP-call count from 160 to 32. In-range samples that still fail are reported honestly (`readable: false`) rather than hidden or faked; the achieved-lookback number itself is reported as "what was actually queryable," never a promise.
- **Severity:** medium — this would have been a silent production failure (Workers' 50-subrequest/invocation ceiling exceeded) had it shipped un-measured; caught during testing, not after deploy.

## 2026-07-24 (cont.) — liquiscope-demo-agent: the buyer side of our own x402 flow

### FL-016 — first time consuming our own x402 endpoints from the client/buyer side
- **What:** Everything in this repo so far implements the x402 **seller** side (`x402.ts`: challenge, verify, settle). Building a real autonomous buyer (`liquiscope-demo-agent`, a separate standalone repo) was the first time this project exercised its own API from the other side of the table. Notes from that vantage point:
  1. `onchainos payment pay-local --payload <base64>` signs successfully even with **zero balance** in the wallet — signing is a pure off-chain operation (EIP-712/EIP-3009), so the CLI doesn't pre-check funds. Only the facilitator's actual settle step fails for insufficient balance. Useful: a buyer agent can pre-stage a signed authorization before confirming funding has landed, if it wants to.
  2. `pay-local`'s stdout is wrapped in `{"ok":true,"data":{authorization_header,...}}`, not the flat object the semantic field list in `accepts-schemes.md` might suggest — had to confirm the exact shape empirically against a real 402 challenge before wiring the parser correctly.
  3. The settlement's `transaction` field (surfaced to the buyer via the decoded `PAYMENT-RESPONSE` header) was a real, immediately-queryable tx hash every time — cross-verified independently via `getTransactionReceipt` on two separate RPCs rather than trusted blindly, and it checked out both times, 4 payments total.
  4. `exact + EIP-3009` is genuinely gasless for the buyer in practice, not just in the docs: the demo wallet's native OKB balance stayed at exactly 0 across every run (4 real payments) — the OKX facilitator submits the on-chain transfer and pays gas itself, confirmed by checking the `from` address on each settled transaction (a facilitator relayer address, never the buyer's own wallet).
- **Severity:** informational / positive — no real friction, no failed payments, no retries needed on any of the 4 real settlements. Recorded because "our own seller-side code works" and "our own buyer-side integration works, empirically, against production, with real money" are different claims, and only the second one was actually true.
