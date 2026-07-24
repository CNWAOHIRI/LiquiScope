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
