/**
 * Portfolio-level risk score: a single 0-100 number (+ label) summarizing a
 * wallet's entire cross-protocol, cross-chain exposure. Designed to survive
 * "how did you get 72?" — every constant here is either reused from the
 * existing risk-tier ladder (risk.ts's tierFor breakpoints) or documented
 * inline with its rationale. No magic numbers without a comment.
 *
 * Formula (two factors, base dominates):
 *
 *   1. Base score = piecewise-linear interpolation of the WORST health
 *      factor across all positions, anchored at the exact HF breakpoints
 *      already used for risk tiers (tierFor in risk.ts) — so a score of 55
 *      means "right at the safe/watch boundary," not an arbitrary number.
 *
 *   2. Concentration adjustment = up to a 15-point reduction, scaled by the
 *      Herfindahl-Hirschman Index (HHI) of collateral value across unique
 *      asset symbols (aggregated across every chain/protocol). HHI is the
 *      standard economics measure of concentration: sum of each asset's
 *      market-share-squared, ranging from ~0 (many equal-sized holdings) to
 *      1.0 (single asset). A wallet whose collateral is 100% one asset has
 *      no diversification cushion — if that asset's price move is exactly
 *      what triggers liquidation, there's nothing else absorbing the shock.
 *      HF is still the dominant term (it's the actual liquidation trigger);
 *      concentration is a secondary tilt, capped at 15 points so it can
 *      never flip a score's label on its own.
 *
 * final_score = round(base_score * (1 - CONCENTRATION_WEIGHT * HHI))
 */

import type { NormalizedPosition, Protocol, ChainKey } from "../engine/types";

/** Same breakpoints as risk.ts's tierFor — score anchors are not independent numbers. */
const HF_SCORE_ANCHORS: { hf: number; score: number }[] = [
  { hf: 1.0, score: 10 }, // "critical" floor — below this the position is at/past liquidatable (score 0)
  { hf: 1.05, score: 30 }, // "danger" threshold
  { hf: 1.15, score: 55 }, // "watch" threshold
  { hf: 1.5, score: 80 }, // "safe" threshold
  { hf: 3.0, score: 100 }, // comfortably safe — treated as maxed out
];

const CONCENTRATION_WEIGHT = 0.15; // max 15-point reduction for a fully single-asset portfolio

export type PortfolioScoreLabel = "healthy" | "moderate" | "at_risk" | "critical";

export interface RiskiestExposure {
  chain: ChainKey;
  protocol: Protocol;
  asset: string;
  health_factor: number;
}

export type PortfolioScore =
  | { score: number; label: PortfolioScoreLabel; riskiest_exposure: RiskiestExposure }
  | { score: null; label: "no_active_positions"; riskiest_exposure: null };

function baseScoreForHf(hf: number): number {
  if (hf === Infinity) return 100;
  if (hf < HF_SCORE_ANCHORS[0].hf) return 0; // liquidatable
  for (let i = 0; i < HF_SCORE_ANCHORS.length - 1; i++) {
    const a = HF_SCORE_ANCHORS[i];
    const b = HF_SCORE_ANCHORS[i + 1];
    if (hf >= a.hf && hf <= b.hf) {
      const t = (hf - a.hf) / (b.hf - a.hf);
      return a.score + t * (b.score - a.score);
    }
  }
  return 100; // hf > last anchor
}

function labelForScore(score: number): PortfolioScoreLabel {
  if (score >= 80) return "healthy"; // matches "safe" tier anchor
  if (score >= 55) return "moderate"; // matches "watch" tier anchor
  if (score >= 30) return "at_risk"; // matches "danger" tier anchor
  return "critical";
}

/** Herfindahl-Hirschman concentration index over collateral value, aggregated by asset symbol across every chain/protocol. */
function collateralConcentrationHhi(positions: NormalizedPosition[]): number {
  const bySymbol = new Map<string, number>();
  let total = 0;
  for (const p of positions) {
    for (const a of p.collateralAssets) {
      if (a.usdValue <= 0) continue;
      bySymbol.set(a.symbol, (bySymbol.get(a.symbol) ?? 0) + a.usdValue);
      total += a.usdValue;
    }
  }
  if (total <= 0) return 0;
  let hhi = 0;
  for (const usd of bySymbol.values()) {
    const share = usd / total;
    hhi += share * share;
  }
  return hhi;
}

export function computePortfolioScore(positions: NormalizedPosition[]): PortfolioScore {
  const withDebt = positions.filter((p) => p.debtUsd > 0);
  if (withDebt.length === 0) {
    return { score: null, label: "no_active_positions", riskiest_exposure: null };
  }

  const riskiest = withDebt.reduce((worst, p) => (p.healthFactor < worst.healthFactor ? p : worst));
  const baseScore = baseScoreForHf(riskiest.healthFactor);
  const hhi = collateralConcentrationHhi(positions);
  const score = Math.max(0, Math.min(100, Math.round(baseScore * (1 - CONCENTRATION_WEIGHT * hhi))));

  return {
    score,
    label: labelForScore(score),
    riskiest_exposure: {
      chain: riskiest.chain,
      protocol: riskiest.protocol,
      asset: riskiest.dominantCollateral?.symbol ?? riskiest.debtAssets[0]?.symbol ?? "unknown",
      health_factor: riskiest.healthFactor,
    },
  };
}

