/**
 * Orchestrator: scan one wallet across chains and protocols in parallel.
 * A protocol failing on one chain degrades that slice (recorded in errors),
 * never the whole scan — partial data beats a 500.
 */

import type { Address } from "viem";
import { readAave } from "./aave";
import { readCompound } from "./compound";
import { CHAINS } from "./rpc";
import type { ChainKey, ChainScan, Protocol, ProtocolPosition } from "./types";

const AAVE_CHAINS: ChainKey[] = ["ethereum", "base", "arbitrum"];
const COMPOUND_CHAINS: ChainKey[] = ["base", "arbitrum"];

async function slice(
  protocol: Protocol,
  chain: ChainKey,
  user: Address,
): Promise<{ positions: ProtocolPosition[]; error?: string }> {
  try {
    if (protocol === "aave-v3") {
      const p = await readAave(chain, user);
      return { positions: p ? [p] : [] };
    }
    return { positions: await readCompound(chain, user) };
  } catch (e) {
    return { positions: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function scanWallet(user: Address, chains: ChainKey[] = CHAINS): Promise<ChainScan[]> {
  return Promise.all(
    chains.map(async (chain) => {
      const jobs: { protocol: Protocol; run: Promise<{ positions: ProtocolPosition[]; error?: string }> }[] = [];
      if (AAVE_CHAINS.includes(chain)) jobs.push({ protocol: "aave-v3", run: slice("aave-v3", chain, user) });
      if (COMPOUND_CHAINS.includes(chain)) jobs.push({ protocol: "compound-v3", run: slice("compound-v3", chain, user) });

      const results = await Promise.all(jobs.map((j) => j.run));
      return {
        chain,
        positions: results.flatMap((r) => r.positions),
        errors: results.flatMap((r, i) => (r.error ? [{ protocol: jobs[i].protocol, error: r.error }] : [])),
      };
    }),
  );
}
