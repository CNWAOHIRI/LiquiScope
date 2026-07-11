/** Shared engine types. All USD figures are plain JS numbers (report-level precision). */

export type ChainKey = "ethereum" | "base" | "arbitrum";

export type Protocol = "aave-v3" | "compound-v3";

export type RiskTier = "safe" | "watch" | "danger" | "critical" | "liquidatable";

export interface AssetPosition {
  symbol: string;
  /** Human-readable balance of the asset (collateral or debt side). */
  amount: number;
  usdValue: number;
}

export interface ProtocolPosition {
  protocol: Protocol;
  chain: ChainKey;
  /** Comet market label for Compound (e.g. "USDC"), "core" for Aave. */
  market: string;
  /** Aave: on-chain healthFactor / 1e18. Compound: composed equivalent. Infinity when no debt. */
  healthFactor: number;
  tier: RiskTier;
  totalCollateralUsd: number;
  totalDebtUsd: number;
  collateral: AssetPosition[];
  debt: AssetPosition[];
  /** Largest collateral asset by USD value — the one whose price move dominates liquidation risk. */
  dominantCollateral?: {
    symbol: string;
    currentPriceUsd: number;
    /** Price at which this position crosses HF = 1, holding everything else constant. */
    liquidationPriceUsd: number;
    /** Fraction of current price the asset must fall to trigger liquidation (0..1). */
    dropToLiquidation: number;
  };
}

export interface ChainScan {
  chain: ChainKey;
  positions: ProtocolPosition[];
  /** Protocols that could not be read on this chain (all RPCs failed). */
  errors: { protocol: Protocol; error: string }[];
}
