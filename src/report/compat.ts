/**
 * /report back-compat shim — the live, listed, OKX-reviewed ASP endpoint's
 * response shape is a contract with existing callers. This engine version
 * renamed several internal fields (totalCollateralUsd → collateralUsd, etc.)
 * for a cleaner protocol-agnostic model, but NOTHING in the wire response
 * may be renamed, removed, or change type as a result — only additions.
 *
 * Strategy: every position in /report's `positions[]` carries BOTH the old
 * field names (exactly as returned before this engine version) AND the new
 * ones, side by side. A caller written against the old shape sees nothing
 * different; a new caller can read the richer names.
 */

import type { NormalizedPosition } from "../engine/types";

/** Old (pre-cross-protocol-engine) dominantCollateral shape — dropToLiquidation, not dropToLiquidationPct. */
interface LegacyDominantCollateral {
  symbol: string;
  currentPriceUsd: number;
  liquidationPriceUsd: number;
  dropToLiquidation: number;
}

export interface CompatPosition {
  // --- unchanged fields (same name, same type, before and after) ---
  protocol: NormalizedPosition["protocol"];
  chain: NormalizedPosition["chain"];
  market: string;
  healthFactor: number;
  tier: NormalizedPosition["tier"];

  // --- old field names, preserved exactly (the back-compat seam) ---
  totalCollateralUsd: number;
  totalDebtUsd: number;
  collateral: NormalizedPosition["collateralAssets"];
  debt: NormalizedPosition["debtAssets"];
  /** Omitted entirely (not present as a key) when there's no dominant leg — matches the pre-existing optional-field behavior exactly. */
  dominantCollateral?: LegacyDominantCollateral & { dropToLiquidationPct: number };

  // --- new fields, additive only (never existed before, so no collision) ---
  collateralUsd: number;
  debtUsd: number;
  liquidationPrice: number | null;
  dropToLiquidationPct: number | null;
  collateralAssets: NormalizedPosition["collateralAssets"];
  debtAssets: NormalizedPosition["debtAssets"];
  /** Only present (as `true`) for provisional-source positions; see engine/scan.ts PROVISIONAL_SOURCES. */
  provisional?: true;
}

export function toCompatPosition(p: NormalizedPosition): CompatPosition {
  const compat: CompatPosition = {
    protocol: p.protocol,
    chain: p.chain,
    market: p.market,
    healthFactor: p.healthFactor,
    tier: p.tier,

    totalCollateralUsd: p.collateralUsd,
    totalDebtUsd: p.debtUsd,
    collateral: p.collateralAssets,
    debt: p.debtAssets,

    collateralUsd: p.collateralUsd,
    debtUsd: p.debtUsd,
    liquidationPrice: p.liquidationPrice,
    dropToLiquidationPct: p.dropToLiquidationPct,
    collateralAssets: p.collateralAssets,
    debtAssets: p.debtAssets,
  };
  if (p.dominantCollateral) {
    compat.dominantCollateral = {
      symbol: p.dominantCollateral.symbol,
      currentPriceUsd: p.dominantCollateral.currentPriceUsd,
      liquidationPriceUsd: p.dominantCollateral.liquidationPriceUsd,
      dropToLiquidation: p.dominantCollateral.dropToLiquidationPct, // old name
      dropToLiquidationPct: p.dominantCollateral.dropToLiquidationPct, // new name, additive
    };
  }
  if (p.provisional) compat.provisional = true;
  return compat;
}
