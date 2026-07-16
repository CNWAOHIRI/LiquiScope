/**
 * Adapter over LiquiScope's real (frozen) engine at ../../src/engine.
 *
 * This replaces the vendored engine this app carried when it lived in the
 * guardian-network repo. No engine code is duplicated or modified here — the
 * adapter maps ProtocolPosition/ChainScan into the Report shape the UI and
 * monitor were built around, and reuses the frozen report layer (LLM summary
 * with deterministic template fallback).
 *
 * Tier taxonomy: the app now uses the engine's real 5-tier ladder
 * (safe / watch / danger / critical / liquidatable — thresholds 1.5 / 1.15 /
 * 1.05 / 1.0), replacing the vendored 3-tier variant.
 */

import type { Address } from "viem";
import { scanWallet } from "../../../src/engine/scan";
import type { ChainKey, ChainScan, ProtocolPosition, RiskTier } from "../../../src/engine/types";
import { generateSummary } from "../../../src/report/summary";
import { worstTier } from "../../../src/report/template";

export type { RiskTier };

export interface DominantCollateral {
  symbol: string;
  currentPriceUsd: number;
  liquidationPriceUsd: number;
  /** Fraction, e.g. 0.12 = a 12% price drop reaches liquidation. */
  dropToLiquidation: number;
}

export interface Position {
  protocol: "Aave V3" | "Compound V3";
  chain: string;
  market?: string;
  healthFactor: number;
  tier: RiskTier;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  dominantCollateral: DominantCollateral;
}

export type ChainScanStatus =
  | { chain: string; protocol: string; status: "ok" }
  | { chain: string; protocol: string; status: "error"; message: string };

export interface Report {
  address: `0x${string}`;
  overallRiskTier: RiskTier | "none";
  summary: string;
  summarySource: "ai" | "template";
  positions: Position[];
  scan: {
    durationMs: number;
    chains: ChainScanStatus[];
  };
}

const CHAIN_LABEL: Record<ChainKey, string> = {
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
};

const PROTOCOL_LABEL = { "aave-v3": "Aave V3", "compound-v3": "Compound V3" } as const;

/** Same semantics as the vendored engine: only debt-bearing positions are reported. */
function toPosition(p: ProtocolPosition): Position | null {
  if (p.totalDebtUsd <= 0 || !p.dominantCollateral) return null;
  return {
    protocol: PROTOCOL_LABEL[p.protocol],
    chain: CHAIN_LABEL[p.chain],
    market: p.protocol === "compound-v3" ? p.market : undefined,
    healthFactor: p.healthFactor,
    tier: p.tier,
    totalCollateralUsd: p.totalCollateralUsd,
    totalDebtUsd: p.totalDebtUsd,
    dominantCollateral: p.dominantCollateral,
  };
}

function toChainStatus(scans: ChainScan[]): ChainScanStatus[] {
  const out: ChainScanStatus[] = [];
  for (const s of scans) {
    const protocols: ProtocolPosition["protocol"][] =
      s.chain === "ethereum" ? ["aave-v3"] : ["aave-v3", "compound-v3"];
    for (const proto of protocols) {
      const err = s.errors.find((e) => e.protocol === proto);
      out.push(
        err
          ? { chain: CHAIN_LABEL[s.chain], protocol: PROTOCOL_LABEL[proto], status: "error", message: err.error }
          : { chain: CHAIN_LABEL[s.chain], protocol: PROTOCOL_LABEL[proto], status: "ok" },
      );
    }
  }
  return out;
}

export async function analyzeWallet(address: Address): Promise<Report> {
  const start = Date.now();
  const scans = await scanWallet(address);

  const allPositions = scans.flatMap((s) => s.positions);
  const positions = allPositions
    .map(toPosition)
    .filter((p): p is Position => p !== null)
    .sort((a, b) => a.healthFactor - b.healthFactor);

  const { summary, source } = await generateSummary(scans, process.env.ANTHROPIC_API_KEY);

  return {
    address: address as `0x${string}`,
    overallRiskTier: worstTier(allPositions),
    summary,
    summarySource: source === "llm" ? "ai" : "template",
    positions,
    scan: {
      durationMs: Date.now() - start,
      chains: toChainStatus(scans),
    },
  };
}
