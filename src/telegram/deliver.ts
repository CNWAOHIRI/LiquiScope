/**
 * Direct (non-HTTP) Telegram alert delivery for Watch Mode's own relay
 * URLs — bypasses POST /telegram/relay/:token entirely for our own cron.
 *
 * Why: the cron's self-fetch to its own /telegram/relay/:token URL showed
 * a persistent, reproducible KV-read miss (a 404 "unknown relay token")
 * on every real cron tick, while the exact same token resolved correctly
 * on every external curl call made at the same time — confirmed via direct
 * KV inspection (the mapping genuinely exists) and repeated manual tests
 * (always succeed). That points at a Cloudflare Cron Trigger self-fetch /
 * edge-locality KV-consistency quirk, not a bug in the relay endpoint's
 * logic — see docs/friction-log.md for the write-up. Rather than work
 * around an unconfirmed root cause, this sidesteps it: when a
 * subscription's notify_webhook is our own relay URL, look up the chat and
 * send the Telegram message directly, in the same invocation, no HTTP
 * round-trip to ourselves involved at all.
 *
 * POST /telegram/relay/:token (index.ts's handleTelegramRelay) still
 * exists and still works — for anyone who registers that URL as a
 * notify_webhook from OUTSIDE this Worker's own cron (which is the
 * general, documented contract), it's a completely normal webhook target.
 */

import { sendMessage } from "./bot";
import { getChatIdForToken } from "./store";

const RELAY_PATH_PREFIX = "/telegram/relay/";
const OWN_HOST = "liquiscope.liquiscope.workers.dev";

export interface AlertPayload {
  wallet: string;
  chain: string;
  protocol: string;
  hf_threshold: number;
  health_factor: number;
}

export function formatAlertMessage(payload: AlertPayload): string {
  return (
    `🚨 <b>LiquiScope alert</b>\n\n` +
    `Wallet <code>${payload.wallet}</code> on ${payload.chain}/${payload.protocol} crossed your threshold.\n\n` +
    `Health factor: <b>${payload.health_factor}</b> (threshold: ${payload.hf_threshold})`
  );
}

/** Returns the relay token iff `url` is one of THIS Worker's own /telegram/relay/:token URLs — null for anything else (including malformed URLs or someone else's webhook that happens to share the path shape). */
export function extractOwnRelayToken(url: string): string | null {
  try {
    const u = new URL(url);
    if (u.host !== OWN_HOST || !u.pathname.startsWith(RELAY_PATH_PREFIX)) return null;
    const token = u.pathname.slice(RELAY_PATH_PREFIX.length);
    return token.length > 0 ? token : null;
  } catch {
    return null;
  }
}

export async function deliverTelegramDirect(
  kv: KVNamespace,
  botToken: string,
  token: string,
  payload: AlertPayload,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const chatId = await getChatIdForToken(kv, token);
  if (!chatId) return { ok: false, error: "unknown relay token" };
  return sendMessage(botToken, chatId, formatAlertMessage(payload));
}
