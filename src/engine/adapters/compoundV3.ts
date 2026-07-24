/**
 * Compound v3 (Comet) adapter. Unlike Aave there is no aggregate health
 * factor; we compose the equivalent per market:
 *
 *   HF_equivalent = Σ_i (collateral_i_usd × liquidateCollateralFactor_i) / debt_usd
 *
 * i.e. the same weighted-collateral-over-debt ratio Aave's on-chain HF
 * represents, built from Comet's own per-asset `liquidateCollateralFactor`
 * (from `getAssetInfo`) instead of a contract-provided aggregate. `debt_usd`
 * is `borrowBalanceOf` priced via the market's own base-token feed. This is
 * exact, not an approximation — Comet liquidates a whole-account position
 * the moment this same ratio crosses 1, so it's the correct HF-equivalent by
 * construction, not just a stylistic mirror of Aave's formula.
 *
 * Market addresses are the Comet proxies from the canonical
 * compound-finance/comet deployments/ folder (re-verified 2026-07-24;
 * Base/Arbitrum addresses unchanged since 2026-07-11; Ethereum mainnet added).
 *
 * Price caveat: WETH-market price feeds are denominated in ETH, not USD, so
 * those values are converted via the chain's ETH/USD price (shared with the
 * Aave adapter — see ../ethPrice.ts). All other markets' feeds are USD, 8
 * decimals. Verified empirically per chain during live testing, not assumed.
 */

import { parseAbi, type Address, type PublicClient } from "viem";
import { getEthUsdPrice } from "../ethPrice";
import { getClient } from "../rpc";
import { DUST_USD, dominantLiquidationPrice, round, tierFor, type CollateralLeg } from "../risk";
import type { ChainKey, NormalizedPosition } from "../types";
import type { ProtocolAdapter } from "./types";

interface CometMarket {
  label: string;
  address: Address;
  /** Price feeds quote in ETH (WETH markets) instead of USD. */
  ethDenominated: boolean;
}

const MARKETS: Partial<Record<ChainKey, CometMarket[]>> = {
  ethereum: [
    { label: "USDC", address: "0xc3d688B66703497DAA19211EEdff47f25384cdc3", ethDenominated: false },
    { label: "WETH", address: "0xA17581A9E3356d9A858b789D68B4d866e593aE94", ethDenominated: true },
  ],
  base: [
    { label: "USDC", address: "0xb125E6687d4313864e53df431d5425969c15Eb2F", ethDenominated: false },
    { label: "WETH", address: "0x46e6b214b524310239732D51387075E0e70970bf", ethDenominated: true },
    { label: "AERO", address: "0x784efeB622244d2348d4F2522f8860B96fbEcE89", ethDenominated: false },
    { label: "USDS", address: "0x2c776041CCFe903071AF44aa147368a9c8EEA518", ethDenominated: false },
    { label: "USDbC", address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", ethDenominated: false },
  ],
  arbitrum: [
    { label: "USDC", address: "0x9c4ec768c28520B50860ea7a15bd7213a9fF58bf", ethDenominated: false },
    { label: "USDT", address: "0xd98Be00b5D27fc98112BdE293e487f8D4cA57d07", ethDenominated: false },
    { label: "WETH", address: "0x6f7D514bbD4aFf3BcD1140B7344b32f063dEe486", ethDenominated: true },
    { label: "USDC.e", address: "0xA5EDBDD9646f8dFF606d7448e414884C7d905dCA", ethDenominated: false },
  ],
};

const cometAbi = parseAbi([
  "function borrowBalanceOf(address account) view returns (uint256)",
  "function balanceOf(address account) view returns (uint256)",
  "function numAssets() view returns (uint8)",
  "function getAssetInfo(uint8 i) view returns ((uint8 offset, address asset, address priceFeed, uint64 scale, uint64 borrowCollateralFactor, uint64 liquidateCollateralFactor, uint64 liquidationFactor, uint128 supplyCap))",
  "function userCollateral(address account, address asset) view returns (uint128 balance, uint128 reserved)",
  "function getPrice(address priceFeed) view returns (uint256)",
  "function baseScale() view returns (uint64)",
  "function baseTokenPriceFeed() view returns (address)",
]);

const erc20Abi = parseAbi(["function symbol() view returns (string)"]);

const PRICE_UNIT = 1e8;

async function readMarket(
  client: PublicClient,
  chain: ChainKey,
  market: CometMarket,
  user: Address,
): Promise<NormalizedPosition | null> {
  const comet = market.address;
  const [borrowRaw, baseSupplyRaw, numAssets] = await Promise.all([
    client.readContract({ address: comet, abi: cometAbi, functionName: "borrowBalanceOf", args: [user] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "balanceOf", args: [user] }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "numAssets" }),
  ]);

  const assetInfos = await Promise.all(
    Array.from({ length: numAssets }, (_, i) =>
      client.readContract({ address: comet, abi: cometAbi, functionName: "getAssetInfo", args: [i] }),
    ),
  );
  const collateralBalances = await Promise.all(
    assetInfos.map((info) =>
      client.readContract({ address: comet, abi: cometAbi, functionName: "userCollateral", args: [user, info.asset] }),
    ),
  );

  const involved = assetInfos.filter((_, i) => collateralBalances[i][0] > 0n);
  if (borrowRaw === 0n && baseSupplyRaw === 0n && involved.length === 0) return null;

  const toUsd = market.ethDenominated ? await getEthUsdPrice(chain) : 1;

  const [baseScale, basePriceFeed] = await Promise.all([
    client.readContract({ address: comet, abi: cometAbi, functionName: "baseScale" }),
    client.readContract({ address: comet, abi: cometAbi, functionName: "baseTokenPriceFeed" }),
  ]);
  const [basePriceRaw, ...collateralPrices] = await Promise.all([
    client.readContract({ address: comet, abi: cometAbi, functionName: "getPrice", args: [basePriceFeed] }),
    ...involved.map((info) =>
      client.readContract({ address: comet, abi: cometAbi, functionName: "getPrice", args: [info.priceFeed] }),
    ),
  ]);
  const symbols = await Promise.all(
    involved.map((info) =>
      client.readContract({ address: info.asset, abi: erc20Abi, functionName: "symbol" }).catch(() => "?"),
    ),
  );

  const basePriceUsd = (Number(basePriceRaw) / PRICE_UNIT) * toUsd;
  const borrowAmount = Number(borrowRaw) / Number(baseScale);
  const debtUsd = round(borrowAmount * basePriceUsd, 2);

  const collateralAssets: NormalizedPosition["collateralAssets"] = [];
  const legs: CollateralLeg[] = [];
  let collateralUsd = 0;

  involved.forEach((info, i) => {
    const priceUsd = (Number(collateralPrices[i]) / PRICE_UNIT) * toUsd;
    const amount = Number(collateralBalances[assetInfos.indexOf(info)][0]) / Number(info.scale);
    const usdValue = round(amount * priceUsd, 2);
    collateralUsd += usdValue;
    collateralAssets.push({ symbol: symbols[i], amount: round(amount, 6), usdValue });
    legs.push({
      symbol: symbols[i],
      usdValue,
      priceUsd,
      liquidationThreshold: Number(info.liquidateCollateralFactor) / 1e18,
    });
  });

  if (baseSupplyRaw > 0n) {
    const amount = Number(baseSupplyRaw) / Number(baseScale);
    const usdValue = round(amount * basePriceUsd, 2);
    collateralUsd += usdValue;
    // Supplied base earns yield but is not liquidatable collateral — no risk leg.
    collateralAssets.push({ symbol: `${market.label} (supplied)`, amount: round(amount, 6), usdValue });
  }

  if (collateralUsd < DUST_USD && debtUsd < DUST_USD) return null;

  const weighted = legs.reduce((s, l) => s + l.usdValue * l.liquidationThreshold, 0);
  const healthFactor = debtUsd <= 0 ? Infinity : round(weighted / debtUsd, 4);
  const dominant = dominantLiquidationPrice(legs, debtUsd);

  return {
    protocol: "compound-v3",
    chain,
    market: market.label,
    collateralUsd: round(collateralUsd, 2),
    debtUsd,
    healthFactor,
    tier: tierFor(healthFactor),
    liquidationPrice: dominant?.liquidationPriceUsd ?? null,
    dominantCollateral: dominant ?? null,
    dropToLiquidationPct: dominant?.dropToLiquidationPct ?? null,
    collateralAssets,
    debtAssets: debtUsd > 0 ? [{ symbol: market.label, amount: round(borrowAmount, 6), usdValue: debtUsd }] : [],
  };
}

export const CompoundV3Adapter: ProtocolAdapter = {
  protocol: "compound-v3",
  supportedChains: ["ethereum", "base", "arbitrum"],
  async getPositions(chain, wallet) {
    const markets = MARKETS[chain];
    if (!markets) return [];
    const client = getClient(chain);
    const results = await Promise.all(markets.map((m) => readMarket(client, chain, m, wallet)));
    return results.filter((r): r is NormalizedPosition => r !== null);
  },
};
