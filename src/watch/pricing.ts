/**
 * Watch Mode pricing and shard-sizing constants — approved 2026-07-17:
 * $0.02/day, 3-day minimum, 8 subscriptions/shard target, 15-min cron tick.
 * Cheap enough that people actually try it; cleanly representable in
 * USDT0's 6 decimals ($0.02 = 20000 atomic units, no rounding); consistent
 * with the low-friction pricing philosophy already established for /report.
 */

export const PRICE_PER_DAY_ATOMIC = 20_000n; // $0.02 in 6-decimal USDT0 units
export const MIN_DURATION_DAYS = 3;
/** Upper bound purely to keep individual subscriptions and their KV footprint bounded — not a pricing decision, a sanity bound on input. */
export const MAX_DURATION_DAYS = 90;

/** Same 8-subscriptions/shard target approved alongside the pricing — see storage.ts for how shard count derives from it. */
export const TARGET_SUBS_PER_SHARD = 8;

export function computeWatchPriceAtomic(durationDays: number): string {
  return (PRICE_PER_DAY_ATOMIC * BigInt(durationDays)).toString();
}

export function watchDescription(durationDays: number): string {
  return `LiquiScope Watch Mode — health-factor alert subscription, ${durationDays} day${durationDays === 1 ? "" : "s"}`;
}
