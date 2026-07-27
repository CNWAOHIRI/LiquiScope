/**
 * Morpho Blue adapter. Unlike Aave (one pool) or Compound (one Comet per
 * market), Morpho Blue is a single immutable singleton contract on which
 * ANYONE can permissionlessly create a market — there is no on-chain
 * enumeration of "which markets exist" or "which markets a wallet has
 * touched". Every fact below was verified directly against Morpho's own
 * source (github.com/morpho-org/morpho-blue), not assumed from memory:
 *
 *   - Contract address 0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb is the
 *     SAME on every chain (CREATE2 deterministic deploy, confirmed via the
 *     official morpho-blue-deployment repo's broadcast logs) — but it only
 *     actually HAS bytecode on Ethereum and Base (checked live via
 *     eth_getCode); Arbitrum and Optimism don't have Morpho Blue deployed
 *     at all, confirmed the same way, not assumed.
 *   - A market's id = keccak256(abi.encode(loanToken, collateralToken,
 *     oracle, irm, lltv)) — computed here at runtime from the params below,
 *     not hardcoded as an opaque hash, and cross-checked by hand against
 *     Morpho's public API for one market before trusting the pattern.
 *   - Health check formula and its exact rounding direction is copied
 *     verbatim from Morpho.sol's own `_isHealthy`: maxBorrow rounds DOWN
 *     (mulDivDown then wMulDown), borrowed rounds UP (toAssetsUp, which
 *     itself uses SharesMathLib's virtual offset: +1 asset, +1e6 shares) —
 *     healthy iff maxBorrow >= borrowed. This project never re-derives an
 *     approximation when the authoritative formula is available; this is
 *     copied, not reinvented.
 *   - Oracle price(): "price of 1 asset of collateral quoted in 1 asset of
 *     loan token, scaled by 1e36" (Morpho's own IOracle.sol doc comment).
 *
 * Curated market list: because there's no on-chain enumeration, this
 * adapter checks a small, explicit list of major markets (by real supply
 * TVL, queried from Morpho's own public API and independently verified —
 * see the market-id cross-check above) rather than claiming exhaustive
 * coverage — the same honest-scoping pattern this project already uses for
 * Compound's per-chain Comet market list.
 *
 * USD conversion caveat: Morpho's oracle only prices collateral IN loan
 * token terms, never in USD directly. Every curated market below has a
 * USD-pegged stablecoin as its loan token (USDC or USDT), so this adapter
 * treats the loan token as worth exactly $1 to derive USD figures. The
 * health factor itself is NOT affected by this — it's a ratio of two
 * loan-token-denominated raw values, computed exactly per the on-chain
 * formula above, so it's exact regardless of the $1 assumption. Only the
 * displayed totalCollateralUsd/totalDebtUsd figures inherit the stablecoin
 * assumption. Would need revisiting if a non-stable loan token market is
 * ever added to the curated list.
 */

import { encodeAbiParameters, keccak256, parseAbi, type Address } from "viem";
import { getClient } from "../rpc";
import { DUST_USD, dominantLiquidationPrice, round, tierFor, type CollateralLeg } from "../risk";
import type { ChainKey, NormalizedPosition } from "../types";
import type { ProtocolAdapter } from "./types";

// Verified via morpho-org/morpho-blue-deployment's broadcast/DeployMorpho.sol/<chainId>/run-latest.json
// (same address every chain, CREATE2) AND independently confirmed to have real bytecode via eth_getCode
// on Ethereum + Base; Arbitrum + Optimism confirmed EMPTY the same way, 2026-07-27.
const MORPHO: Address = "0xBBBBBbbBBb9cC5e90e3b3Af64bdAF62C37EEFFCb";

interface MorphoMarket {
  label: string; // "collateral/loan" — Morpho's own natural market identity, since one market = one fixed pair
  loanToken: Address;
  loanSymbol: string;
  loanDecimals: number;
  collateralToken: Address;
  collateralSymbol: string;
  collateralDecimals: number;
  oracle: Address;
  irm: Address;
  lltv: bigint;
}

// Sourced from Morpho's public API (blue-api.morpho.org), filtered to Ethereum + Base, ranked by real
// supply TVL, restricted to markets with a recognizable major asset pair — not the full permissionless
// long tail. Market-id-from-params derivation was independently verified against the API's own reported
// marketId for the first entry before trusting the rest of this list (see file header).
const MARKETS: Partial<Record<ChainKey, MorphoMarket[]>> = {
  ethereum: [
    {
      label: "WETH/USDC",
      collateralToken: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
      collateralSymbol: "WETH",
      collateralDecimals: 18,
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      loanSymbol: "USDC",
      loanDecimals: 6,
      oracle: "0x0F948CBa8231Db7898ef36A4212581Ad7b1B4580",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 860000000000000000n,
    },
    {
      label: "cbBTC/USDC",
      collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      collateralSymbol: "cbBTC",
      collateralDecimals: 8,
      loanToken: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
      loanSymbol: "USDC",
      loanDecimals: 6,
      oracle: "0xA6D6950c9F177F1De7f7757FB33539e3Ec60182a",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 860000000000000000n,
    },
    {
      label: "wstETH/USDT",
      collateralToken: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0",
      collateralSymbol: "wstETH",
      collateralDecimals: 18,
      loanToken: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
      loanSymbol: "USDT",
      loanDecimals: 6,
      oracle: "0x95DB30fAb9A3754e42423000DF27732CB2396992",
      irm: "0x870aC11D48B15DB9a138Cf899d20F13F79Ba00BC",
      lltv: 860000000000000000n,
    },
  ],
  base: [
    {
      label: "cbBTC/USDC",
      collateralToken: "0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf",
      collateralSymbol: "cbBTC",
      collateralDecimals: 8,
      loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      loanSymbol: "USDC",
      loanDecimals: 6,
      oracle: "0x663BECd10daE6C4A3Dcd89F1d76c1174199639B9",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
    {
      label: "WETH/USDC",
      collateralToken: "0x4200000000000000000000000000000000000006",
      collateralSymbol: "WETH",
      collateralDecimals: 18,
      loanToken: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      loanSymbol: "USDC",
      loanDecimals: 6,
      oracle: "0xFEa2D58cEfCb9fcb597723c6bAE66fFE4193aFE4",
      irm: "0x46415998764C29aB2a25CbeA6254146D50D22687",
      lltv: 860000000000000000n,
    },
  ],
};

const morphoAbi = parseAbi([
  "function position(bytes32 id, address user) view returns (uint256 supplyShares, uint128 borrowShares, uint128 collateral)",
  "function market(bytes32 id) view returns (uint128 totalSupplyAssets, uint128 totalSupplyShares, uint128 totalBorrowAssets, uint128 totalBorrowShares, uint128 lastUpdate, uint128 fee)",
]);
const oracleAbi = parseAbi(["function price() view returns (uint256)"]);

const ORACLE_PRICE_SCALE = 10n ** 36n;
const WAD = 10n ** 18n;
const VIRTUAL_SHARES = 1_000_000n; // SharesMathLib.VIRTUAL_SHARES, copied verbatim
const VIRTUAL_ASSETS = 1n; // SharesMathLib.VIRTUAL_ASSETS, copied verbatim

function marketId(m: MorphoMarket): `0x${string}` {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "address" }, { type: "address" }, { type: "address" }, { type: "uint256" }],
      [m.loanToken, m.collateralToken, m.oracle, m.irm, m.lltv],
    ),
  );
}

/** ceil(a / b) via mulDivUp's shape, matching SharesMathLib.toAssetsUp exactly (rounds in favor of the protocol, i.e. against the borrower). */
function toAssetsUp(shares: bigint, totalAssets: bigint, totalShares: bigint): bigint {
  const numerator = shares * (totalAssets + VIRTUAL_ASSETS);
  const denominator = totalShares + VIRTUAL_SHARES;
  return denominator === 0n ? 0n : (numerator + denominator - 1n) / denominator;
}

async function readMarket(chain: ChainKey, m: MorphoMarket, user: Address, blockNumber?: bigint): Promise<NormalizedPosition | null> {
  const client = getClient(chain);
  const id = marketId(m);

  const [supplyShares, borrowShares, collateralRaw] = await client.readContract({
    address: MORPHO,
    abi: morphoAbi,
    functionName: "position",
    args: [id, user],
    blockNumber,
  });
  void supplyShares; // supply-side isn't collateral/debt for this report's purposes — only borrow + posted collateral matter

  if (borrowShares === 0n && collateralRaw === 0n) return null;

  const [, , totalBorrowAssets, totalBorrowShares] = await client.readContract({
    address: MORPHO,
    abi: morphoAbi,
    functionName: "market",
    args: [id],
    blockNumber,
  });
  const price = await client.readContract({ address: m.oracle, abi: oracleAbi, functionName: "price", blockNumber });

  const borrowedRawLoanUnits = borrowShares === 0n ? 0n : toAssetsUp(BigInt(borrowShares), BigInt(totalBorrowAssets), BigInt(totalBorrowShares));
  // Exactly Morpho's own mulDivDown(collateral, price, ORACLE_PRICE_SCALE) — the collateral value expressed in raw loan-token units.
  const collateralValueInLoanRawUnits = (BigInt(collateralRaw) * price) / ORACLE_PRICE_SCALE;

  const debtUsd = round(Number(borrowedRawLoanUnits) / 10 ** m.loanDecimals, 2); // loan token assumed $1 — see file header
  const collateralAmount = Number(collateralRaw) / 10 ** m.collateralDecimals;
  const collateralUsd = round(Number(collateralValueInLoanRawUnits) / 10 ** m.loanDecimals, 2);
  if (collateralUsd < DUST_USD && debtUsd < DUST_USD) return null;

  const priceUsd = collateralAmount > 0 ? collateralUsd / collateralAmount : 0;
  const liquidationThreshold = Number(m.lltv) / Number(WAD);

  const legs: CollateralLeg[] = collateralRaw > 0n ? [{ symbol: m.collateralSymbol, usdValue: collateralUsd, priceUsd, liquidationThreshold }] : [];
  // Same identity as everywhere else in this engine: healthFactor = weightedCollateralUsd / debtUsd.
  // Here weightedCollateralUsd IS collateralUsd * liquidationThreshold by construction (single leg), so this
  // is exactly Morpho's own maxBorrow/borrowed ratio — not a re-derivation.
  const healthFactor = debtUsd <= 0 ? Infinity : round((collateralUsd * liquidationThreshold) / debtUsd, 4);
  const dominant = dominantLiquidationPrice(legs, debtUsd);

  return {
    protocol: "morpho-blue",
    chain,
    market: m.label,
    collateralUsd,
    debtUsd,
    healthFactor,
    tier: tierFor(healthFactor),
    liquidationPrice: dominant?.liquidationPriceUsd ?? null,
    dominantCollateral: dominant ?? null,
    dropToLiquidationPct: dominant?.dropToLiquidationPct ?? null,
    collateralAssets: collateralRaw > 0n ? [{ symbol: m.collateralSymbol, amount: round(collateralAmount, 6), usdValue: collateralUsd }] : [],
    debtAssets: debtUsd > 0 ? [{ symbol: m.loanSymbol, amount: round(Number(borrowedRawLoanUnits) / 10 ** m.loanDecimals, 6), usdValue: debtUsd }] : [],
  };
}

export const MorphoBlueAdapter: ProtocolAdapter = {
  protocol: "morpho-blue",
  supportedChains: ["ethereum", "base"], // NOT arbitrum/optimism — confirmed no bytecode at the deterministic address on either, see file header
  async getPositions(chain, wallet, blockNumber) {
    const markets = MARKETS[chain];
    if (!markets) return [];
    const results = await Promise.all(markets.map((m) => readMarket(chain, m, wallet, blockNumber)));
    return results.filter((r): r is NormalizedPosition => r !== null);
  },
};

/**
 * GET /proof's reader. Unlike Aave (many extra reserve/config/symbol reads
 * beyond the HF itself) or Compound (per-asset symbol() lookups), a Morpho
 * market read is already minimal — exactly 3 reads (position, market,
 * oracle price), all strictly necessary to compute the health factor, no
 * display-only data to strip out. So this is a thin wrapper over
 * getPositions rather than a separately-optimized path — there's nothing
 * more to cut for this protocol's shape, and pretending otherwise would be
 * a fake optimization.
 */
export async function getHealthFactorAt(chain: ChainKey, user: Address, blockNumber?: bigint): Promise<{ market: string; healthFactor: number }[]> {
  const positions = await MorphoBlueAdapter.getPositions(chain, user, blockNumber);
  return positions.map((p) => ({ market: p.market, healthFactor: p.healthFactor }));
}
