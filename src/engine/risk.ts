/**
 * Risk math shared by both protocol readers.
 *
 * Tier ladder (health factor):
 *   >= 1.5   safe
 *   >= 1.15  watch
 *   >= 1.05  danger
 *   >= 1.0   critical
 *   <  1.0   liquidatable (eligible for liquidation right now)
 */

import type { DominantCollateral, RiskTier } from "./types";

export function tierFor(healthFactor: number): RiskTier {
  if (healthFactor >= 1.5) return "safe";
  if (healthFactor >= 1.15) return "watch";
  if (healthFactor >= 1.05) return "danger";
  if (healthFactor >= 1.0) return "critical";
  return "liquidatable";
}

export interface CollateralLeg {
  symbol: string;
  usdValue: number;
  priceUsd: number;
  /** Liquidation threshold / liquidate collateral factor as a fraction (0..1). */
  liquidationThreshold: number;
}

/**
 * Price of the dominant (largest-USD) collateral asset at which the position
 * crosses HF = 1, holding all other prices and balances constant.
 *
 * HF = sum_i(coll_i * LT_i) / debt. Solving for the dominant leg d:
 *   coll_d' = (debt - sum_{i != d} coll_i * LT_i) / LT_d
 *   price_d' = price_d * coll_d' / coll_d
 *
 * Returns undefined when there is no debt, no meaningful dominant leg, or the
 * other legs alone already cover the debt (that asset's price alone can't
 * trigger liquidation — drop reported as 1, i.e. only a 100% collapse would).
 */
export function dominantLiquidationPrice(
  legs: CollateralLeg[],
  totalDebtUsd: number,
): DominantCollateral | undefined {
  if (totalDebtUsd <= 0 || legs.length === 0) return undefined;
  const dominant = legs.reduce((a, b) => (b.usdValue > a.usdValue ? b : a));
  if (dominant.usdValue <= 0 || dominant.liquidationThreshold <= 0 || dominant.priceUsd <= 0) return undefined;

  const othersWeighted = legs
    .filter((l) => l !== dominant)
    .reduce((sum, l) => sum + l.usdValue * l.liquidationThreshold, 0);

  const requiredUsd = (totalDebtUsd - othersWeighted) / dominant.liquidationThreshold;
  const liqPrice = dominant.priceUsd * (requiredUsd / dominant.usdValue);
  const clamped = Math.max(0, Math.min(liqPrice, dominant.priceUsd));

  return {
    symbol: dominant.symbol,
    currentPriceUsd: dominant.priceUsd,
    liquidationPriceUsd: round(clamped, 6),
    dropToLiquidationPct: round(1 - clamped / dominant.priceUsd, 4),
    liquidationThreshold: dominant.liquidationThreshold,
  };
}

/** Positions below this total value are dust — reported in a count, not analyzed. */
export const DUST_USD = 1;

export function round(n: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}
