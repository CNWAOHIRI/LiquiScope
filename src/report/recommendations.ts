/**
 * Actionable recommendations: for any position below a comfortable health
 * factor, compute the exact repay-debt and/or add-collateral amount needed
 * to reach TARGET_COMFORTABLE_HF. Reuses the same math the rest of the
 * engine already computes — no separate/approximate model.
 *
 * Key identity (exact, not an approximation): by definition
 *   healthFactor = weightedCollateralUsd / debtUsd
 * so weightedCollateralUsd = healthFactor * debtUsd — always recoverable
 * from the two fields every NormalizedPosition already carries, for either
 * protocol (Aave's on-chain HF or Compound's composed equivalent — the
 * identity holds by construction for both, see engine/adapters/*).
 *
 * Repay-debt (only needs healthFactor + debtUsd):
 *   Repaying repay_usd holds collateral fixed, so the new HF is
 *     target_hf = weightedCollateralUsd / (debtUsd - repay_usd)
 *   Solve for repay_usd:
 *     repay_usd = debtUsd * (1 - healthFactor / target_hf)
 *
 * Add-collateral (needs dominantCollateral.liquidationThreshold — the exact
 * fraction of that asset's value counted toward HF, not guessed):
 *   Adding add_usd of the dominant collateral asset increases
 *   weightedCollateralUsd by add_usd * liquidationThreshold. Solve for the
 *   shortfall between current and target weighted collateral:
 *     add_usd = debtUsd * (target_hf - healthFactor) / liquidationThreshold
 */

import type { ChainKey, NormalizedPosition, Protocol } from "../engine/types";
import { round } from "../engine/risk";

/** Matches risk.ts's "safe" tier threshold exactly — reusing the existing taxonomy, not inventing a new number. */
export const TARGET_COMFORTABLE_HF = 1.5;

export interface RecommendedAction {
  type: "repay_debt" | "add_collateral";
  asset: string;
  amount: number;
  amount_usd: number;
  resulting_health_factor: number;
}

export interface PositionRecommendation {
  chain: ChainKey;
  protocol: Protocol;
  market: string;
  current_health_factor: number;
  target_health_factor: number;
  actions: RecommendedAction[];
  assumptions: {
    price_source: string;
    note?: string;
  };
}

function buildRecommendation(
  p: NormalizedPosition,
  targetHf: number,
  /** Set only when called from a stress scenario — prices the add-collateral amount at the stressed price instead of today's. */
  collateralPriceUsdOverride?: number,
): PositionRecommendation {
  const actions: RecommendedAction[] = [];
  const notes: string[] = [];

  const primaryDebt =
    p.debtAssets.length > 0 ? p.debtAssets.reduce((a, b) => (b.usdValue > a.usdValue ? b : a)) : null;
  if (primaryDebt && primaryDebt.amount > 0) {
    const repayUsd = p.debtUsd * (1 - p.healthFactor / targetHf);
    if (repayUsd > 0) {
      const debtPriceUsd = primaryDebt.usdValue / primaryDebt.amount; // implied price from already-known fields, no new lookup
      actions.push({
        type: "repay_debt",
        asset: primaryDebt.symbol,
        amount: round(repayUsd / debtPriceUsd, 6),
        amount_usd: round(repayUsd, 2),
        resulting_health_factor: targetHf,
      });
      if (p.debtAssets.length > 1) {
        notes.push(`repay amount assumes repaying entirely in ${primaryDebt.symbol} (the largest of ${p.debtAssets.length} debt assets); the same USD amount can be split across debt positions instead`);
      }
    }
  }

  if (p.dominantCollateral && p.dominantCollateral.liquidationThreshold > 0) {
    const shortfallWeightedUsd = p.debtUsd * (targetHf - p.healthFactor);
    if (shortfallWeightedUsd > 0) {
      const addUsd = shortfallWeightedUsd / p.dominantCollateral.liquidationThreshold;
      const priceUsd = collateralPriceUsdOverride ?? p.dominantCollateral.currentPriceUsd;
      actions.push({
        type: "add_collateral",
        asset: p.dominantCollateral.symbol,
        amount: round(addUsd / priceUsd, 6),
        amount_usd: round(addUsd, 2),
        resulting_health_factor: targetHf,
      });
    }
  } else if (!primaryDebt) {
    notes.push("no distinct debt or collateral asset identified to compute a concrete action");
  }

  return {
    chain: p.chain,
    protocol: p.protocol,
    market: p.market,
    current_health_factor: p.healthFactor,
    target_health_factor: targetHf,
    actions,
    assumptions: {
      price_source: collateralPriceUsdOverride !== undefined
        ? "on-chain oracle prices at scan time, with the stress_pct move applied to the add-collateral asset's price (see stress_scenario.stress_pct)"
        : "on-chain oracle prices read at scan time (same source used for the rest of this report)",
      note: notes.length > 0 ? notes.join("; ") : undefined,
    },
  };
}

/**
 * Only positions with debt below the target HF get a recommendation — a
 * healthy position (or one with no debt) produces no entry, never invented
 * advice.
 *
 * `stressFactor` (e.g. 0.8 for a -20% collateral-price stress), when
 * provided, is applied via the SAME linear rescaling identity stress.ts
 * derives and documents (HF_stressed = HF_real * factor, exact for uniform
 * collateral-price moves) — not a separate/approximate stress code path.
 */
export function computeRecommendations(
  positions: NormalizedPosition[],
  targetHf: number = TARGET_COMFORTABLE_HF,
  stressFactor?: number,
): PositionRecommendation[] {
  const out: PositionRecommendation[] = [];
  for (const p of positions) {
    if (p.debtUsd <= 0 || p.healthFactor === Infinity) continue;
    const effectiveHf = stressFactor !== undefined ? round(p.healthFactor * stressFactor, 4) : p.healthFactor;
    if (effectiveHf >= targetHf) continue;
    const stressedPrice =
      stressFactor !== undefined && p.dominantCollateral ? p.dominantCollateral.currentPriceUsd * stressFactor : undefined;
    out.push(buildRecommendation({ ...p, healthFactor: effectiveHf }, targetHf, stressedPrice));
  }
  return out;
}
