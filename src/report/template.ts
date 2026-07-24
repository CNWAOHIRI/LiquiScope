/**
 * Deterministic report text — the fallback that makes the LLM optional.
 * Must produce a useful plain-language summary from scan data alone.
 *
 * Protocol-agnostic by construction: every line here reads only
 * NormalizedPosition fields (protocol/market are display labels, never
 * branched on for logic) — this file has no idea Aave or Compound exist as
 * anything other than strings.
 */

import { aggregatePortfolio } from "../engine/scan";
import type { ChainScan, NormalizedPosition, RiskTier } from "../engine/types";

const TIER_ORDER: RiskTier[] = ["safe", "watch", "danger", "critical", "liquidatable"];

export function worstTier(positions: NormalizedPosition[]): RiskTier | "none" {
  const withDebt = positions.filter((p) => p.debtUsd > 0);
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

function protocolLabel(p: NormalizedPosition): string {
  if (p.protocol === "aave-v3") return "Aave v3";
  if (p.protocol === "compound-v3") return `Compound v3 (${p.market} market)`;
  return `${p.protocol} (${p.market})`; // future adapters get a reasonable default without touching this file
}

function chainLabel(chain: string): string {
  return chain[0].toUpperCase() + chain.slice(1);
}

function positionLine(p: NormalizedPosition): string {
  const proto = protocolLabel(p);
  const chain = chainLabel(p.chain);
  if (p.debtUsd <= 0) {
    return `On ${chain}, ${proto}: $${fmt(p.collateralUsd)} supplied, no debt — nothing to liquidate.`;
  }
  const hf = p.healthFactor === Infinity ? "∞" : p.healthFactor.toFixed(2);
  let line = `On ${chain}, ${proto}: $${fmt(p.collateralUsd)} collateral against $${fmt(p.debtUsd)} debt, health factor ${hf} (${p.tier}).`;
  const d = p.dominantCollateral;
  if (d && d.dropToLiquidationPct < 1) {
    line += ` Liquidation begins if ${d.symbol} falls ${(d.dropToLiquidationPct * 100).toFixed(1)}% to $${fmt(d.liquidationPriceUsd)} (now $${fmt(d.currentPriceUsd)}).`;
  }
  return line;
}

/** "Your riskiest position is 2,400 USDC debt on Aave/Base, HF 1.12 — liquidated if ETH drops 9%." */
function riskiestPositionLine(p: NormalizedPosition): string {
  const proto = p.protocol === "aave-v3" ? "Aave" : "Compound";
  const debtSymbol = p.debtAssets[0]?.symbol ?? p.market;
  const hf = p.healthFactor === Infinity ? "∞" : p.healthFactor.toFixed(2);
  const base = `Your riskiest position is $${fmt(p.debtUsd)} ${debtSymbol} debt on ${proto}/${chainLabel(p.chain)}, HF ${hf}`;
  const d = p.dominantCollateral;
  if (d && d.dropToLiquidationPct < 1) {
    return `${base} — liquidated if ${d.symbol} drops ${(d.dropToLiquidationPct * 100).toFixed(1)}%.`;
  }
  return `${base}.`;
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
      "No lending positions found for this wallet across every scanned protocol and chain. " +
      "There is nothing at risk of liquidation. If you expected positions here, check the address and note that positions under $1 are treated as dust.";
    if (failures.length > 0) msg += ` (Could not check: ${failures.join(", ")} — data sources temporarily unavailable.)`;
    return msg;
  }

  const portfolio = aggregatePortfolio(scans);
  const tier = portfolio.overallTier;
  const lines = positions.map(positionLine);
  const rec = tier === "none"
    ? "No debt anywhere — nothing can be liquidated. Supplied assets keep earning yield."
    : RECOMMENDATIONS[tier];

  const header =
    positions.length > 1
      ? `Overall risk: ${tier === "none" ? "none (no debt)" : tier.toUpperCase()}. Across ${positions.length} position(s), $${fmt(portfolio.totalCollateralUsd)} total collateral vs $${fmt(portfolio.totalDebtUsd)} total debt. ` +
        (portfolio.riskiestPosition ? riskiestPositionLine(portfolio.riskiestPosition) + " " : "")
      : `Overall risk: ${tier === "none" ? "none (no debt)" : tier.toUpperCase()}. `;

  let summary = header + lines.join(" ") + ` Recommendation: ${rec}`;
  if (failures.length > 0) summary += ` (Partial scan — could not check: ${failures.join(", ")}.)`;
  return summary;
}
