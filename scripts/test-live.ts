/**
 * Live engine test against mainnet data (run: npm run test:live).
 *
 * Discovers real wallets from recent Aave Borrow / Compound Withdraw(borrow)
 * events, scans them, and prints compact results. Also exercises the empty
 * wallet path. Exits nonzero if any scan slice errors or invariants break.
 */

import { parseAbiItem, type Address } from "viem";
import { resolveContracts } from "../src/engine/aave";
import { getClient } from "../src/engine/rpc";
import { scanWallet } from "../src/engine/scan";

const borrowEvent = parseAbiItem(
  "event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)",
);

async function recentAaveBorrowers(chain: "ethereum" | "base" | "arbitrum", n: number): Promise<Address[]> {
  const client = getClient(chain);
  const { pool } = await resolveContracts(chain, client);
  const head = await client.getBlockNumber();
  // Free RPCs cap eth_getLogs at ~50 blocks; walk back in windows until we have n users.
  const WINDOW = 49n;
  const users = new Set<Address>();
  for (let to = head, i = 0; users.size < n && i < 120; to -= WINDOW + 1n, i++) {
    const logs = await client.getLogs({ address: pool, event: borrowEvent, fromBlock: to - WINDOW, toBlock: to });
    for (const l of logs) users.add(l.args.onBehalfOf!);
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
          ` coll=$${p.totalCollateralUsd} debt=$${p.totalDebtUsd}` +
          (d ? ` | ${d.symbol} $${d.currentPriceUsd.toFixed(2)} → liq $${d.liquidationPriceUsd.toFixed(2)} (-${(d.dropToLiquidation * 100).toFixed(1)}%)` : ""),
      );
      // Invariants
      if (p.totalDebtUsd > 0 && !(p.healthFactor > 0)) { failures++; console.log("  !! bad HF"); }
      if (d && (d.liquidationPriceUsd > d.currentPriceUsd || d.dropToLiquidation < 0 || d.dropToLiquidation > 1)) {
        failures++; console.log("  !! bad liquidation price math");
      }
    }
  }
  console.log(`  (${ms}ms, ${scans.reduce((s, c) => s + c.positions.length, 0)} positions)`);
}

const cometWithdraw = parseAbiItem("event Withdraw(address indexed src, address indexed to, uint256 amount)");

/** Comet borrows surface as base-token Withdraws; scan recent ones on Base USDC + WETH comets. */
async function recentCompoundUsers(n: number): Promise<Address[]> {
  const client = getClient("base");
  const comets: Address[] = [
    "0xb125E6687d4313864e53df431d5425969c15Eb2F", // USDC
    "0x46e6b214b524310239732D51387075E0e70970bf", // WETH (exercises ETH-denominated feeds)
  ];
  const head = await client.getBlockNumber();
  const WINDOW = 49n;
  const users = new Set<Address>();
  for (let to = head, i = 0; users.size < n && i < 120; to -= WINDOW + 1n, i++) {
    for (const comet of comets) {
      const logs = await client.getLogs({ address: comet, event: cometWithdraw, fromBlock: to - WINDOW, toBlock: to });
      for (const l of logs) users.add(l.args.src!);
    }
  }
  return [...users].slice(0, n);
}

async function main() {
  const [ethB, baseB, arbB, compU] = await Promise.all([
    recentAaveBorrowers("ethereum", 2),
    recentAaveBorrowers("base", 2),
    recentAaveBorrowers("arbitrum", 2),
    recentCompoundUsers(3),
  ]);
  console.log("discovered:", { ethereum: ethB, base: baseB, arbitrum: arbB, compound: compU });

  for (const [i, a] of [...ethB, ...baseB, ...arbB].entries()) await scanAndPrint(`borrower ${i}`, a);
  for (const [i, a] of compU.entries()) await scanAndPrint(`compound user ${i}`, a);

  // Genuinely empty wallet: random address with no history (lowercase — checksum-free form)
  await scanAndPrint("empty wallet", "0x7c31e64c7dbcf7a973d26fdec55169bd35d20214");

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("fatal:", e);
  process.exit(1);
});
