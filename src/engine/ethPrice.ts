/**
 * ETH/USD spot per chain, read from the Aave oracle's WETH price (USD, 8 dec).
 * Shared price utility: the Compound adapter uses this to convert ETH-
 * denominated Comet feeds to USD. This is price-data reuse only — Compound's
 * risk logic never depends on Aave's risk logic.
 * Cached briefly so one /report doesn't fetch it per market.
 */

import type { Address } from "viem";
import { oracleAbi, resolveContracts } from "./adapters/aaveV3";
import { getClient } from "./rpc";
import type { ChainKey } from "./types";

// WETH predeploy is the same address (0x4200…0006) on every OP-stack chain
// (Base, Optimism); Ethereum and Arbitrum use their canonical WETH9 deployments.
const WETH: Record<ChainKey, Address> = {
  ethereum: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
  base: "0x4200000000000000000000000000000000000006",
  arbitrum: "0x82aF49447D8a07e3bd95BD0d56f35241523fBab1",
  optimism: "0x4200000000000000000000000000000000000006",
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
