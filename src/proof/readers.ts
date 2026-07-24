/**
 * GET /proof's read layer: lean HF-only readers (getHealthFactorAt, defined
 * alongside each protocol's ABI/addresses in its adapter file), NOT the full
 * ProtocolAdapter used by /report and /watch. Same reasoning documented on
 * each getHealthFactorAt: historical (block-pinned) reads don't multicall-
 * batch across a trajectory's distinct block numbers the way live same-block
 * reads do, so the full per-position read (~10 subrequests, measured) times
 * TRAJECTORY_SAMPLES would blow well past the free Workers plan's
 * 50-subrequest/invocation ceiling. The lean readers compute the exact same
 * health factor via the exact same formula — Aave's on-chain aggregate,
 * Compound's weighted-collateral/debt sum — just without the display-only
 * reads (per-asset symbols, full breakdown) a trajectory point doesn't need.
 */

import type { Address } from "viem";
import { AaveV3Adapter, getHealthFactorAt as aaveHealthFactorAt } from "../engine/adapters/aaveV3";
import { CompoundV3Adapter, getHealthFactorAt as compoundHealthFactorAt } from "../engine/adapters/compoundV3";
import type { ChainKey, Protocol } from "../engine/types";

export type HfReading = { market: string; healthFactor: number };
export type HfReader = (chain: ChainKey, wallet: Address, blockNumber?: bigint) => Promise<HfReading[]>;

export interface ProofSource {
  protocol: Protocol;
  supportedChains: ChainKey[];
  read: HfReader;
}

export const PROOF_SOURCES: ProofSource[] = [
  { protocol: "aave-v3", supportedChains: AaveV3Adapter.supportedChains, read: aaveHealthFactorAt },
  { protocol: "compound-v3", supportedChains: CompoundV3Adapter.supportedChains, read: compoundHealthFactorAt },
];
