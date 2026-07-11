/**
 * LiquiScope A2MCP endpoints.
 *
 *   GET  /health  — liveness probe
 *   POST /check   — FREE: single-chain health factor + risk tier
 *                   body: { "address": "0x…", "chain": "base"|"ethereum"|"arbitrum" (default base) }
 *   POST /report  — x402-PAID ($0.15 USDT, X Layer): full multi-chain analysis
 *                   body: { "address": "0x…" }
 *
 * Never 500s on upstream trouble: RPC failures degrade to partial results or
 * 503, LLM failures fall back to a deterministic summary.
 */

import { getAddress, isAddress, type Address } from "viem";
import { scanWallet } from "./engine/scan";
import { CHAINS } from "./engine/rpc";
import type { ChainKey } from "./engine/types";
import { generateSummary } from "./report/summary";
import { RECOMMENDATIONS, worstTier } from "./report/template";
import { challenge402, paymentResponseHeader, processPayment, type X402Env } from "./x402";

interface Env extends X402Env {
  ANTHROPIC_API_KEY?: string;
}

const json = (data: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", ...headers } });

function parseAddress(raw: unknown): Address | null {
  if (typeof raw !== "string") return null;
  const candidate = raw.trim();
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) return null;
  try {
    return getAddress(candidate.toLowerCase()); // normalize case; tolerate bad checksums
  } catch {
    return null;
  }
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as Record<string, unknown>;
    return body && typeof body === "object" ? body : {};
  } catch {
    return {};
  }
}

// Best-effort per-isolate rate limit for the free endpoint (reliability, not security).
const RATE_LIMIT = 30; // requests per window
const WINDOW_MS = 60_000;
const hits = new Map<string, { count: number; windowStart: number }>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    hits.set(ip, { count: 1, windowStart: now });
    if (hits.size > 10_000) hits.clear();
    return false;
  }
  entry.count++;
  return entry.count > RATE_LIMIT;
}

async function handleCheck(request: Request): Promise<Response> {
  const body = await readBody(request);
  const address = parseAddress(body.address ?? body.wallet ?? body.walletAddress);
  if (!address) {
    return json({ error: "missing or invalid 'address' — expected a 0x… EVM address (40 hex chars)" }, 400);
  }
  const chainRaw = String(body.chain ?? "base").toLowerCase();
  const chain = (CHAINS as string[]).includes(chainRaw) ? (chainRaw as ChainKey) : null;
  if (!chain) {
    return json({ error: `unsupported chain '${chainRaw}' — use one of: ${CHAINS.join(", ")}` }, 400);
  }

  const [scan] = await scanWallet(address, [chain]);
  if (scan.positions.length === 0 && scan.errors.length > 0) {
    return json({ error: "upstream data sources unavailable, retry shortly", detail: scan.errors }, 503);
  }

  const tier = worstTier(scan.positions);
  return json({
    service: "liquiscope-check",
    address,
    chain,
    riskTier: tier,
    positions: scan.positions.map((p) => ({
      protocol: p.protocol,
      market: p.market,
      healthFactor: p.healthFactor === Infinity ? null : p.healthFactor,
      tier: p.tier,
      totalCollateralUsd: p.totalCollateralUsd,
      totalDebtUsd: p.totalDebtUsd,
    })),
    note:
      scan.positions.length === 0
        ? `No Aave v3 / Compound v3 positions found on ${chain} (positions under $1 are ignored).`
        : "Full multi-chain report with liquidation prices, %-drop-to-liquidation and recommendations: POST /report (x402, $0.15).",
    timestamp: new Date().toISOString(),
  });
}

async function handleReport(request: Request, env: Env): Promise<Response> {
  const resourceUrl = new URL(request.url).origin + "/report";
  const payment = await processPayment(request, resourceUrl, env);
  if (payment === null) return challenge402(resourceUrl);
  if (!payment.ok) return json({ error: payment.error }, payment.status);

  const body = await readBody(request);
  const address = parseAddress(body.address ?? body.wallet ?? body.walletAddress);
  if (!address) {
    // Paid but bad input: still answer with a clear error (settlement already happened;
    // callers should fix the address and retry — the check endpoint is free for testing).
    return json({ error: "missing or invalid 'address' — expected a 0x… EVM address (40 hex chars)" }, 400, {
      "PAYMENT-RESPONSE": paymentResponseHeader(payment.settlement),
    });
  }

  const scans = await scanWallet(address);
  const positions = scans.flatMap((s) => s.positions);
  const errors = scans.flatMap((s) => s.errors.map((e) => ({ chain: s.chain, ...e })));
  if (positions.length === 0 && errors.length >= 5) {
    return json({ error: "all upstream data sources unavailable, retry shortly", detail: errors }, 503);
  }

  const { summary, source } = await generateSummary(scans, env.ANTHROPIC_API_KEY);
  const tier = worstTier(positions);

  return json(
    {
      service: "liquiscope-report",
      address,
      chainsScanned: scans.map((s) => s.chain),
      protocols: ["aave-v3 (ethereum, base, arbitrum)", "compound-v3 (base, arbitrum)"],
      overallRiskTier: tier,
      recommendation: tier === "none" ? "No debt anywhere — nothing can be liquidated." : RECOMMENDATIONS[tier],
      summary,
      summarySource: source,
      positions,
      partialErrors: errors.length > 0 ? errors : undefined,
      timestamp: new Date().toISOString(),
    },
    200,
    { "PAYMENT-RESPONSE": paymentResponseHeader(payment.settlement) },
  );
}

export default {
  /** Cron self-check: full engine path against a fixture wallet; logged for `wrangler tail`. */
  async scheduled(_event: unknown, _env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    ctx.waitUntil(
      (async () => {
        const t0 = Date.now();
        try {
          const scans = await scanWallet("0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4", ["arbitrum"]);
          const errors = scans.flatMap((s) => s.errors);
          console.log(
            JSON.stringify({ selfCheck: errors.length === 0 ? "ok" : "degraded", ms: Date.now() - t0, positions: scans[0].positions.length, errors }),
          );
        } catch (e) {
          console.log(JSON.stringify({ selfCheck: "failed", ms: Date.now() - t0, error: e instanceof Error ? e.message : String(e) }));
        }
      })(),
    );
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ status: "ok", service: "liquiscope" });

      if (url.pathname === "/check") {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        if (rateLimited(ip)) return json({ error: "rate limit exceeded (30/min) — please slow down" }, 429);
        return await handleCheck(request);
      }

      if (url.pathname === "/report") {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        return await handleReport(request, env);
      }

      return json(
        {
          service: "LiquiScope",
          description: "DeFi liquidation-risk reports (Aave v3 + Compound v3)",
          endpoints: {
            "POST /check": "free — single-chain health factor + risk tier { address, chain? }",
            "POST /report": "x402-paid — full multi-chain analysis { address }",
          },
        },
        404,
      );
    } catch (e) {
      // Last-resort guard: degrade, never a bare 500.
      return json({ error: "temporary internal error, retry shortly", detail: e instanceof Error ? e.message : String(e) }, 503);
    }
  },
};
