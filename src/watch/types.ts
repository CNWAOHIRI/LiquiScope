/**
 * Watch Mode data model. A subscription is a standing "tell me if this
 * wallet's health factor crosses hf_threshold" request, checked on a
 * schedule (see cron.ts) and stored in KV using the shard-blob layout
 * (see storage.ts for why: per-subscription keys would blow the free-tier
 * 1000-writes/day KV budget almost immediately).
 */

import type { Address } from "viem";
import type { ChainKey, Protocol } from "../engine/types";

/**
 * "ok": no alert currently outstanding (either never crossed, or crossed
 * and recovered). "fired": an alert was sent for the current crossing and
 * has not yet recovered above the threshold — this is the dedup latch:
 * we fire once per crossing, not once per tick spent below threshold, and
 * only reset ("ok") once health_factor recovers back above hf_threshold.
 */
export type AlertState = "ok" | "fired";

export interface WatchSubscription {
  id: string;
  wallet: Address;
  chain: ChainKey;
  protocol: Protocol;
  hf_threshold: number;
  notify_webhook: string;
  created_at: string;
  expires_at: string;
  last_checked_hf: number | null;
  last_checked_at: string | null;
  alert_state: AlertState;
  last_alert_sent_at: string | null;
  /** Bumped on every state-affecting check; included in the webhook payload so receivers can dedupe idempotently even across retries. */
  check_seq: number;
}

/** Public status view — omits notify_webhook (not meant to be re-disclosed via a GET). */
export interface WatchStatus {
  id: string;
  wallet: Address;
  chain: ChainKey;
  protocol: Protocol;
  hf_threshold: number;
  active: boolean;
  created_at: string;
  expires_at: string;
  last_checked_hf: number | null;
  last_checked_at: string | null;
  alert_state: AlertState;
  last_alert_sent_at: string | null;
}

export function toStatus(sub: WatchSubscription): WatchStatus {
  return {
    id: sub.id,
    wallet: sub.wallet,
    chain: sub.chain,
    protocol: sub.protocol,
    hf_threshold: sub.hf_threshold,
    active: new Date(sub.expires_at).getTime() > Date.now(),
    created_at: sub.created_at,
    expires_at: sub.expires_at,
    last_checked_hf: sub.last_checked_hf,
    last_checked_at: sub.last_checked_at,
    alert_state: sub.alert_state,
    last_alert_sent_at: sub.last_alert_sent_at,
  };
}
