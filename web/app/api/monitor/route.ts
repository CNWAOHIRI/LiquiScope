import { NextRequest, NextResponse } from "next/server";
import { analyzeWallet } from "@/lib/engine";
import { getWatchlist } from "@/lib/watchlist";
import { getMonitorState, setMonitorState, kvAvailable, type MonitorState } from "@/lib/kv";
import { sendTelegramAlert } from "@/lib/telegram";

export const maxDuration = 30; // guardrail — real scans take ~1-6s for 3 addresses, see README

const CRITICAL_REALERT_MS =
  Number(process.env.CRITICAL_REALERT_HOURS ?? "6") * 60 * 60 * 1000;
const ERROR_ALERT_THRESHOLD = 3; // alert once consecutive failures exceeds this
const APP_URL = process.env.APP_URL ?? "https://web-beta-six-50.vercel.app";

const TIER_LABEL: Record<string, string> = {
  safe: "SAFE",
  watch: "WATCH",
  danger: "DANGER",
  critical: "CRITICAL",
  liquidatable: "LIQUIDATABLE",
  none: "NO DEBT",
  // Legacy 3-tier value that may persist in KV states written before the
  // 5-tier port; renders correctly in the one-time transition alert.
  warning: "WARNING",
};

const TIER_EMOJI: Record<string, string> = {
  safe: "✅",
  watch: "👀",
  danger: "⚠️",
  critical: "🚨",
  liquidatable: "☠️",
  none: "🔵",
};

function short(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function riskClause(report: Awaited<ReturnType<typeof analyzeWallet>>): string {
  if (report.positions.length === 0) return "No open debt found.";
  const worst = report.positions.reduce((a, b) => (a.healthFactor < b.healthFactor ? a : b));
  const pct = (worst.dominantCollateral.dropToLiquidation * 100).toFixed(1);
  const liqPrice = worst.dominantCollateral.liquidationPriceUsd.toLocaleString(undefined, {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
  return `HF ${worst.healthFactor.toFixed(2)}. Liquidation if ${worst.dominantCollateral.symbol} drops ${pct}% to ${liqPrice}.`;
}

function worstHealthFactor(report: Awaited<ReturnType<typeof analyzeWallet>>): number | null {
  if (report.positions.length === 0) return null;
  return Math.min(...report.positions.map((p) => p.healthFactor));
}

async function processAddress(address: `0x${string}`, now: number) {
  const prev = await getMonitorState(address);

  let report: Awaited<ReturnType<typeof analyzeWallet>> | null = null;
  let scanFailed = false;
  try {
    report = await analyzeWallet(address);
    scanFailed =
      report.scan.chains.length > 0 && report.scan.chains.every((c) => c.status === "error");
  } catch {
    scanFailed = true;
  }

  const addrLabel = short(address);

  // Scan failure path — keep last-known-good tier/HF, track consecutive errors.
  if (scanFailed) {
    const consecutiveErrors = (prev?.consecutiveErrors ?? 0) + 1;
    const state: MonitorState = {
      tier: prev?.tier ?? "none",
      healthFactor: prev?.healthFactor ?? null,
      lastChecked: now,
      consecutiveErrors,
      lastAlertAt: prev?.lastAlertAt ?? null,
    };

    let alerted = false;
    if (consecutiveErrors === ERROR_ALERT_THRESHOLD + 1) {
      await sendTelegramAlert(
        `🔴 LiquiScope monitor: ${addrLabel} has failed to scan for ${consecutiveErrors} consecutive runs. Every chain read is erroring — check RPC health. ${APP_URL}`
      );
      alerted = true;
    }
    await setMonitorState(address, state);
    return { address, status: "scan_error", consecutiveErrors, alerted };
  }

  const report_ = report as Awaited<ReturnType<typeof analyzeWallet>>;
  const newTier = report_.overallRiskTier;
  const newHF = worstHealthFactor(report_);
  const clause = riskClause(report_);

  let alerted = false;
  let lastAlertAt = prev?.lastAlertAt ?? null;

  if (!prev) {
    // First time seeing this address — plain "now monitoring", not a fake transition.
    await sendTelegramAlert(
      `🔎 LiquiScope: now monitoring ${addrLabel} — current tier: ${TIER_LABEL[newTier]}. ${clause} ${APP_URL}`
    );
    alerted = true;
    lastAlertAt = now;
  } else if (prev.tier !== newTier) {
    await sendTelegramAlert(
      `${TIER_EMOJI[newTier]} LiquiScope: ${addrLabel} moved ${TIER_LABEL[prev.tier]} -> ${TIER_LABEL[newTier]}. ${clause} ${APP_URL}`
    );
    alerted = true;
    lastAlertAt = now;
  } else if (
    (newTier === "critical" || newTier === "liquidatable") &&
    now - (prev.lastAlertAt ?? 0) > CRITICAL_REALERT_MS
  ) {
    await sendTelegramAlert(
      `${TIER_EMOJI[newTier]} LiquiScope: ${addrLabel} still ${TIER_LABEL[newTier]} after ${CRITICAL_REALERT_MS / 3_600_000}h+. ${clause} ${APP_URL}`
    );
    alerted = true;
    lastAlertAt = now;
  }

  const state: MonitorState = {
    tier: newTier,
    healthFactor: newHF,
    lastChecked: now,
    consecutiveErrors: 0,
    lastAlertAt,
  };
  await setMonitorState(address, state);
  return { address, status: "ok", tier: newTier, healthFactor: newHF, alerted };
}

export async function GET(request: NextRequest) {
  const secret = process.env.MONITOR_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "MONITOR_SECRET not configured on server" }, { status: 500 });
  }
  if (request.headers.get("x-monitor-secret") !== secret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!kvAvailable()) {
    return NextResponse.json(
      { error: "KV not configured (KV_REST_API_URL/TOKEN or UPSTASH_REDIS_REST_URL/TOKEN missing)" },
      { status: 500 }
    );
  }

  const watchlist = getWatchlist();
  const now = Date.now();
  const results = await Promise.all(watchlist.map((a) => processAddress(a, now)));

  return NextResponse.json({ ranAt: now, count: results.length, results });
}
