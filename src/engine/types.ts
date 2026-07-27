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

export type Protocol = "aave-v3" | "compound-v3" | "morpho-blue";

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
  /**
   * Fraction (0..1) of this asset's USD value counted toward the health
   * factor (Aave: liquidationThreshold; Compound: liquidateCollateralFactor).
   * Exposed so downstream consumers (recommendations.ts) can solve the HF
   * formula backwards for "how much collateral to add" using the exact same
   * number the forward computation used — never re-derived or guessed.
   */
  liquidationThreshold: number;
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
  /**
   * True only for sources listed in scan.ts's PROVISIONAL_SOURCES — reads that
   * succeed and are structurally sound but have never been checked against a
   * real live position (no fixture wallet found yet). Numbers are computed by
   * the same formula as every other source, not guessed; this flag exists so
   * callers can distinguish "battle-tested" from "correct by construction,
   * unconfirmed" until a positive fixture promotes the source out of the list.
   * Omitted (not `false`) on every normal position — only ever present as `true`.
   */
  provisional?: true;
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

/**
 * protocol × chain → whether the scan for that source succeeded, for the
 * coverage report. `beta` means the read succeeded but the source has no
 * live positive fixture yet — see scan.ts's PROVISIONAL_SOURCES.
 */
export interface CoverageEntry {
  protocol: Protocol;
  chain: ChainKey;
  status: "ok" | "beta" | "error" | "unsupported";
  error?: string;
}
