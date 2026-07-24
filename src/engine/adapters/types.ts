/**
 * The adapter contract. "One brain, many protocols": every lending protocol
 * we support implements this interface and only this interface. The scan
 * orchestrator (../scan.ts) and everything downstream of it never import a
 * protocol-specific module directly — they hold an array of ProtocolAdapter
 * and iterate it. Adding a new protocol means adding one adapter file and one
 * registry entry; it never touches scan.ts, the report layer, or endpoints.
 */

import type { Address } from "viem";
import type { ChainKey, NormalizedPosition, Protocol } from "../types";

export interface ProtocolAdapter {
  readonly protocol: Protocol;
  readonly supportedChains: ChainKey[];
  /**
   * Read a wallet's positions on this protocol for one chain. Returns an
   * empty array for "no positions" (never null/undefined) — dust and
   * zero-balance positions are already filtered out by the adapter. Throws
   * on read failure; the orchestrator is responsible for the timeout and
   * per-source error isolation, not the adapter itself.
   *
   * `blockNumber`, when given, pins every on-chain read to that historical
   * block instead of "latest" — used by GET /proof to replay past health
   * factors with the exact same math and same code path as a live read
   * (never a separate/approximate historical model). Omitted (undefined)
   * for every existing caller — additive, and the on-chain infra addresses
   * (pool/oracle/data-provider) are still resolved at their CURRENT
   * addresses even for historical reads, since these are immutable
   * proxies that don't change across a market's lifetime; only the state
   * values (balances, prices) are read as-of the historical block.
   */
  getPositions(chain: ChainKey, wallet: Address, blockNumber?: bigint): Promise<NormalizedPosition[]>;
}
