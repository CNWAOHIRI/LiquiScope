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
import type { ChainKey, Protocol } from "./engine/types";
import { toCompatPosition } from "./report/compat";
import { computePortfolioScore } from "./report/portfolioScore";
import { computeRecommendations } from "./report/recommendations";
import { computeStressScenario, parseStressPct } from "./report/stress";
import { generateSummary } from "./report/summary";
import { RECOMMENDATIONS, worstTier } from "./report/template";
import { challenge402, paymentResponseHeader, processPayment, PRICE_ATOMIC, type X402Env } from "./x402";
import { runWatchCron } from "./watch/cron";
import { computeWatchPriceAtomic, MAX_DURATION_DAYS, MIN_DURATION_DAYS, watchDescription } from "./watch/pricing";
import { createSubscription, findSubscription } from "./watch/storage";
import { toStatus, type WatchSubscription } from "./watch/types";
import { probeLookback } from "./proof/lookback";
import { replayTrajectory } from "./proof/replay";
import { PROOF_SOURCES } from "./proof/readers";
import { callerIdFromPayer, callerIdFromRequest, classify } from "./stats/callerId";
import { readStats, recordCall } from "./stats/store";

type Ctx = { waitUntil(p: Promise<unknown>): void };

interface Env extends X402Env {
  ANTHROPIC_API_KEY?: string;
  WATCH_KV: KVNamespace;
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
async function handleCheck(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  ctx.waitUntil(
    callerIdFromRequest(request).then((id) => recordCall(env.WATCH_KV, classify(id))),
  );
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
async function handleReport(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const resourceUrl = url.origin + "/report";
  const payment = await processPayment(request, resourceUrl, env);
  if (payment === null) return challenge402(resourceUrl);
  if (!payment.ok) return json({ error: payment.error }, payment.status);
  ctx.waitUntil(
    (async () => {
      const id = callerIdFromPayer(payment.settlement.payer) ?? (await callerIdFromRequest(request));
      await recordCall(env.WATCH_KV, classify(id));
    })(),
  );

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

const PROTOCOLS: Protocol[] = ["aave-v3", "compound-v3"];

function parseWebhookUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * POST /watch — x402-paid, price scaled by duration_days (see watch/pricing.ts).
 * Creates a standing health-factor alert subscription, checked on a cron
 * schedule (watch/cron.ts) and delivered via webhook only in v1.
 */
async function handleWatchCreate(request: Request, env: Env, ctx: Ctx): Promise<Response> {
  const url = new URL(request.url);
  const body = await readBody(request);

  const durationRaw = Number(body.duration_days);
  if (!Number.isInteger(durationRaw) || durationRaw < MIN_DURATION_DAYS || durationRaw > MAX_DURATION_DAYS) {
    return json({ error: `'duration_days' must be an integer between ${MIN_DURATION_DAYS} and ${MAX_DURATION_DAYS}` }, 400);
  }
  const durationDays = durationRaw;

  // Payment amount depends on duration_days, so the resource URL is duration-specific —
  // matches x402's model of "this exact resource costs this exact amount."
  const resourceUrl = `${url.origin}/watch?duration_days=${durationDays}`;
  const amountAtomic = computeWatchPriceAtomic(durationDays);
  const description = watchDescription(durationDays);

  const payment = await processPayment(request, resourceUrl, env, amountAtomic, description);
  if (payment === null) return challenge402(resourceUrl, amountAtomic, description);
  if (!payment.ok) return json({ error: payment.error }, payment.status);
  ctx.waitUntil(
    (async () => {
      const id = callerIdFromPayer(payment.settlement.payer) ?? (await callerIdFromRequest(request));
      await recordCall(env.WATCH_KV, classify(id));
    })(),
  );

  const paymentHeaders = { "PAYMENT-RESPONSE": paymentResponseHeader(payment.settlement) };

  const address = parseAddress(body.address ?? body.wallet ?? body.walletAddress);
  if (!address) {
    return json({ error: "missing or invalid 'wallet' — expected a 0x… EVM address (40 hex chars)" }, 400, paymentHeaders);
  }
  const chainRaw = String(body.chain ?? "").toLowerCase();
  const chain = (CHAINS as string[]).includes(chainRaw) ? (chainRaw as ChainKey) : null;
  if (!chain) {
    return json({ error: `missing or unsupported 'chain' — use one of: ${CHAINS.join(", ")}` }, 400, paymentHeaders);
  }
  const protocolRaw = String(body.protocol ?? "");
  const protocol = (PROTOCOLS as string[]).includes(protocolRaw) ? (protocolRaw as Protocol) : null;
  if (!protocol) {
    return json({ error: `missing or unsupported 'protocol' — use one of: ${PROTOCOLS.join(", ")}` }, 400, paymentHeaders);
  }
  const hfThreshold = Number(body.hf_threshold);
  if (!Number.isFinite(hfThreshold) || hfThreshold <= 1.0 || hfThreshold > 3.0) {
    return json({ error: "'hf_threshold' must be a number greater than 1.0 and at most 3.0" }, 400, paymentHeaders);
  }
  const notifyWebhook = parseWebhookUrl(body.notify_webhook);
  if (!notifyWebhook) {
    return json({ error: "missing or invalid 'notify_webhook' — expected an http(s):// URL" }, 400, paymentHeaders);
  }

  const now = new Date();
  const sub: WatchSubscription = {
    id: crypto.randomUUID(),
    wallet: address,
    chain,
    protocol,
    hf_threshold: hfThreshold,
    notify_webhook: notifyWebhook,
    created_at: now.toISOString(),
    expires_at: new Date(now.getTime() + durationDays * 86_400_000).toISOString(),
    last_checked_hf: null,
    last_checked_at: null,
    alert_state: "ok",
    last_alert_sent_at: null,
    check_seq: 0,
  };

  const { shard } = await createSubscription(env.WATCH_KV, sub);

  return json(
    {
      service: "liquiscope-watch",
      ...toStatus(sub),
      shard,
      check_interval_note: "Checked on a rotating cron schedule; latency scales gracefully with total subscriber count — see GET /watch/:id/status for last_checked_at.",
    },
    201,
    paymentHeaders,
  );
}

/** GET /watch/:id/status — free. */
async function handleWatchStatus(id: string, env: Env): Promise<Response> {
  const sub = await findSubscription(env.WATCH_KV, id);
  if (!sub) return json({ error: "no subscription found for this id" }, 404);
  return json({ service: "liquiscope-watch-status", ...toStatus(sub) });
}

/**
 * GET /stats — free, public. Landing-page "agents calling now" data source.
 * self/external split is best-effort: self is only the LiquiScope Agentic
 * Wallet's own payer address (our real self-test calls); external is any
 * other identifiable caller (payer address, or IP hash for free /check
 * calls); unclassified is calls with no derivable identity at all (no
 * cf-connecting-ip header) — a real bucket, not folded into either side.
 */
async function handleStats(env: Env): Promise<Response> {
  const counts = await readStats(env.WATCH_KV);
  return json({ service: "liquiscope-stats", ...counts });
}

const PROOF_DESCRIPTION = "LiquiScope /proof — historical health-factor replay (\"would-have-warned-you\" mode)";

/**
 * GET /proof?wallet=&chain=&protocol= — x402-paid, same $0.15 price as
 * /report (a default, not independently approved — flagged for confirmation
 * before any deploy). protocol is required (not optional): scoping to one
 * source keeps the subrequest cost per call predictable, which matters
 * because this handler runs entirely within the free Workers plan's
 * 50-subrequest/invocation ceiling.
 *
 * Budget note (measured, not assumed — see commit message): historical,
 * block-pinned reads do NOT multicall-batch the way live same-block reads
 * do, so the full ProtocolAdapter.getPositions() path measured ~9-12
 * subrequests PER SAMPLE — with ~6 probe reads + 10 trajectory samples that
 * would total 150+, well over budget. proof/readers.ts's lean HF-only
 * readers (getHealthFactorAt on each adapter) cut this to ~1 subrequest/
 * sample for Aave (its on-chain healthFactor is already a single read) and
 * a handful for Compound (no aggregate to short-circuit to, but the
 * display-only symbol() lookups are dropped) — same exact formula, just
 * without the per-asset display data a trajectory point doesn't need.
 */
async function handleProof(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const resourceUrl = url.origin + "/proof";
  const payment = await processPayment(request, resourceUrl, env, PRICE_ATOMIC, PROOF_DESCRIPTION);
  if (payment === null) return challenge402(resourceUrl, PRICE_ATOMIC, PROOF_DESCRIPTION);
  if (!payment.ok) return json({ error: payment.error }, payment.status);
  const paymentHeaders = { "PAYMENT-RESPONSE": paymentResponseHeader(payment.settlement) };

  const address = parseAddress(url.searchParams.get("wallet"));
  if (!address) {
    return json({ error: "missing or invalid 'wallet' — expected a 0x… EVM address (40 hex chars)" }, 400, paymentHeaders);
  }
  const chainRaw = String(url.searchParams.get("chain") ?? "").toLowerCase();
  const chain = (CHAINS as string[]).includes(chainRaw) ? (chainRaw as ChainKey) : null;
  if (!chain) {
    return json({ error: `missing or unsupported 'chain' — use one of: ${CHAINS.join(", ")}` }, 400, paymentHeaders);
  }
  const protocolRaw = String(url.searchParams.get("protocol") ?? "");
  const source = PROOF_SOURCES.find((s) => s.protocol === protocolRaw && s.supportedChains.includes(chain));
  if (!source) {
    const supported = PROOF_SOURCES.filter((s) => s.supportedChains.includes(chain)).map((s) => s.protocol);
    return json({ error: `missing or unsupported 'protocol' for ${chain} — use one of: ${supported.join(", ")}` }, 400, paymentHeaders);
  }

  let lookback;
  try {
    lookback = await probeLookback(source.read, chain, address);
  } catch (e) {
    return json({ error: "could not establish a historical lookback window, retry shortly", detail: e instanceof Error ? e.message : String(e) }, 503, paymentHeaders);
  }

  const { trajectory, incidents, failedSamples } = await replayTrajectory(source.read, chain, address, lookback);

  const summary =
    incidents.length === 0
      ? `No historical liquidation-eligible crossings (health factor below 1.0) found in the achieved ${lookback.achievedDays}-day lookback window.`
      : `Found ${incidents.length} historical liquidation-eligible crossing${incidents.length === 1 ? "" : "s"} in the achieved ${lookback.achievedDays}-day lookback window.`;

  return json(
    {
      service: "liquiscope-proof",
      address,
      chain,
      protocol: source.protocol,
      lookback: {
        requested_days: lookback.requestedDays,
        achieved_days: lookback.achievedDays,
        achieved_from_block: lookback.achievedBlock.toString(),
        achieved_from_timestamp: lookback.achievedTimestamp,
        to_block: lookback.toBlock.toString(),
        to_timestamp: lookback.toTimestamp,
        note:
          lookback.achievedDays < lookback.requestedDays
            ? `Free-tier RPC archive depth only reached ${lookback.achievedDays} of the requested ${lookback.requestedDays} days for this wallet/chain at request time — this is what was actually queryable, not a fixed promise.`
            : "Full requested lookback window was achievable.",
      },
      price_source: "on-chain oracle prices read at each sampled historical block — the same oracle/read path as a live /report, just pinned to a past block, never a separate historical price model",
      sampling_note: `${trajectory.length} discrete samples across the lookback window (not a continuous trace) — a brief health-factor dip between two samples can be missed by construction.${failedSamples > 0 ? ` ${failedSamples} in-range sample(s) failed to read (transient RPC issue) and are marked readable:false rather than silently omitted.` : ""}`,
      trajectory,
      incidents,
      summary,
      timestamp: new Date().toISOString(),
    },
    200,
    paymentHeaders,
  );
}

export default {
  /** Cron dispatch: the fixture self-check (10-min pattern) and the Watch Mode alert sweep (15-min pattern) share one Worker, split by event.cron. */
  async scheduled(event: { cron: string }, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<void> {
    if (event.cron === "*/15 * * * *") {
      ctx.waitUntil(
        (async () => {
          try {
            const summary = await runWatchCron(env.WATCH_KV);
            console.log(JSON.stringify({ watchCron: "ok", ...summary }));
          } catch (e) {
            console.log(JSON.stringify({ watchCron: "failed", error: e instanceof Error ? e.message : String(e) }));
          }
        })(),
      );
      return;
    }

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

  async fetch(request: Request, env: Env, ctx: Ctx): Promise<Response> {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/health") return json({ status: "ok", service: "liquiscope" });

      if (url.pathname === "/stats") {
        if (request.method !== "GET") return json({ error: "use GET" }, 405);
        return await handleStats(env);
      }

      if (url.pathname === "/check") {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        const ip = request.headers.get("cf-connecting-ip") ?? "unknown";
        if (rateLimited(ip)) return json({ error: "rate limit exceeded (30/min) — please slow down" }, 429);
        return await handleCheck(request, env, ctx);
      }

      if (url.pathname === "/report") {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        return await handleReport(request, env, ctx);
      }

      if (url.pathname === "/watch") {
        if (request.method !== "POST") return json({ error: "use POST" }, 405);
        return await handleWatchCreate(request, env, ctx);
      }

      const watchStatusMatch = url.pathname.match(/^\/watch\/([^/]+)\/status$/);
      if (watchStatusMatch) {
        if (request.method !== "GET") return json({ error: "use GET" }, 405);
        return await handleWatchStatus(watchStatusMatch[1], env);
      }

      if (url.pathname === "/proof") {
        if (request.method !== "GET") return json({ error: "use GET" }, 405);
        return await handleProof(request, env);
      }

      return json(
        {
          service: "LiquiScope",
          description: "Cross-protocol, cross-chain DeFi liquidation-risk reports (Aave v3 + Compound v3, across Ethereum/Base/Arbitrum/Optimism)",
          endpoints: {
            "POST /check": "free — single-chain quick health factor + risk tier { address, chain? }",
            "POST /report": "x402-paid — full cross-protocol, cross-chain analysis { address }, plus portfolio_score, recommendations, and an optional ?stress_pct=-20 hypothetical price-move scenario",
            "POST /watch": "x402-paid ($0.02/day, 3-day min) — recurring health-factor alert { wallet, chain, protocol, hf_threshold, notify_webhook, duration_days }, delivered via webhook when hf_threshold is crossed",
            "GET /watch/:id/status": "free — subscription status, last check, alert state",
            "GET /proof": "x402-paid ($0.15) — historical health-factor replay ?wallet=&chain=&protocol=, over the best achievable free-tier RPC lookback; flags any past liquidation-eligible crossings",
            "GET /stats": "free — total/self/external/unclassified call counts across /check, /report, /watch, since first recorded call",
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
