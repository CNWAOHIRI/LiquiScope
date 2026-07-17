# Evidence: LiquiScope is registered on OKX.AI

Compiled 2026-07-17. Every item below is independently verifiable.

## 1. On-chain registration (strongest evidence — permanent, third-party verifiable)

OKX.AI agent identities are ERC-8004 records on X Layer mainnet (`eip155:196`). LiquiScope's:

| | |
|---|---|
| **Agent ID** | **#5074** |
| Registration tx | [`0x5bc7d16b0ed43937d0203614a288aa62e0412e9158980635194bde4148e31904`](https://www.oklink.com/xlayer/tx/0x5bc7d16b0ed43937d0203614a288aa62e0412e9158980635194bde4148e31904) |
| Registered | 2026-07-11 13:57:44 UTC · block 65008204 · status success (6 event logs) |
| Service-update tx | [`0x89bb4e3a7290258064af4dc13ab22bf05766eef5d0f9c98f233efbd3d8691b38`](https://www.oklink.com/xlayer/tx/0x89bb4e3a7290258064af4dc13ab22bf05766eef5d0f9c98f233efbd3d8691b38) |
| Updated | 2026-07-17 · block 65481661 · status success |
| Owner wallet | `0x5c0a7b5cae9f6ecdf005d80c323d70a4c2c7b556` (OKX Agentic Wallet, X Layer) |

Both transactions route through the ERC-4337 EntryPoint (`0x…71727de22e5e9d8baf0edac6f37da032`) — consistent with OKX sponsoring registration gas.

## 2. OKX's own records (queryable via Onchain OS CLI, authenticated as the owner)

`onchainos agent get-agents --agent-ids 5074` returns (as of compile time):

- `agentId: "5074"`, `name: "LiquiScope"`, role ASP
- `agentWalletAddress / ownerAddress: 0x5c0a7b5cae9f6ecdf005d80c323d70a4c2c7b556`
- `approvalRemark: "AI quality review suggested pass"` — and the **first listing review passed** (listing was publicly visible before the 2026-07-17 service update re-entered review)
- Current: "Listing under review" (the in-place update to the production services)

## 3. Marketplace page

**https://www.okx.ai/agents/5074** — canonical listing URL (agent-detail pages follow `okx.ai/agents/<agentId>`; returns 404 only while the service-update re-review is pending, then shows the listing again).

## 4. Revenue evidence (bonus — proves the listing transacts)

First settled x402 payment against the listed service, 2026-07-12:
[`0x02b96d9e9d04a254c3c9f0fca675057d46678a062da5cec098e1bc6ad840b4e0`](https://www.oklink.com/xlayer/tx/0x02b96d9e9d04a254c3c9f0fca675057d46678a062da5cec098e1bc6ad840b4e0) — 0.15 USD₮0 on X Layer, settled via the OKX facilitator, block 65039522.

## Suggested screenshots for the submission

1. The OKX.AI "My agents" view showing #5074 LiquiScope (log in at okx.ai with the wallet email).
2. The oklink explorer page of the registration tx.
3. The listing page at okx.ai/agents/5074 once re-review completes.
