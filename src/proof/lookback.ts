/**
 * Determines how far back GET /proof can actually replay a wallet's history
 * on the free-tier RPCs this project uses. Free public RPC endpoints vary
 * in archive depth (some prune state after a few thousand blocks, some
 * serve full history) and that depth isn't advertised anywhere — so instead
 * of assuming a fixed lookback window, we PROBE it empirically per request
 * and report what was actually achieved, never a promised number that might
 * not hold. (Same "don't fake it" standard as the coverage matrix elsewhere
 * in this project — see friction-log FL-012/013 for the related eth_getLogs
 * range-limit finding this builds on.)
 *
 * Block headers (`eth_getBlockByNumber`) are cheap and typically retained
 * even by nodes that prune STATE — only `eth_call`-style reads (used to
 * price a wallet's position at a historical block) are actually gated by
 * archive depth. So block-time estimation (which only needs headers) is
 * treated as reliable; the archive-depth PROBE (which needs real state
 * reads) is what's tested empirically via binary search.
 */

import { getHistoricalClient } from "../engine/rpc";
import type { ChainKey } from "../engine/types";
import type { HfReader } from "./readers";
import type { Address } from "viem";

/** What we'd LIKE to replay, not a promise — probeLookback finds the real achievable number, which may be less. */
export const TARGET_LOOKBACK_DAYS = 30;

const BLOCK_TIME_SAMPLE_DEPTH = 100_000n;

/** Empirical seconds/block for this chain, measured from two real block headers rather than a hardcoded per-chain guess (block times drift over a chain's life — e.g. Arbitrum's has changed more than once). */
export async function estimateBlockTimeSec(chain: ChainKey): Promise<{ latest: { number: bigint; timestamp: bigint }; secPerBlock: number }> {
  const client = getHistoricalClient(chain);
  const latest = await client.getBlock();
  const sampleNumber = latest.number > BLOCK_TIME_SAMPLE_DEPTH ? latest.number - BLOCK_TIME_SAMPLE_DEPTH : 0n;
  const sample = await client.getBlock({ blockNumber: sampleNumber });
  const blocks = Number(latest.number - sample.number);
  const seconds = Number(latest.timestamp - sample.timestamp);
  const secPerBlock = blocks > 0 ? seconds / blocks : 12;
  return { latest: { number: latest.number, timestamp: latest.timestamp }, secPerBlock };
}

export interface LookbackResult {
  requestedDays: number;
  achievedDays: number;
  achievedBlock: bigint;
  achievedTimestamp: string;
  toBlock: bigint;
  toTimestamp: string;
  secPerBlock: number;
  probeCallsUsed: number;
}

async function canReadAt(read: HfReader, chain: ChainKey, wallet: Address, blockNumber: bigint): Promise<boolean> {
  try {
    await read(chain, wallet, blockNumber);
    return true;
  } catch {
    return false;
  }
}

/**
 * Binary search over DAYS back (not raw block numbers — chains like
 * Arbitrum have block counts in the tens of millions, so searching block
 * numbers directly could take dozens of probes; days back is bounded by
 * TARGET_LOOKBACK_DAYS, so this never needs more than ~log2(30) ≈ 5-6
 * probe reads regardless of chain).
 */
export async function probeLookback(read: HfReader, chain: ChainKey, wallet: Address): Promise<LookbackResult> {
  const { latest, secPerBlock } = await estimateBlockTimeSec(chain);
  const blocksPerDay = BigInt(Math.max(1, Math.round(86_400 / secPerBlock)));
  const blockForDaysAgo = (daysAgo: number): bigint => {
    const back = blocksPerDay * BigInt(daysAgo);
    return back < latest.number ? latest.number - back : 0n;
  };

  let probeCallsUsed = 0;
  const targetBlock = blockForDaysAgo(TARGET_LOOKBACK_DAYS);
  probeCallsUsed++;
  const targetOk = await canReadAt(read, chain, wallet, targetBlock);

  let achievedDays: number;
  if (targetOk) {
    achievedDays = TARGET_LOOKBACK_DAYS;
  } else {
    let lo = 0;
    let hi = TARGET_LOOKBACK_DAYS;
    while (hi - lo > 1) {
      const mid = Math.floor((lo + hi) / 2);
      probeCallsUsed++;
      const ok = await canReadAt(read, chain, wallet, blockForDaysAgo(mid));
      if (ok) lo = mid;
      else hi = mid;
    }
    achievedDays = lo;
  }

  const achievedBlock = blockForDaysAgo(achievedDays);
  const client = getHistoricalClient(chain);
  const achievedBlockData = achievedDays === 0 ? latest : await client.getBlock({ blockNumber: achievedBlock });

  return {
    requestedDays: TARGET_LOOKBACK_DAYS,
    achievedDays,
    achievedBlock,
    achievedTimestamp: new Date(Number(achievedBlockData.timestamp) * 1000).toISOString(),
    toBlock: latest.number,
    toTimestamp: new Date(Number(latest.timestamp) * 1000).toISOString(),
    secPerBlock,
    probeCallsUsed,
  };
}
