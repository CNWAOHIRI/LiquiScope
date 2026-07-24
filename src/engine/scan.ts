/**
 * Orchestrator: scan one wallet across every adapter × chain in parallel.
 * "One brain, many protocols" — this file knows nothing about Aave or
 * Compound specifically; it only knows the ProtocolAdapter interface. Adding
 * a new protocol means adding one adapter to ADAPTERS below.
 *
 * Reliability contract: one adapter×chain slice failing or timing out never
 * fails the whole scan — it's recorded in `errors` and every other slice's
 * result is still returned. Partial data beats a 500, always.
 */

import type { Address } from "viem";
import { AaveV3Adapter } from "./adapters/aaveV3";
import { CompoundV3Adapter } from "./adapters/compoundV3";
import type { ProtocolAdapter } from "./adapters/types";
import { CHAINS } from "./rpc";
import { round } from "./risk";
import type { ChainKey, ChainScan, CoverageEntry, NormalizedPosition, PortfolioSummary, Protocol } from "./types";

/** The adapter registry — the only place that lists which protocols exist. */
export const ADAPTERS: ProtocolAdapter[] = [AaveV3Adapter, CompoundV3Adapter];

/**
 * Sources whose reads succeed and are computed by the exact same formula as
 * every other source, but have never been checked against a real live
 * position — no fixture wallet was found despite genuine effort (free-RPC
 * eth_getLogs limits made discovery impractical; see friction-log FL-012/013).
 *
 * Effect: coverageMatrix reports "beta" instead of "ok" for these, and every
 * position returned from them is stamped `provisional: true` — so a live
 * paid report never silently presents an unconfirmed number as equivalent to
 * a battle-tested one.
 *
 * To promote: once a real position is found and its numbers hand-verified
 * against the source contracts, remove the entry here.
 */
const PROVISIONAL_SOURCES: { protocol: Protocol; chain: ChainKey }[] = [{ protocol: "compound-v3", chain: "ethereum" }];

function isProvisional(protocol: Protocol, chain: ChainKey): boolean {
  return PROVISIONAL_SOURCES.some((s) => s.protocol === protocol && s.chain === chain);
}

/** Per-source wall-clock budget. One hung chain/protocol must not stall the others (they run in parallel) or the whole request (this caps it). */
const SOURCE_TIMEOUT_MS = 12_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}

async function slice(
  adapter: ProtocolAdapter,
  chain: ChainKey,
  user: Address,
): Promise<{ positions: NormalizedPosition[]; error?: string }> {
  try {
    const positions = await withTimeout(
      adapter.getPositions(chain, user),
      SOURCE_TIMEOUT_MS,
      `${adapter.protocol}/${chain}`,
    );
    if (isProvisional(adapter.protocol, chain)) {
      for (const p of positions) p.provisional = true;
    }
    return { positions };
  } catch (e) {
    return { positions: [], error: e instanceof Error ? e.message : String(e) };
  }
}

export async function scanWallet(user: Address, chains: ChainKey[] = CHAINS): Promise<ChainScan[]> {
  return Promise.all(
    chains.map(async (chain) => {
      const jobs = ADAPTERS.filter((a) => a.supportedChains.includes(chain)).map((adapter) => ({
        protocol: adapter.protocol,
        run: slice(adapter, chain, user),
      }));

      const results = await Promise.all(jobs.map((j) => j.run));
      return {
        chain,
        positions: results.flatMap((r) => r.positions),
        errors: results.flatMap((r, i) => (r.error ? [{ protocol: jobs[i].protocol, error: r.error }] : [])),
      };
    }),
  );
}

/** Portfolio-level rollup across every chain/protocol scanned — the cross-protocol view. */
export function aggregatePortfolio(scans: ChainScan[]): PortfolioSummary {
  const positions = scans.flatMap((s) => s.positions);
  const withDebt = positions.filter((p) => p.debtUsd > 0);

  const totalCollateralUsd = round(positions.reduce((s, p) => s + p.collateralUsd, 0), 2);
  const totalDebtUsd = round(positions.reduce((s, p) => s + p.debtUsd, 0), 2);

  const riskiestPosition =
    withDebt.length === 0
      ? null
      : withDebt.reduce((worst, p) => (p.healthFactor < worst.healthFactor ? p : worst));

  return {
    totalCollateralUsd,
    totalDebtUsd,
    overallTier: riskiestPosition?.tier ?? "none",
    riskiestPosition,
    positionCount: positions.length,
  };
}

/** protocol × chain coverage matrix — what was actually scanned, what errored, what isn't supported at all. */
export function coverageMatrix(scans: ChainScan[], chains: ChainKey[] = CHAINS): CoverageEntry[] {
  const entries: CoverageEntry[] = [];
  for (const chain of chains) {
    const scan = scans.find((s) => s.chain === chain);
    for (const adapter of ADAPTERS) {
      const protocol: Protocol = adapter.protocol;
      if (!adapter.supportedChains.includes(chain)) {
        entries.push({ protocol, chain, status: "unsupported" });
        continue;
      }
      const err = scan?.errors.find((e) => e.protocol === protocol);
      if (err) {
        entries.push({ protocol, chain, status: "error", error: err.error });
      } else {
        entries.push({ protocol, chain, status: isProvisional(protocol, chain) ? "beta" : "ok" });
      }
    }
  }
  return entries;
}
