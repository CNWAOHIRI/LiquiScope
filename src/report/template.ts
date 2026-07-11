/**
 * Deterministic report text — the fallback that makes the LLM optional.
 * Must produce a useful plain-language summary from scan data alone.
 */

import type { ChainScan, ProtocolPosition, RiskTier } from "../engine/types";

const TIER_ORDER: RiskTier[] = ["safe", "watch", "danger", "critical", "liquidatable"];

export function worstTier(positions: ProtocolPosition[]): RiskTier | "none" {
  const withDebt = positions.filter((p) => p.totalDebtUsd > 0);
  if (withDebt.length === 0) return "none";
  return withDebt.reduce<RiskTier>(
    (worst, p) => (TIER_ORDER.indexOf(p.tier) > TIER_ORDER.indexOf(worst) ? p.tier : worst),
    "safe",
  );
}

export const RECOMMENDATIONS: Record<RiskTier, string> = {
  safe: "No action needed. Re-check after any large withdrawal, new borrow, or sharp market move.",
  watch: "Set a price alert on your main collateral asset and avoid adding new debt. A moderate market dip could push this position into the danger zone.",
  danger: "Reduce risk now: repay part of the debt or add collateral. At this health factor, a routine single-day price swing could start liquidation.",
  critical: "Act immediately — repay debt or deposit collateral. This position sits within a normal day's volatility of liquidation and can be liquidated at any moment the threshold is crossed.",
  liquidatable: "This position is already eligible for liquidation. Repay or add collateral this instant if you want to keep it; liquidators can seize collateral (plus a penalty) right now.",
};

function positionLine(p: ProtocolPosition): string {
  const proto = p.protocol === "aave-v3" ? "Aave v3" : `Compound v3 (${p.market} market)`;
  const chain = p.chain[0].toUpperCase() + p.chain.slice(1);
  if (p.totalDebtUsd <= 0) {
    return `On ${chain}, ${proto}: $${fmt(p.totalCollateralUsd)} supplied, no debt — nothing to liquidate.`;
  }
  const hf = p.healthFactor === Infinity ? "∞" : p.healthFactor.toFixed(2);
  let line = `On ${chain}, ${proto}: $${fmt(p.totalCollateralUsd)} collateral against $${fmt(p.totalDebtUsd)} debt, health factor ${hf} (${p.tier}).`;
  const d = p.dominantCollateral;
  if (d && d.dropToLiquidation < 1) {
    line += ` Liquidation begins if ${d.symbol} falls ${(d.dropToLiquidation * 100).toFixed(1)}% to $${fmt(d.liquidationPriceUsd)} (now $${fmt(d.currentPriceUsd)}).`;
  }
  return line;
}

function fmt(n: number): string {
  return n >= 1000
    ? n.toLocaleString("en-US", { maximumFractionDigits: 0 })
    : n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

export function templateSummary(scans: ChainScan[]): string {
  const positions = scans.flatMap((s) => s.positions);
  const failures = scans.flatMap((s) => s.errors.map((e) => `${s.chain}/${e.protocol}`));

  if (positions.length === 0) {
    let msg =
      "No Aave v3 or Compound v3 positions found for this wallet on Ethereum, Base, or Arbitrum. " +
      "There is nothing at risk of liquidation. If you expected positions here, check the address and note that positions under $1 are treated as dust.";
    if (failures.length > 0) msg += ` (Could not check: ${failures.join(", ")} — data sources temporarily unavailable.)`;
    return msg;
  }

  const tier = worstTier(positions);
  const lines = positions.map(positionLine);
  const rec = tier === "none"
    ? "No debt anywhere — nothing can be liquidated. Supplied assets keep earning yield."
    : RECOMMENDATIONS[tier];

  let summary = `Overall risk: ${tier === "none" ? "none (no debt)" : tier.toUpperCase()}. ` + lines.join(" ") + ` Recommendation: ${rec}`;
  if (failures.length > 0) summary += ` (Partial scan — could not check: ${failures.join(", ")}.)`;
  return summary;
}
