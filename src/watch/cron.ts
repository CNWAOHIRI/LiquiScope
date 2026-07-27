/**
 * Watch Mode's cron tick: pick this tick's shards (see budget.ts), check
 * each active subscription's health factor, fire webhooks on a fresh
 * threshold crossing, and persist. Idempotent by construction: alert_state
 * only flips ok->fired after a CONFIRMED webhook delivery, so a tick that
 * crashes mid-way (or a subrequest timeout) just gets retried at the next
 * tick against the same undelivered crossing — never a double-fire, never a
 * silently dropped one.
 */

import { getMeta, decrementSubCount, readShard, saveShard } from "./storage";
import { shardsForTick } from "./budget";
import { ADAPTERS } from "../engine/scan";
import type { WatchSubscription } from "./types";
import { deliverWebhook, type WebhookPayload } from "./webhook";
import { deliverTelegramDirect, extractOwnRelayToken } from "../telegram/deliver";

export interface CronEnv {
  WATCH_KV: KVNamespace;
  TELEGRAM_BOT_TOKEN?: string;
}

/** Our own /telegram/relay/:token URLs are delivered in-process (see telegram/deliver.ts for why) — everything else goes through the normal HTTP webhook path, unchanged. */
async function deliverAlert(env: CronEnv, notifyWebhook: string, payload: WebhookPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  const relayToken = extractOwnRelayToken(notifyWebhook);
  if (relayToken && env.TELEGRAM_BOT_TOKEN) {
    return deliverTelegramDirect(env.WATCH_KV, env.TELEGRAM_BOT_TOKEN, relayToken, payload);
  }
  return deliverWebhook(notifyWebhook, payload);
}

/** Per-check wall-clock budget — same rationale as scan.ts's SOURCE_TIMEOUT_MS: one hung RPC must not stall the whole tick. */
const CHECK_TIMEOUT_MS = 12_000;

/** Host + path only, no query/token — for logging a failed delivery target without leaking the full webhook URL (which may embed an opaque relay token) into logs. */
function safeHost(url: string): string {
  try {
    const u = new URL(url);
    return u.host + u.pathname;
  } catch {
    return "(invalid url)";
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`check timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

export interface CronSummary {
  ranAt: string;
  shardsChecked: number[];
  subscriptionsChecked: number;
  expiredRemoved: number;
  checkFailures: number;
  alertsFired: number;
  alertsRecovered: number;
  webhookFailures: number;
}

/**
 * Reads only the subscription's own protocol adapter for its chain — not the
 * full scanWallet fan-out across every protocol, which would waste RPC
 * subrequests on protocols this subscription doesn't care about and eat
 * into the tick's subrequest budget (see budget.ts) for no reason.
 */
type CheckResult =
  | { kind: "checked"; updated: WatchSubscription; fired: boolean; recovered: boolean; webhookFailed: boolean }
  /** RPC read failed or timed out this tick — the subscription is untouched and stays in the shard; nothing is inferred from a check that didn't happen. */
  | { kind: "check_failed"; sub: WatchSubscription };

async function checkOne(env: CronEnv, sub: WatchSubscription, now: Date): Promise<CheckResult> {
  const adapter = ADAPTERS.find((a) => a.protocol === sub.protocol && a.supportedChains.includes(sub.chain));
  if (!adapter) return { kind: "check_failed", sub }; // shouldn't happen — POST /watch validates this combination at signup

  let hf: number;
  try {
    const positions = await withTimeout(adapter.getPositions(sub.chain, sub.wallet), CHECK_TIMEOUT_MS);
    hf = positions.length === 0 ? Infinity : positions.reduce((worst, p) => Math.min(worst, p.healthFactor), Infinity);
  } catch {
    return { kind: "check_failed", sub };
  }
  const crossed = hf <= sub.hf_threshold;

  const updated: WatchSubscription = {
    ...sub,
    last_checked_hf: hf === Infinity ? null : hf,
    last_checked_at: now.toISOString(),
  };

  if (crossed && sub.alert_state === "ok") {
    const nextSeq = sub.check_seq + 1;
    const payload: WebhookPayload = {
      event: "hf_threshold_crossed",
      dedup_key: `${sub.id}:cross:${nextSeq}`,
      subscription_id: sub.id,
      wallet: sub.wallet,
      chain: sub.chain,
      protocol: sub.protocol,
      hf_threshold: sub.hf_threshold,
      health_factor: hf,
      timestamp: now.toISOString(),
    };
    const result = await deliverAlert(env, sub.notify_webhook, payload);
    if (result.ok) {
      updated.alert_state = "fired";
      updated.last_alert_sent_at = now.toISOString();
      updated.check_seq = nextSeq;
      return { kind: "checked", updated, fired: true, recovered: false, webhookFailed: false };
    }
    // Delivery failed: leave alert_state "ok" so the SAME crossing (same
    // dedup_key on the next attempt, since check_seq isn't bumped) retries
    // at the next tick rather than being silently dropped. Logged per-
    // subscription (host only, not the full URL/token) since the aggregate
    // webhookFailures count in the tick summary isn't enough to tell which
    // target actually failed or why.
    console.log(JSON.stringify({ webhookDeliveryFailed: sub.id, host: safeHost(sub.notify_webhook), error: result.error }));
    return { kind: "checked", updated, fired: false, recovered: false, webhookFailed: true };
  }

  if (!crossed && sub.alert_state === "fired") {
    // Recovered above threshold — reset the latch so a future re-crossing
    // fires again. v1 sends no "recovered" notification, only crossings.
    updated.alert_state = "ok";
    return { kind: "checked", updated, fired: false, recovered: true, webhookFailed: false };
  }

  return { kind: "checked", updated, fired: false, recovered: false, webhookFailed: false };
}

export async function runWatchCron(env: CronEnv, now: Date = new Date()): Promise<CronSummary> {
  const kv = env.WATCH_KV;
  const meta = await getMeta(kv);
  const shards = shardsForTick(meta.shardCount, now);

  const summary: CronSummary = {
    ranAt: now.toISOString(),
    shardsChecked: shards,
    subscriptionsChecked: 0,
    expiredRemoved: 0,
    checkFailures: 0,
    alertsFired: 0,
    alertsRecovered: 0,
    webhookFailures: 0,
  };

  await Promise.all(
    shards.map(async (shardIndex) => {
      const subs = await readShard(kv, shardIndex);
      const active: WatchSubscription[] = [];
      let expiredCount = 0;

      const results = await Promise.all(
        subs.map(async (sub): Promise<CheckResult | { kind: "expired" }> => {
          if (new Date(sub.expires_at).getTime() <= now.getTime()) return { kind: "expired" };
          return checkOne(env, sub, now);
        }),
      );

      for (const r of results) {
        if (r.kind === "expired") {
          expiredCount++;
          continue;
        }
        if (r.kind === "check_failed") {
          active.push(r.sub); // untouched — retried next tick
          summary.checkFailures++;
          continue;
        }
        active.push(r.updated);
        summary.subscriptionsChecked++;
        if (r.fired) summary.alertsFired++;
        if (r.recovered) summary.alertsRecovered++;
        if (r.webhookFailed) summary.webhookFailures++;
      }

      await saveShard(kv, shardIndex, active);
      summary.expiredRemoved += expiredCount;
    }),
  );

  if (summary.expiredRemoved > 0) await decrementSubCount(kv, summary.expiredRemoved);

  return summary;
}
