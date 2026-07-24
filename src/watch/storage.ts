/**
 * KV storage for Watch Mode, using a shard-blob layout instead of one KV key
 * per subscription. Why: Cloudflare's free KV tier caps writes at 1000/day
 * for the whole account, not per key. A naive one-key-per-subscription design
 * means every cron tick rewrites N keys for N subscriptions — at a 15-min
 * cadence (96 ticks/day) that caps out around 40 subscribers (40*96≈3840
 * writes, 4x over budget on day one). Grouping ~8 subscriptions into one JSON
 * array per shard key means a tick costs 1 write per SHARD, not per
 * subscriber — see cron.ts for how the per-tick shard budget is spent as
 * subscriber count (and therefore shard count) grows.
 *
 * Keys:
 *   watch:meta            -> { shardCount, subCount }
 *   watch:shard:{n}        -> WatchSubscription[]   (n in [0, shardCount))
 *   watch:index:{id}       -> "{n}"                  (which shard holds id)
 *
 * The index key exists only to make GET /watch/:id/status O(1) instead of an
 * O(shardCount) scan; it's written once at signup (not touched by cron
 * ticks), so it doesn't compete with the cron's write budget.
 */

import { TARGET_SUBS_PER_SHARD } from "./pricing";
import type { WatchSubscription } from "./types";

const META_KEY = "watch:meta";
const shardKey = (n: number) => `watch:shard:${n}`;
const indexKey = (id: string) => `watch:index:${id}`;

export interface Meta {
  shardCount: number;
  subCount: number;
}

async function getMeta(kv: KVNamespace): Promise<Meta> {
  const raw = await kv.get(META_KEY, "json");
  return (raw as Meta | null) ?? { shardCount: 1, subCount: 0 };
}

async function getShard(kv: KVNamespace, n: number): Promise<WatchSubscription[]> {
  const raw = await kv.get(shardKey(n), "json");
  return (raw as WatchSubscription[] | null) ?? [];
}

export async function saveShard(kv: KVNamespace, n: number, subs: WatchSubscription[]): Promise<void> {
  await kv.put(shardKey(n), JSON.stringify(subs));
}

export async function readShard(kv: KVNamespace, n: number): Promise<WatchSubscription[]> {
  return getShard(kv, n);
}

/**
 * Create a subscription and place it in a shard. Sharding heuristic:
 * shardCount = ceil(subCount / TARGET_SUBS_PER_SHARD), recomputed on every
 * signup; the new sub goes to shard (subCount % shardCount) — a simple
 * round-robin over the CURRENT shard count. This is intentionally not a
 * consistent-hashing scheme, and existing subscriptions are never moved once
 * placed: a new shard, once it becomes eligible, starts empty and fills
 * gradually from subsequent signups rather than getting an immediate
 * rebalanced share (observed directly in testing: 17 signups against
 * TARGET_SUBS_PER_SHARD=8 produced shards of 9/8/0, not three even shards —
 * the third shard had simply not received any signups yet). Harmless for
 * correctness (an emptier shard just means a slightly cheaper cron tick, a
 * fuller one a slightly more expensive one, both still within
 * PER_TICK_SHARD_BUDGET's margin — see budget.ts) and self-corrects as
 * signups continue. Building a true rebalancer for a scale this project
 * doesn't have yet would be solving a problem we don't have.
 */
export async function createSubscription(kv: KVNamespace, sub: WatchSubscription): Promise<{ shard: number }> {
  const meta = await getMeta(kv);
  const newSubCount = meta.subCount + 1;
  const newShardCount = Math.max(1, Math.ceil(newSubCount / TARGET_SUBS_PER_SHARD));
  const shard = meta.subCount % newShardCount;

  const existing = await getShard(kv, shard);
  existing.push(sub);
  await saveShard(kv, shard, existing);
  await kv.put(indexKey(sub.id), String(shard));
  await kv.put(META_KEY, JSON.stringify({ shardCount: newShardCount, subCount: newSubCount } satisfies Meta));

  return { shard };
}

export async function findSubscription(kv: KVNamespace, id: string): Promise<WatchSubscription | null> {
  const shardStr = await kv.get(indexKey(id));
  if (shardStr === null) return null;
  const shard = await getShard(kv, Number(shardStr));
  return shard.find((s) => s.id === id) ?? null;
}

/** Best-effort bookkeeping decrement when a cron pass purges an expired subscription. Not load-bearing for correctness — sharding just gets slightly more conservative if this drifts. */
export async function decrementSubCount(kv: KVNamespace, by: number): Promise<void> {
  if (by <= 0) return;
  const meta = await getMeta(kv);
  const subCount = Math.max(0, meta.subCount - by);
  await kv.put(META_KEY, JSON.stringify({ shardCount: meta.shardCount, subCount } satisfies Meta));
}

export { getMeta };
