/**
 * Aave v3 adapter. Everything is resolved at runtime from the immutable
 * PoolAddressesProvider (one hardcoded address per chain, verified against
 * bgd-labs/aave-address-book) so Pool / Oracle / DataProvider upgrades never
 * break us.
 *
 * Reads per user:
 *   1. pool.getUserAccountData        — aggregate HF (authoritative), totals, avg LT
 *   2. dataProvider.getAllReservesTokens + getUserReserveData (multicalled)
 *   3. per involved reserve: config (decimals, LT) + oracle prices (multicalled)
 *
 * Base currency on all four markets is USD with 8 decimals.
 *
 * E-mode caveat: per-reserve liquidation thresholds understate e-mode users'
 * real thresholds. When the user is in an e-mode category we substitute the
 * position-wide weighted-average LT (from getUserAccountData) on every leg —
 * exact for single-collateral positions, a close approximation otherwise.
 * The health factor itself is always the on-chain aggregate, never recomputed.
 *
 * `resolveContracts` / `oracleAbi` are also imported by ../ethPrice.ts, which
 * reuses this adapter's price oracle as a shared ETH/USD source for the
 * Compound adapter's ETH-denominated Comet feeds — a price-utility reuse,
 * not a report-layer or risk-logic dependency between adapters.
 */

import { parseAbi, type Address, type PublicClient } from "viem";
import { getClient } from "../rpc";
import { DUST_USD, dominantLiquidationPrice, round, tierFor, type CollateralLeg } from "../risk";
import type { ChainKey, NormalizedPosition } from "../types";
import type { ProtocolAdapter } from "./types";

// Verified against bgd-labs/aave-address-book (src/AaveV3<Chain>.sol), 2026-07-24.
// Optimism and Arbitrum share the same address — confirmed via each chain's
// own etherscan-style source comment, not a copy-paste artifact: Aave
// deploys this contract via a deterministic factory on some chains.
const ADDRESSES_PROVIDER: Record<ChainKey, Address> = {
  ethereum: "0x2f39d218133AFaB8F2B819B1066c7E434Ad94E9e",
  base: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
  arbitrum: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
  optimism: "0xa97684ead0e402dC232d5A977953DF7ECBaB3CDb",
};

const providerAbi = parseAbi([
  "function getPool() view returns (address)",
  "function getPriceOracle() view returns (address)",
  "function getPoolDataProvider() view returns (address)",
]);

const poolAbi = parseAbi([
  "function getUserAccountData(address user) view returns (uint256 totalCollateralBase, uint256 totalDebtBase, uint256 availableBorrowsBase, uint256 currentLiquidationThreshold, uint256 ltv, uint256 healthFactor)",
  "function getUserEMode(address user) view returns (uint256)",
]);

const dataProviderAbi = parseAbi([
  "function getAllReservesTokens() view returns ((string symbol, address tokenAddress)[])",
  "function getUserReserveData(address asset, address user) view returns (uint256 currentATokenBalance, uint256 currentStableDebt, uint256 currentVariableDebt, uint256 principalStableDebt, uint256 scaledVariableDebt, uint256 stableBorrowRate, uint256 liquidityRate, uint40 stableRateLastUpdated, bool usageAsCollateralEnabled)",
  "function getReserveConfigurationData(address asset) view returns (uint256 decimals, uint256 ltv, uint256 liquidationThreshold, uint256 liquidationBonus, uint256 reserveFactor, bool usageAsCollateralEnabled, bool borrowingEnabled, bool stableBorrowRateEnabled, bool isActive, bool isFrozen)",
]);

export const oracleAbi = parseAbi(["function getAssetsPrices(address[] assets) view returns (uint256[])"]);

interface Contracts {
  pool: Address;
  oracle: Address;
  dataProvider: Address;
}

const contractsCache = new Map<ChainKey, Contracts>();

export async function resolveContracts(chain: ChainKey, client: PublicClient): Promise<Contracts> {
  const cached = contractsCache.get(chain);
  if (cached) return cached;
  const provider = ADDRESSES_PROVIDER[chain];
  const [pool, oracle, dataProvider] = await Promise.all([
    client.readContract({ address: provider, abi: providerAbi, functionName: "getPool" }),
    client.readContract({ address: provider, abi: providerAbi, functionName: "getPriceOracle" }),
    client.readContract({ address: provider, abi: providerAbi, functionName: "getPoolDataProvider" }),
  ]);
  const contracts = { pool, oracle, dataProvider };
  contractsCache.set(chain, contracts);
  return contracts;
}

const BASE_UNIT = 1e8; // USD, 8 decimals

async function readOne(chain: ChainKey, user: Address): Promise<NormalizedPosition | null> {
  const client = getClient(chain);
  const { pool, oracle, dataProvider } = await resolveContracts(chain, client);

  const [totalCollateralBase, totalDebtBase, , avgLtBps, , healthFactorRay] = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "getUserAccountData",
    args: [user],
  });

  const totalCollateralUsd = Number(totalCollateralBase) / BASE_UNIT;
  const totalDebtUsd = Number(totalDebtBase) / BASE_UNIT;
  if (totalCollateralUsd < DUST_USD && totalDebtUsd < DUST_USD) return null;

  const healthFactor = totalDebtBase === 0n ? Infinity : round(Number(healthFactorRay) / 1e18, 4);

  const reserves = await client.readContract({
    address: dataProvider,
    abi: dataProviderAbi,
    functionName: "getAllReservesTokens",
  });

  // One multicall round: user data for every reserve on the market.
  const userData = await Promise.all(
    reserves.map((r) =>
      client.readContract({
        address: dataProvider,
        abi: dataProviderAbi,
        functionName: "getUserReserveData",
        args: [r.tokenAddress, user],
      }),
    ),
  );

  const involved = reserves
    .map((r, i) => {
      const [aToken, stableDebt, variableDebt, , , , , , usageAsCollateral] = userData[i];
      return { ...r, aToken, debt: stableDebt + variableDebt, usageAsCollateral };
    })
    .filter((r) => r.aToken > 0n || r.debt > 0n);

  const [configs, prices] = await Promise.all([
    Promise.all(
      involved.map((r) =>
        client.readContract({
          address: dataProvider,
          abi: dataProviderAbi,
          functionName: "getReserveConfigurationData",
          args: [r.tokenAddress],
        }),
      ),
    ),
    client.readContract({
      address: oracle,
      abi: oracleAbi,
      functionName: "getAssetsPrices",
      args: [involved.map((r) => r.tokenAddress)],
    }),
  ]);

  const eMode = await client.readContract({
    address: pool,
    abi: poolAbi,
    functionName: "getUserEMode",
    args: [user],
  });
  const avgLt = Number(avgLtBps) / 10_000;

  const collateralAssets: NormalizedPosition["collateralAssets"] = [];
  const debtAssets: NormalizedPosition["debtAssets"] = [];
  const legs: CollateralLeg[] = [];

  involved.forEach((r, i) => {
    const [decimals, , ltBps] = configs[i];
    const priceUsd = Number(prices[i]) / BASE_UNIT;
    const scale = 10 ** Number(decimals);
    if (r.aToken > 0n) {
      const amount = Number(r.aToken) / scale;
      const usdValue = round(amount * priceUsd, 2);
      collateralAssets.push({ symbol: r.symbol, amount: round(amount, 6), usdValue });
      if (r.usageAsCollateral) {
        legs.push({
          symbol: r.symbol,
          usdValue,
          priceUsd,
          liquidationThreshold: eMode !== 0n ? avgLt : Number(ltBps) / 10_000,
        });
      }
    }
    if (r.debt > 0n) {
      const amount = Number(r.debt) / scale;
      debtAssets.push({ symbol: r.symbol, amount: round(amount, 6), usdValue: round(amount * priceUsd, 2) });
    }
  });

  const dominant = dominantLiquidationPrice(legs, totalDebtUsd);

  return {
    protocol: "aave-v3",
    chain,
    market: "core",
    collateralUsd: round(totalCollateralUsd, 2),
    debtUsd: round(totalDebtUsd, 2),
    healthFactor,
    tier: tierFor(healthFactor),
    liquidationPrice: dominant?.liquidationPriceUsd ?? null,
    dominantCollateral: dominant ?? null,
    dropToLiquidationPct: dominant?.dropToLiquidationPct ?? null,
    collateralAssets,
    debtAssets,
  };
}

export const AaveV3Adapter: ProtocolAdapter = {
  protocol: "aave-v3",
  supportedChains: ["ethereum", "base", "arbitrum", "optimism"],
  async getPositions(chain, wallet) {
    const p = await readOne(chain, wallet);
    return p ? [p] : [];
  },
};
