# OKX.AI Platform Notes

What the Onchain OS skills and OKX docs actually require, verified 2026-07-11 from:
- The 8 installed skills in `.agents/skills/` (v4.2.2): `okx-ai`, `okx-agentic-wallet`, `okx-agent-payments-protocol`, plus 5 others (defi, dex-market, dapp-discovery, growth-competition, guide).
- https://www.okx.ai/tutorial/asp · https://web3.okx.com/onchainos/dev-docs/okxai/howtomcp · …/okxai/registerasp · …/payments/service-seller-sdk

## The pipeline (prompt-driven, via `onchainos` CLI)

1. **Skills install** — done (project-local; global `-g` unsupported, see friction log FL-002). Skills load in a session started inside `~/liquiscope`.
2. **Agentic Wallet login** — email OTP via `onchainos wallet login <email>`. TEE-secured signing; no seed phrase handling. The CLI itself is installed on first preflight (`onchainos preflight` auto-installs/updates).
3. **Register ASP** — `agent create --role asp …` on **XLayer only** (chain-fixed; identity is ERC-8004). **All on-chain identity ops (create/update/activate/deactivate) cost the user NOTHING — OKX covers network fees.** One ASP identity per wallet address; one ASP can hold multiple services.
4. **List** — `activate` publishes; **review completes within 24h**, result goes to the wallet email AND the agent conversation. An unreviewed/rejected ASP is still callable via its Agent ID (but hackathon requires passing review + live).
5. **Update** — supported (`identity-update.md`): wholesale service replacement, rejected-listing remediation. So we CAN upgrade hello-world → LiquiScope in place. Updates re-run listing QA.

## ASP registration field requirements (enforced by CLI `validate-listing`)

| Field | Rule |
|---|---|
| Agent name | brand name, EN 3–25 chars, **no test markers** ("test" in a name gets flagged), no celebrity names |
| Agent description | required, ≤500 chars |
| Avatar | **required for ASP, must be an image FILE upload** (≤1 MB, PNG/JPEG/WebP, 1:1 recommended) — URLs rejected. Uploaded via `agent upload --file`, returns CDN URL |
| Service name | 5–30 chars, descriptive noun phrase, ≠ agent name, no price in name |
| Service description | **2-part structure on separate lines**: ① what it does + who it's for; ② what the caller must provide (e.g. "1. wallet address 2. chain"). ≤200 chars per part, ≤400 total. **No example prompts, no GitHub/wallet links, no tech-stack details, no disclaimers** |
| Type | `A2MCP` (API) or `A2A` (negotiated) |
| Fee | plain number string, e.g. `"0.1"` — **currency is always USDT**, no symbol/unit. `0` = free. ≤6 decimals |
| Endpoint | `https://` only, publicly reachable, actually deployed, ≤512 chars. localhost/private IPs/placeholders rejected. Endpoint is on-chain (changing = update op) |

Registration order: identity card (name/desc/avatar) → service(s) collection loop → single `validate-listing` batch QA → confirmation card → one `agent create` → `activate` to publish.

**Category:** no explicit category field appears anywhere in the registration flow — discovery appears to be search/semantic. "Finance" placement presumably derives from name/description. → Verify during actual registration.

## A2MCP endpoint spec

**Free endpoint:** plain HTTPS endpoint returning HTTP 200 with the result directly. No manifest, no wrapper format documented. Self-check: `curl -i -X POST https://domain/path` → 200 + result.

**x402 paid endpoint:** no payment header → HTTP 402 with `PAYMENT-REQUIRED` header (v2) or `x402Version` body (v1). Buyer pays → replays request with `X-PAYMENT`/authorization header → 200 (+ `PAYMENT-RESPONSE` settlement header). Standard 402 challenge (v2):

```json
{
  "x402Version": 2,
  "resource": { "url": "https://<endpoint>", "description": "<desc>", "mimeType": "application/json" },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:196",
    "asset": "0x779ded0c9e1022225f8e0630b35a9b54be713736",
    "amount": "100000",
    "payTo": "0x<our X Layer wallet>",
    "maxTimeoutSeconds": 300,
    "extra": { "name": "USD₮0", "version": "1" }
  }]
}
```

- **Chain:** X Layer mainnet (`eip155:196`) — gas-free chain. Testnet `eip155:1952` with faucet (test OKB + test USD₮0) for integration testing. Official mock merchant on testnet: `https://www.okx.com/api/v1/pay/mock-merchant/resource`.
- **Token:** USD₮0 at `0x779ded0c9e1022225f8e0630b35a9b54be713736`, 6 decimals ($0.10 = `"100000"`).
- **Receiving wallet:** any EVM wallet — our Agentic Wallet's X Layer address works.
- **Server-side options:**
  - **OKX Payment SDK** (recommended by OKX): `@okxweb3/x402-express` + `@okxweb3/x402-core` + `@okxweb3/x402-evm` (Node/Express middleware). Prices as USD strings (`"$0.10"`), auto-converted to stablecoin units. **Requires an OKX Developer Portal API key** (apiKey/secretKey/passphrase) for the facilitator client — free to obtain at https://web3.okx.com/onchainos/dev-portal.
  - **Self-implement**: return compliant 402, verify EIP-3009 payment header, replay protection, settlement. There is also a facilitator **HTTP API** (…/payments/api-http) usable from non-Node runtimes (e.g. Cloudflare Workers without Express).
- Settlement is instant + fully automatic once listed ("every API call triggers billing… no manual intervention").

## Buyer side (for our self-test paid call)

`onchainos payment pay --payload '<raw 402>'` — CLI decodes, TEE-signs, returns `authorization_header` to replay. Requires wallet login. Buyer needs USD₮0 on X Layer to pay (funding the wallet with ~$1 of USD₮0 is the one real-money item — Phase 3, ask user first).

## Zero-budget assessment (gate inputs)

| Cost wall | Verdict |
|---|---|
| Registration/listing/activation | **$0 — OKX pays gas** |
| Wallet | Email OTP, free, no KYC observed in any flow |
| OKX Dev Portal API key (needed for Payment SDK facilitator, Phase 2) | Free signup; also lifts shared-CLI rate limits |
| Hosting | Free endpoint has no OKX-side constraint beyond public HTTPS; Cloudflare Workers free tier fits (no cold starts — good for "stays live" review) |
| Only real-money item | Dust USD₮0 on X Layer for the self-test paid call (Revenue Rocket seed) |

## Open questions (answer during live registration)

1. Category/"Finance" — is there a category picker, or is it inferred? (No field in CLI flow.)
2. Does review re-test the endpoint (uptime probes)? Docs imply endpoint compliance is checked at review.
3. Fee `"0"` + a second paid service under one ASP — confirm both services can coexist (one ASP, multiple services is explicitly supported).
4. Does the Express SDK run on Cloudflare Workers (nodejs_compat), or do we hand-roll 402 + facilitator HTTP API? Decide in Phase 2; hello-world is free-tier-trivial either way.
5. Rate limits on shared CLI key — get a personal Dev Portal key early if throttled.
