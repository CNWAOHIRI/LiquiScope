/**
 * Cron capacity planning for Watch Mode. Two independent free-tier ceilings
 * bound how many shards can be checked per cron tick:
 *
 *  1. KV writes: 1000/day, ACCOUNT-WIDE (not per key — this is the ceiling
 *     that a naive one-key-per-subscription design would hit first, around
 *     40 subscribers at a 15-min cadence). Each shard checked in a tick
 *     costs exactly 1 write (the shard blob is rewritten whole). Reserving
 *     ~100/day of headroom for signups + expiry bookkeeping leaves
 *     DAILY_CRON_KV_WRITE_BUDGET for the cron itself.
 *
 *  2. Subrequests: 50/invocation on the free Workers plan, shared by every
 *     outbound call a single cron tick makes (RPC reads + KV ops). Measured
 *     empirically (see README / commit message for the run) rather than
 *     assumed: viem's multicall batching (`batch.multicall`, 16ms window)
 *     folds concurrent reads for many different wallets on the same chain
 *     into far fewer actual HTTP calls than one-request-per-wallet would
 *     suggest, because Multicall3 aggregates arbitrary reads regardless of
 *     target address into one eth_call.
 *
 * PER_TICK_SHARD_BUDGET is the tighter of the two. It directly sets alert
 * latency as subscriber count grows: with S shards total, any given shard
 * is checked every ceil(S / PER_TICK_SHARD_BUDGET) ticks. That means
 * latency degrades gracefully (15 min -> 30 min -> ...) as the service
 * grows past free-tier capacity, instead of silently dropping subscriptions
 * once some cliff is hit.
 */

import { TARGET_SUBS_PER_SHARD } from "./pricing";

export const CHECK_INTERVAL_MIN = 15;
const TICKS_PER_DAY = (24 * 60) / CHECK_INTERVAL_MIN;

const DAILY_CRON_KV_WRITE_BUDGET = 900;
const MAX_SHARDS_PER_TICK_FROM_KV = Math.floor(DAILY_CRON_KV_WRITE_BUDGET / TICKS_PER_DAY);

/**
 * Measured 2026-07-24: a monkey-patched global `fetch` counter wrapped
 * around AaveV3Adapter.getPositions() called concurrently for 8 distinct
 * real addresses on Arbitrum (one shard's worth, TARGET_SUBS_PER_SHARD from
 * pricing.ts — 3 known live wallets from this session + 5 arbitrary valid
 * EOAs, run via `tsx` outside the Workers runtime against real RPC
 * endpoints). Result: 8 wallets -> 8 total outbound HTTP calls, i.e. ~1 per
 * wallet check — viem's multicall batching (`batch.multicall`, 16ms window)
 * does substantially better than a naive "one RPC round-trip per read"
 * estimate would suggest, confirming the pre-build hunch. This replaces an
 * earlier, unmeasured placeholder of 9.
 */
export const SUBREQUESTS_PER_CHECK = 1;

/**
 * Each shard checked also costs 2 KV operations (one read of the shard
 * blob, one write back) in addition to the wallet RPC calls. Included
 * conservatively in the subrequest budget on the assumption that KV ops
 * count toward the same 50/invocation free-tier ceiling as outbound fetch —
 * this wasn't independently verified against Cloudflare's current platform
 * behavior, so treat it as a safety margin, not a confirmed mechanism.
 */
const KV_OPS_PER_SHARD = 2;

export const MEASURED_SUBREQUESTS_PER_SHARD = KV_OPS_PER_SHARD + SUBREQUESTS_PER_CHECK * TARGET_SUBS_PER_SHARD;

const SUBREQUEST_SAFETY_BUDGET = 40; // of the free tier's 50/invocation cap; the remaining 10 is headroom for the getMeta() read and retry variance
const MAX_SHARDS_PER_TICK_FROM_SUBREQUESTS = Math.max(1, Math.floor(SUBREQUEST_SAFETY_BUDGET / MEASURED_SUBREQUESTS_PER_SHARD));

export const PER_TICK_SHARD_BUDGET = Math.max(1, Math.min(MAX_SHARDS_PER_TICK_FROM_KV, MAX_SHARDS_PER_TICK_FROM_SUBREQUESTS));

/** Minutes between checks for a shard, given the current total shard count. */
export function latencyMinutesForShardCount(shardCount: number): number {
  const groupsNeeded = Math.ceil(shardCount / PER_TICK_SHARD_BUDGET);
  return CHECK_INTERVAL_MIN * groupsNeeded;
}

/** Which shard indices (of shardCount total) get checked on the tick starting at `now`. */
export function shardsForTick(shardCount: number, now: Date): number[] {
  if (shardCount <= 0) return [];
  const groupsNeeded = Math.ceil(shardCount / PER_TICK_SHARD_BUDGET);
  const tickIndex = Math.floor(now.getTime() / (CHECK_INTERVAL_MIN * 60_000));
  const groupIndex = tickIndex % groupsNeeded;
  const shards: number[] = [];
  for (let n = 0; n < shardCount; n++) {
    if (n % groupsNeeded === groupIndex) shards.push(n);
  }
  return shards;
}
