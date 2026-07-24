/**
 * Webhook delivery for Watch Mode alerts (v1: webhook only, no email/SMS).
 * Idempotency is handled by the caller (cron.ts): a subscription's
 * alert_state only flips "ok" -> "fired" AFTER a successful delivery, and a
 * failed delivery leaves it "ok" so the next tick (max CHECK_INTERVAL_MIN
 * later, see cron.ts) retries the SAME crossing rather than skipping it or
 * double-counting it. dedup_key is included in the payload so a receiver can
 * additionally guard against any duplicate delivery on their end (e.g. if a
 * fetch succeeds but the response is lost before we record it).
 */

export interface WebhookPayload {
  event: "hf_threshold_crossed";
  dedup_key: string;
  subscription_id: string;
  wallet: string;
  chain: string;
  protocol: string;
  hf_threshold: number;
  health_factor: number;
  timestamp: string;
}

const WEBHOOK_TIMEOUT_MS = 8_000;

export async function deliverWebhook(url: string, payload: WebhookPayload): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    });
    if (!res.ok) return { ok: false, error: `webhook responded HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
