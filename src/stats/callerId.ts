/**
 * Caller identity for /stats classification — reuses the payer address
 * x402 settlement already exposes for paid calls (no new identity system);
 * free calls fall back to a one-way hash of the connecting IP. The raw IP
 * is never stored, logged, or returned — only its SHA-256 hex digest is
 * computed transiently to classify the call, and even that digest itself
 * is never persisted (only the resulting self/external/unclassified bucket
 * is, in stats/store.ts's counters).
 */

import { PAY_TO } from "../x402";

export type CallClass = "self" | "external" | "unclassified";

/**
 * The demo agent's own funded wallet (liquiscope-demo-agent, a separate
 * standalone repo — its whole job is to be a real, transparently self-
 * tagged consumer of these endpoints for demo/evidence purposes, not
 * disguised as external traffic). Not a secret — this is a public wallet
 * address, safe to hardcode; the private key lives only in that repo's
 * git-ignored .env.
 */
const DEMO_AGENT_WALLET = "0x616A2DB0d112d70C20D7044cf5D1Ea37e550B515";

/**
 * "Our own" caller ids: the LiquiScope Agentic Wallet itself (self-payment
 * test calls, see docs/build-journal.md's first settled-payment entry) and
 * the demo agent's wallet above. No IP-hash entries are hardcoded here: we
 * don't have a stable, known dev/demo IP to pin, and guessing one would
 * misclassify real external callers who happen to share it —
 * "unclassified" is the honest answer until one exists.
 */
const SELF_CALLER_IDS = new Set<string>([`wallet:${PAY_TO.toLowerCase()}`, `wallet:${DEMO_AGENT_WALLET.toLowerCase()}`]);

async function hashIp(ip: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  return "iphash:" + Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** From a resolved x402 settlement's `payer` field — null if absent/malformed (falls back to unclassified, never guessed). */
export function callerIdFromPayer(payer: unknown): string | null {
  if (typeof payer !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(payer)) return null;
  return `wallet:${payer.toLowerCase()}`;
}

/** IP-hash fallback for calls with no payer identity (free /check, or a paid call with no settlement info). Null if no IP header is present at all. */
export async function callerIdFromRequest(request: Request): Promise<string | null> {
  const ip = request.headers.get("cf-connecting-ip");
  if (!ip) return null;
  return hashIp(ip);
}

export function classify(callerId: string | null): CallClass {
  if (callerId === null) return "unclassified";
  return SELF_CALLER_IDS.has(callerId) ? "self" : "external";
}
