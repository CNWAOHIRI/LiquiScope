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
   */
  getPositions(chain: ChainKey, wallet: Address): Promise<NormalizedPosition[]>;
}
