/**
 * LiquiScope A2MCP endpoints.
 *
 *   GET  /health  — liveness probe
 *   POST /check   — FREE: single-chain quick health factor + risk tier
 *                   body: { "address": "0x…", "chain": "base"|"ethereum"|"arbitrum"|"optimism" (default base) }
 *   POST /report  — x402-PAID ($0.15 USDT, X Layer): full cross-protocol,
 *                   cross-chain liquidation-risk report — every adapter
 *                   (Aave v3, Compound v3) × every supported chain, in one call.
 *
 * Never 500s on upstream trouble: one adapter×chain hiccup degrades that
 * slice (recorded in errors + the coverage matrix), never the whole scan;
 * LLM failures fall back to a deterministic summary.
 */

import { getAddress, type Address } from "viem";
import { ADAPTERS, aggregatePortfolio, coverageMatrix, scanWallet } from "./engine/scan";
import { CHAINS } from "./engine/rpc";
import type { ChainKey } from "./engine/types";
import { toCompatPosition } from "./report/compat";
import { computePortfolioScore } from "./report/portfolioScore";
import { computeRecommendations } from "./report/recommendations";
import { computeStressScenario, parseStressPct } from "./report/stress";
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

/**
 * Free tier — deliberately unchanged behavior and response shape from the
 * single-protocol, 3-chain build: single chain, quick HF, same field names
 * (totalCollateralUsd/totalDebtUsd survive here even though the engine's
 * internal NormalizedPosition renamed them to collateralUsd/debtUsd — this
 * is the back-compat seam). The only additive change is a 4th chain choice.
 */
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
      totalCollateralUsd: p.collateralUsd,
      totalDebtUsd: p.debtUsd,
    })),
    note:
      scan.positions.length === 0
        ? `No lending positions found on ${chain} (positions under $1 are ignored).`
        : "Full cross-protocol, cross-chain report with liquidation prices, %-drop-to-liquidation and recommendations: POST /report (x402, $0.15).",
    timestamp: new Date().toISOString(),
  });
}

/**
 * Paid tier — the upgraded product: every adapter × every supported chain,
 * fanned out in parallel, with a portfolio-level aggregate and a coverage
 * matrix so the caller can see exactly what was (and wasn't) checked.
 */
async function handleReport(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const resourceUrl = url.origin + "/report";
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

  const stressParam = parseStressPct(url.searchParams.get("stress_pct"));
  if ("error" in stressParam) {
    return json({ error: stressParam.error }, 400, { "PAYMENT-RESPONSE": paymentResponseHeader(payment.settlement) });
  }

  const scans = await scanWallet(address);
  const positions = scans.flatMap((s) => s.positions);
  const errors = scans.flatMap((s) => s.errors.map((e) => ({ chain: s.chain, ...e })));
  const coverage = coverageMatrix(scans);
  const totalSources = coverage.filter((c) => c.status !== "unsupported").length;
  const failedSources = coverage.filter((c) => c.status === "error").length;
  if (positions.length === 0 && totalSources > 0 && failedSources === totalSources) {
    return json({ error: "all upstream data sources unavailable, retry shortly", detail: errors, coverage }, 503);
  }

  const { summary, source } = await generateSummary(scans, env.ANTHROPIC_API_KEY);
  const portfolio = aggregatePortfolio(scans);
  // Same string format the field has always had ("protocol (chain, chain, …)"),
  // now correctly reflecting real coverage instead of the old hardcoded 3/2-chain
  // lists. Field name/type unchanged from the live, reviewed response — see
  // report/compat.ts for the full additive-only contract this endpoint honors.
  const protocolsSummary = ADAPTERS.map((a) => `${a.protocol} (${a.supportedChains.join(", ")})`);

  const portfolioScore = computePortfolioScore(positions);
  const recommendations = computeRecommendations(positions);
  const stressScenario = stressParam.value !== 0 ? computeStressScenario(positions, stressParam.value) : undefined;

  return json(
    {
      service: "liquiscope-report",
      address,
      chainsScanned: scans.map((s) => s.chain),
      protocols: protocolsSummary, // unchanged field name — content now accurate for 4 chains
      protocolsScanned: protocolsSummary, // new, additive — same content, forward-looking name
      overallRiskTier: portfolio.overallTier,
      recommendation:
        portfolio.overallTier === "none" ? "No debt anywhere — nothing can be liquidated." : RECOMMENDATIONS[portfolio.overallTier],
      portfolio: {
        totalCollateralUsd: portfolio.totalCollateralUsd,
        totalDebtUsd: portfolio.totalDebtUsd,
        positionCount: portfolio.positionCount,
        riskiestPosition: portfolio.riskiestPosition ? toCompatPosition(portfolio.riskiestPosition) : null,
      },
      portfolio_score: portfolioScore, // new, additive
      recommendations, // new, additive — one entry per position below the comfortable HF band, empty array if none
      stress_scenario: stressScenario, // new, additive — present only when ?stress_pct= was supplied
      summary,
      summarySource: source,
      positions: positions.map(toCompatPosition),
      coverage,
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
          description: "Cross-protocol, cross-chain DeFi liquidation-risk reports (Aave v3 + Compound v3, across Ethereum/Base/Arbitrum/Optimism)",
          endpoints: {
            "POST /check": "free — single-chain quick health factor + risk tier { address, chain? }",
            "POST /report": "x402-paid — full cross-protocol, cross-chain analysis { address }, plus portfolio_score, recommendations, and an optional ?stress_pct=-20 hypothetical price-move scenario",
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
