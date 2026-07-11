/**
 * ETH/USD spot per chain, read from the Aave oracle's WETH price (USD, 8 dec).
 * Used to convert Compound's ETH-denominated WETH-market feeds to USD.
 * Cached briefly so one /report doesn't fetch it per market.
 */

import type { Address } from "viem";
import { oracleAbi, resolveContracts } from "./aave";
import { getClient } from "./rpc";
import type { ChainKey } from "./types";

const WETH: Record<ChainKey, Address> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  base: "0x4200000000000000000000000000000000000006",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
};

const TTL_MS = 30_000;
const cache = new Map<ChainKey, { price: number; at: number }>();

export async function getEthUsdPrice(chain: ChainKey): Promise<number> {
  const hit = cache.get(chain);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.price;
  const client = getClient(chain);
  const { oracle } = await resolveContracts(chain, client);
  const [raw] = await client.readContract({
    address: oracle,
    abi: oracleAbi,
    functionName: "getAssetsPrices",
    args: [[WETH[chain]]],
  });
  const price = Number(raw) / 1e8;
  cache.set(chain, { price, at: Date.now() });
  return price;
}
