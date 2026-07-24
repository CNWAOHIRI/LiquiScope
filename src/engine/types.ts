/**
 * Shared engine types. All USD figures are plain JS numbers (report-level precision).
 *
 * NormalizedPosition is the contract between protocol adapters and everything
 * downstream (aggregation, report layer, endpoints). The report layer and
 * portfolio aggregator must only ever read NormalizedPosition fields — never
 * protocol-specific shapes — so a new adapter (Morpho, Spark, Venus, …) can be
 * added without touching report/aggregation code. `protocol` and `market` are
 * carried through purely as display/grouping labels, never branched on for
 * risk logic.
 */

export type ChainKey = "ethereum" | "base" | "arbitrum" | "optimism";

export type Protocol = "aave-v3" | "compound-v3";

export type RiskTier = "safe" | "watch" | "danger" | "critical" | "liquidatable";

export interface AssetPosition {
  symbol: string;
  /** Human-readable balance of the asset (collateral or debt side). */
  amount: number;
  usdValue: number;
}

export interface DominantCollateral {
  symbol: string;
  currentPriceUsd: number;
  /** Price at which this position crosses HF = 1, holding everything else constant. */
  liquidationPriceUsd: number;
  /** Fraction (0..1) of current price the asset must fall to trigger liquidation. */
  dropToLiquidationPct: number;
}

/**
 * The one shape every protocol adapter emits and every downstream consumer
 * (report layer, portfolio aggregator, endpoints) reads. See ProtocolAdapter
 * in adapters/types.ts for the interface that produces these.
 */
export interface NormalizedPosition {
  protocol: Protocol;
  chain: ChainKey;
  /** "core" for Aave (single unified pool); Comet market label for Compound. */
  market: string;
  collateralUsd: number;
  debtUsd: number;
  /** On-chain aggregate (Aave) or composed equivalent (Compound). Infinity when no debt. */
  healthFactor: number;
  tier: RiskTier;
  /** Dominant collateral's liquidation price, mirrored at top level per spec. Null iff dominantCollateral is null. */
  liquidationPrice: number | null;
  dominantCollateral: DominantCollateral | null;
  /** Mirror of dominantCollateral.dropToLiquidationPct at top level for convenient access. Null iff dominantCollateral is null. */
  dropToLiquidationPct: number | null;
  /** Additive per-asset detail beyond the minimal normalized contract — used for richer report rendering only, never for risk-tier logic. */
  collateralAssets: AssetPosition[];
  debtAssets: AssetPosition[];
}

export interface ChainScan {
  chain: ChainKey;
  positions: NormalizedPosition[];
  /** Protocols that could not be read on this chain (timeout or all RPCs failed). */
  errors: { protocol: Protocol; error: string }[];
}

/** Portfolio-level aggregate across every chain/protocol scanned for one wallet. */
export interface PortfolioSummary {
  totalCollateralUsd: number;
  totalDebtUsd: number;
  overallTier: RiskTier | "none";
  /** The single position with the lowest health factor among debt-bearing positions, or null if none. */
  riskiestPosition: NormalizedPosition | null;
  positionCount: number;
}

/** protocol × chain → whether the scan for that source succeeded, for the coverage report. */
export interface CoverageEntry {
  protocol: Protocol;
  chain: ChainKey;
  status: "ok" | "error" | "unsupported";
  error?: string;
}
