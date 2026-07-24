/**
 * Samples a wallet's health-factor trajectory across the achieved lookback
 * window (see lookback.ts) and detects historical liquidation-eligible
 * crossings (HF < 1.0 — the same "liquidatable" tier boundary risk.ts uses
 * live, not a separate historical threshold). Reuses the exact adapter code
 * path /report and /watch use, just pinned to past blocks — never a
 * separate/approximate historical model.
 *
 * Discrete sampling is a real, documented limitation: with TRAJECTORY_SAMPLES
 * evenly-spaced points, a brief dip between two samples can be missed by
 * construction. Denser sampling would cost more RPC subrequests than the
 * free Workers tier's 50/invocation budget comfortably allows alongside the
 * archive-depth probe itself — see index.ts's /proof handler for the actual
 * budget arithmetic.
 */

import type { Address } from "viem";
import { getHistoricalClient } from "../engine/rpc";
import type { HfReader } from "./readers";
import type { ChainKey, RiskTier } from "../engine/types";
import { tierFor } from "../engine/risk";
import type { LookbackResult } from "./lookback";

/**
 * 6, not the originally-planned 10 — lowered after measuring real worst-case
 * subrequest cost (see rpc.ts's getHistoricalClient and the commit message):
 * even with the lean HF-only reader, a sample that fails on every provider
 * still costs one fetch attempt per provider, and this project's own testing
 * hit exactly that case (6 of 10 in-range Arbitrum samples failed in one
 * real run). 6 samples keeps the worst case comfortably under the free
 * Workers plan's 50-subrequest/invocation ceiling alongside the lookback
 * probe; see index.ts's /proof handler for the full budget arithmetic.
 */
export const TRAJECTORY_SAMPLES = 6;
const INCIDENT_HF_THRESHOLD = 1.0; // "liquidatable" tier boundary — the same number tierFor() uses, not a separate historical cutoff

export interface MarketReading {
  market: string;
  health_factor: number | null; // null = no open position in this market at this sample
  tier: RiskTier | null;
}

export interface TrajectoryPoint {
  days_ago: number;
  block: string;
  timestamp: string;
  readable: boolean; // false if even this in-range sample failed to read (transient RPC issue, not an archive-depth failure — those were already filtered out by probeLookback)
  markets: MarketReading[];
}

export interface Incident {
  market: string;
  first_crossing_days_ago: number;
  first_crossing_timestamp: string;
  lowest_health_factor: number;
  lowest_at_timestamp: string;
  recovered_by_latest_sample: boolean;
}

export interface ReplayResult {
  trajectory: TrajectoryPoint[];
  incidents: Incident[];
  failedSamples: number;
}

function daysAgoOffsets(achievedDays: number): number[] {
  if (achievedDays === 0) return [0];
  const raw = Array.from({ length: TRAJECTORY_SAMPLES }, (_, i) => Math.round((i / (TRAJECTORY_SAMPLES - 1)) * achievedDays));
  return [...new Set(raw)].sort((a, b) => b - a); // oldest first — chronological order
}

export async function replayTrajectory(
  read: HfReader,
  chain: ChainKey,
  wallet: Address,
  lookback: LookbackResult,
): Promise<ReplayResult> {
  const client = getHistoricalClient(chain);
  const blocksPerDay = BigInt(Math.max(1, Math.round(86_400 / lookback.secPerBlock)));
  const blockForDaysAgo = (daysAgo: number): bigint => {
    const back = blocksPerDay * BigInt(daysAgo);
    return back < lookback.toBlock ? lookback.toBlock - back : 0n;
  };

  const offsets = daysAgoOffsets(lookback.achievedDays);

  const points = await Promise.all(
    offsets.map(async (daysAgo): Promise<TrajectoryPoint> => {
      const blockNumber = daysAgo === 0 ? lookback.toBlock : blockForDaysAgo(daysAgo);
      try {
        const [block, readings] = await Promise.all([
          daysAgo === 0
            ? Promise.resolve({ timestamp: BigInt(Math.floor(new Date(lookback.toTimestamp).getTime() / 1000)) })
            : client.getBlock({ blockNumber }),
          read(chain, wallet, blockNumber),
        ]);
        return {
          days_ago: daysAgo,
          block: blockNumber.toString(),
          timestamp: new Date(Number(block.timestamp) * 1000).toISOString(),
          readable: true,
          markets: readings.map((r) => ({ market: r.market, health_factor: r.healthFactor === Infinity ? null : r.healthFactor, tier: r.healthFactor === Infinity ? null : tierFor(r.healthFactor) })),
        };
      } catch {
        return { days_ago: daysAgo, block: blockNumber.toString(), timestamp: "", readable: false, markets: [] };
      }
    }),
  );

  // Chronological order (oldest -> newest) for incident detection.
  points.sort((a, b) => b.days_ago - a.days_ago);

  const incidents: Incident[] = [];
  const openIncidentByMarket = new Map<string, Incident>();

  for (const point of points) {
    if (!point.readable) continue;
    const seenMarkets = new Set(point.markets.map((m) => m.market));

    for (const m of point.markets) {
      const below = m.health_factor !== null && m.health_factor < INCIDENT_HF_THRESHOLD;
      const open = openIncidentByMarket.get(m.market);
      if (below) {
        if (!open) {
          const incident: Incident = {
            market: m.market,
            first_crossing_days_ago: point.days_ago,
            first_crossing_timestamp: point.timestamp,
            lowest_health_factor: m.health_factor as number,
            lowest_at_timestamp: point.timestamp,
            recovered_by_latest_sample: false,
          };
          incidents.push(incident);
          openIncidentByMarket.set(m.market, incident);
        } else if ((m.health_factor as number) < open.lowest_health_factor) {
          open.lowest_health_factor = m.health_factor as number;
          open.lowest_at_timestamp = point.timestamp;
        }
      } else if (open) {
        open.recovered_by_latest_sample = true;
        openIncidentByMarket.delete(m.market);
      }
    }

    // A market that had an open incident but no longer appears in this sample
    // (position fully closed) counts as recovered — nothing left to liquidate.
    for (const [market, incident] of openIncidentByMarket) {
      if (!seenMarkets.has(market)) {
        incident.recovered_by_latest_sample = true;
        openIncidentByMarket.delete(market);
      }
    }
  }

  return {
    trajectory: points,
    incidents,
    failedSamples: points.filter((p) => !p.readable).length,
  };
}
