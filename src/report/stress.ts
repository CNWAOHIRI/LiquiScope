/**
 * ?stress_pct scenario — "what if collateral prices moved by X%?"
 *
 * Applies uniformly to every COLLATERAL asset's price in the wallet; debt
 * asset prices are held constant. Documented limitation: for a position
 * whose debt is itself a volatile, collateral-correlated asset (e.g. WETH
 * debt against wstETH collateral — a real pattern we've seen live), a "market
 * crash" in reality would move both together and largely cancel out in HF
 * terms; this v1 stress test only moves the collateral side, so it OVERSTATES
 * the HF impact for such positions. Chosen deliberately over the alternative
 * (stress only the dominant collateral asset) because it has an exact,
 * provable closed form — see the derivation below — rather than requiring
 * per-leg data this contract doesn't expose.
 *
 * Exact derivation (not an approximation, not a separate code path):
 *   healthFactor = weightedCollateralUsd / debtUsd                (by definition)
 *   weightedCollateralUsd = sum_i(collateral_i_usd * LT_i)
 *                         = sum_i(amount_i * price_i * LT_i)
 * If every collateral price_i scales by a common factor f = 1 + stress_pct/100
 * (debt unchanged), weightedCollateralUsd scales by exactly f too, because
 * it's a linear (weighted-sum) function of the price_i terms:
 *   weightedCollateralUsd_stressed = f * weightedCollateralUsd_real
 *   => HF_stressed = f * HF_real
 * This holds identically for Aave's on-chain HF and Compound's composed
 * equivalent (both are the same weighted-sum-over-debt form — see
 * engine/adapters/*) — so scaling the already-computed HF by f is
 * mathematically the same as recomputing from stressed raw inputs, not a
 * shortcut that could diverge from the real /report math.
 *
 * portfolio_score's concentration term is scale-invariant under a uniform
 * stress (every asset's share of the total is unchanged when all of them
 * move by the same factor), so it's computed from the same collateralAssets
 * data — no separate concentration math for the stressed case either.
 */

import { round, tierFor } from "../engine/risk";
import type { NormalizedPosition } from "../engine/types";
import { computePortfolioScore, type PortfolioScore } from "./portfolioScore";
import { computeRecommendations, TARGET_COMFORTABLE_HF, type PositionRecommendation } from "./recommendations";

export interface StressedPositionView {
  chain: NormalizedPosition["chain"];
  protocol: NormalizedPosition["protocol"];
  market: string;
  health_factor: number | null;
  tier: NormalizedPosition["tier"];
}

export interface StressScenario {
  stress_pct: number;
  applied_to: string;
  positions: StressedPositionView[];
  portfolio_score: PortfolioScore;
  recommendations: PositionRecommendation[];
}

/** stress_pct must be > -100 (a price can't drop 100% or more) and is clamped to a sane range to reject nonsensical input. */
export function parseStressPct(raw: string | null): { value: number } | { error: string } {
  if (raw === null) return { value: 0 };
  const n = Number(raw);
  if (!Number.isFinite(n)) return { error: `invalid stress_pct '${raw}' — expected a number, e.g. -20` };
  if (n <= -100) return { error: "stress_pct must be greater than -100 (a price cannot drop 100% or more)" };
  if (n > 1000) return { error: "stress_pct must be at most 1000 (a 10x price move) — use a smaller value" };
  return { value: n };
}

export function computeStressScenario(positions: NormalizedPosition[], stressPct: number): StressScenario {
  const factor = 1 + stressPct / 100;

  const stressedPositions: NormalizedPosition[] = positions.map((p) => {
    if (p.debtUsd <= 0 || p.healthFactor === Infinity) return p; // nothing to stress on a debt-free position
    const stressedHf = round(p.healthFactor * factor, 4);
    return { ...p, healthFactor: stressedHf, tier: tierFor(stressedHf) };
  });

  const positionsView: StressedPositionView[] = stressedPositions.map((p) => ({
    chain: p.chain,
    protocol: p.protocol,
    market: p.market,
    health_factor: p.healthFactor === Infinity ? null : p.healthFactor,
    tier: p.tier,
  }));

  return {
    stress_pct: stressPct,
    applied_to: "all collateral asset prices, uniformly; debt asset prices held constant (see code comments for the exact rationale and limitation)",
    positions: positionsView,
    portfolio_score: computePortfolioScore(stressedPositions),
    recommendations: computeRecommendations(positions, TARGET_COMFORTABLE_HF, factor),
  };
}
