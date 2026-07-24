/**
 * Chain configs + viem clients. Reliability is the brand: every chain gets a
 * fallback transport across several free public RPCs — first healthy one wins,
 * and viem rotates on failure. Multicall batching keeps us inside free-tier
 * rate limits (an Aave scan is ~3 logical round-trips, not ~80 calls).
 */

import { createPublicClient, fallback, http, type PublicClient } from "viem";
import { arbitrum, base, mainnet, optimism } from "viem/chains";
import type { ChainKey } from "./types";

const RPCS: Record<ChainKey, string[]> = {
  ethereum: [
    "https://ethereum-rpc.publicnode.com",
    "https://cloudflare-eth.com",
    "https://eth.llamarpc.com",
    "https://1rpc.io/eth",
  ],
  base: [
    "https://base-rpc.publicnode.com",
    "https://mainnet.base.org",
    "https://base.llamarpc.com",
    "https://1rpc.io/base",
  ],
  arbitrum: [
    "https://arbitrum-one-rpc.publicnode.com",
    "https://arb1.arbitrum.io/rpc",
    "https://arbitrum.llamarpc.com",
    "https://1rpc.io/arb",
  ],
  optimism: [
    "https://optimism-rpc.publicnode.com",
    "https://mainnet.optimism.io",
    "https://optimism.llamarpc.com",
    "https://1rpc.io/op",
  ],
};

const VIEM_CHAINS = { ethereum: mainnet, base, arbitrum, optimism } as const;

const clients = new Map<ChainKey, PublicClient>();

export function getClient(chain: ChainKey): PublicClient {
  let client = clients.get(chain);
  if (!client) {
    client = createPublicClient({
      chain: VIEM_CHAINS[chain],
      transport: fallback(
        RPCS[chain].map((url) => http(url, { timeout: 5_000, retryCount: 1 })),
        { rank: false },
      ),
      batch: { multicall: { wait: 16 } },
    }) as PublicClient;
    clients.set(chain, client);
  }
  return client;
}

export const CHAINS: ChainKey[] = ["ethereum", "base", "arbitrum", "optimism"];

const historicalClients = new Map<ChainKey, PublicClient>();

/**
 * Separate client for GET /proof's historical (block-pinned) reads, used
 * instead of getClient(). Two differences from the live client, both driven
 * by a real measurement (see commit message): retryCount: 0 instead of 1
 * (a provider that can't serve a historical block almost never succeeds on
 * a bare retry — the failure is "state pruned," not transient, so retrying
 * just doubles the subrequest cost for no benefit), and only the first 2
 * RPC providers per chain instead of all 4 (archive depth is a property of
 * the provider, not random flakiness — if the first couple can't serve a
 * block, the rest usually can't either, so trying all 4 mostly just adds
 * worst-case cost without meaningfully improving the odds).
 *
 * Together these bound /proof's worst-case subrequest cost per read to 2
 * (vs. up to 8 with the live client's retryCount:1 × 4 providers), which
 * matters because a failing-everywhere-in-range read is a real observed
 * case, not just a theoretical one — this project's own testing hit exactly
 * that on Arbitrum. Live reads (/report, /check, /watch) are unaffected;
 * they keep the full retry/provider depth via getClient().
 */
export function getHistoricalClient(chain: ChainKey): PublicClient {
  let client = historicalClients.get(chain);
  if (!client) {
    client = createPublicClient({
      chain: VIEM_CHAINS[chain],
      transport: fallback(
        RPCS[chain].slice(0, 2).map((url) => http(url, { timeout: 5_000, retryCount: 0 })),
        { rank: false },
      ),
      batch: { multicall: { wait: 16 } },
    }) as PublicClient;
    historicalClients.set(chain, client);
  }
  return client;
}
