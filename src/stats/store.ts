/**
 * Minimal call counter for GET /stats — landing-page infrastructure (the
 * "agents calling now" widget), not a new feature to gold-plate. One KV
 * key, read-modify-write per call. Call volume here is far lower than
 * Watch Mode's cron sweep (watch/storage.ts), so no shard-blob design is
 * needed — see that file for when/why sharding actually matters.
 *
 * Known, accepted limitation: KV has no atomic increment, so two requests
 * racing the same read-modify-write could under-count by a call or two
 * under real concurrent load. Not worth a Durable Object for a landing-page
 * counter — this is a deliberately small, approximate number, not a
 * billing-grade one.
 */

const STATS_KEY = "stats:counts";

export type CallClass = "self" | "external" | "unclassified";

export interface StatsCounts {
  total_calls: number;
  self_calls: number;
  external_calls: number;
  unclassified_calls: number;
  since: string;
}

function empty(): StatsCounts {
  return { total_calls: 0, self_calls: 0, external_calls: 0, unclassified_calls: 0, since: new Date().toISOString() };
}

export async function recordCall(kv: KVNamespace, cls: CallClass): Promise<void> {
  const raw = await kv.get(STATS_KEY, "json");
  const counts: StatsCounts = (raw as StatsCounts | null) ?? empty();
  counts.total_calls++;
  if (cls === "self") counts.self_calls++;
  else if (cls === "external") counts.external_calls++;
  else counts.unclassified_calls++;
  await kv.put(STATS_KEY, JSON.stringify(counts));
}

export async function readStats(kv: KVNamespace): Promise<StatsCounts> {
  const raw = await kv.get(STATS_KEY, "json");
  return (raw as StatsCounts | null) ?? empty();
}
