/**
 * Live engine test against mainnet data (run: npm run test:live).
 *
 * Discovers real wallets from recent Aave Borrow / Compound Withdraw(borrow)
 * events across all 4 chains, scans them, and prints compact results. Also
 * exercises the empty wallet path and prints a protocol × chain coverage
 * matrix. Exits nonzero if any scan slice errors or invariants break.
 */

import { parseAbiItem, type Address } from "viem";
import { resolveContracts } from "../src/engine/adapters/aaveV3";
import { getClient } from "../src/engine/rpc";
import { coverageMatrix, scanWallet } from "../src/engine/scan";
import type { ChainKey } from "../src/engine/types";

const borrowEvent = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

// Free RPCs sometimes reject eth_getLogs beyond a short live window with a
// *formatted* RPC error ("archive data requires a token") rather than a
// network failure — viem's fallback transport (rank: false) doesn't treat
// that as a reason to rotate to the next RPC, so a naive "keep walking
// windows" loop can burn many minutes retrying the same unresponsive RPC.
// Bound total wall time per discovery call instead of trusting the per-call
// http() timeout to add up to something reasonable.
const DISCOVERY_BUDGET_MS = 20_000;

async function recentAaveBorrowers(chain: ChainKey, n: number): Promise<Address[]> {
  const client = getClient(chain);
  const { pool } = await resolveContracts(chain, client);
  const head = await client.getBlockNumber();
  const WINDOW = 49n;
  const users = new Set<Address>();
  const deadline = Date.now() + DISCOVERY_BUDGET_MS;
  for (let to = head, i = 0; users.size < n && i < 120 && Date.now() < deadline; to -= WINDOW + 1n, i++) {
    try {
      const logs = await client.getLogs({ address: pool, event: borrowEvent, fromBlock: to - WINDOW, toBlock: to });
      for (const l of logs) users.add(l.args.onBehalfOf!);
    } catch (e) {
      console.log(`  (skipping window ${to - WINDOW}-${to} on ${chain}: ${e instanceof Error ? e.message.slice(0, 80) : e})`);
    }
  }
  return [...users].slice(0, n);
}

function fmt(n: number): string {
  return n === Infinity ? "∞" : n.toFixed(4);
}

let failures = 0;

async function scanAndPrint(label: string, addr: Address) {
  console.log(`\n=== ${label}: ${addr}`);
  const t0 = Date.now();
  const scans = await scanWallet(addr);
  const ms = Date.now() - t0;
  for (const s of scans) {
    for (const e of s.errors) {
      failures++;
      console.log(`  !! ${s.chain}/${e.protocol} ERROR: ${e.error.slice(0, 200)}`);
    }
    for (const p of s.positions) {
      const d = p.dominantCollateral;
      console.log(
        `  ${s.chain}/${p.protocol}[${p.market}] HF=${fmt(p.healthFactor)} tier=${p.tier}` +
          ` coll=$${p.collateralUsd} debt=$${p.debtUsd}` +
          (d ? ` | ${d.symbol} $${d.currentPriceUsd.toFixed(2)} → liq $${d.liquidationPriceUsd.toFixed(2)} (-${(d.dropToLiquidationPct * 100).toFixed(1)}%)` : ""),
      );
      // Invariants
      if (p.debtUsd > 0 && !(p.healthFactor > 0)) { failures++; console.log("  !! bad HF"); }
      if (d && (d.liquidationPriceUsd > d.currentPriceUsd || d.dropToLiquidationPct < 0 || d.dropToLiquidationPct > 1)) {
        failures++; console.log("  !! bad liquidation price math");
      }
      if (p.liquidationPrice !== (d?.liquidationPriceUsd ?? null)) { failures++; console.log("  !! liquidationPrice mirror mismatch"); }
      if (p.dropToLiquidationPct !== (d?.dropToLiquidationPct ?? null)) { failures++; console.log("  !! dropToLiquidationPct mirror mismatch"); }
    }
  }
  console.log(`  (${ms}ms, ${scans.reduce((s, c) => s + c.positions.length, 0)} positions)`);
}

const cometWithdraw = parseAbiItem("event Withdraw(address indexed src, address indexed to, uint256 amount)");

/** Comet borrows surface as base-token Withdraws; scan recent ones on the given chain's comets. */
async function recentCompoundUsers(chain: ChainKey, comets: Address[], n: number): Promise<Address[]> {
  const client = getClient(chain);
  const head = await client.getBlockNumber();
  const WINDOW = 49n;
  const users = new Set<Address>();
  const deadline = Date.now() + DISCOVERY_BUDGET_MS;
  for (let to = head, i = 0; users.size < n && i < 120 && Date.now() < deadline; to -= WINDOW + 1n, i++) {
    for (const comet of comets) {
      try {
        const logs = await client.getLogs({ address: comet, event: cometWithdraw, fromBlock: to - WINDOW, toBlock: to });
        for (const l of logs) users.add(l.args.src!);
      } catch (e) {
        console.log(`  (skipping window ${to - WINDOW}-${to} on ${chain}/${comet}: ${e instanceof Error ? e.message.slice(0, 80) : e})`);
      }
    }
  }
  return [...users].slice(0, n);
}

async function main() {
  const [ethB, baseB, arbB, opB, compBase, compEth] = await Promise.all([
    recentAaveBorrowers("ethereum", 2),
    recentAaveBorrowers("base", 2),
    recentAaveBorrowers("arbitrum", 2),
    recentAaveBorrowers("optimism", 2),
    recentCompoundUsers(
      "base",
      ["0xb125E6687d4313864e53df431d5425969c15Eb2F", "0x46e6b214b524310239732D51387075E0e70970bf"],
      2,
    ),
    recentCompoundUsers(
      "ethereum",
      ["0xc3d688B66703497DAA19211EEdff47f25384cdc3", "0xA17581A9E3356d9A858b789D68B4d866e593aE94"],
      2,
    ),
  ]);
  console.log("discovered:", { ethereum: ethB, base: baseB, arbitrum: arbB, optimism: opB, compoundBase: compBase, compoundEthereum: compEth });

  for (const [i, a] of [...ethB, ...baseB, ...arbB, ...opB].entries()) await scanAndPrint(`aave borrower ${i}`, a);
  for (const [i, a] of compBase.entries()) await scanAndPrint(`compound/base user ${i}`, a);
  for (const [i, a] of compEth.entries()) await scanAndPrint(`compound/ethereum user ${i}`, a);

  // Genuinely empty wallet: random address with no history (lowercase — checksum-free form)
  await scanAndPrint("empty wallet", "0x7c31e64c7dbcf7a973d26fdec55169bd35d20214");

  // Coverage matrix — protocol × chain, using the empty wallet's scan as the connectivity probe
  // (a genuinely empty wallet still hits every RPC/contract; only network health affects it).
  const probeScans = await scanWallet("0x7c31e64c7dbcf7a973d26fdec55169bd35d20214");
  console.log("\n=== coverage matrix (protocol × chain) ===");
  for (const c of coverageMatrix(probeScans)) {
    const mark = c.status === "ok" ? "✅" : c.status === "beta" ? "🧪" : c.status === "unsupported" ? "—" : "❌";
    console.log(`  ${mark} ${c.protocol.padEnd(14)} ${c.chain.padEnd(10)} ${c.status}${c.error ? `  (${c.error.slice(0, 80)})` : ""}`);
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
