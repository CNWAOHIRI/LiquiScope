/**
 * Plain-language summary: Claude (haiku — cheapest/fastest tier) with a
 * deterministic template fallback. The endpoint must NEVER fail because the
 * LLM hiccuped: any error, timeout, refusal, or missing key falls through to
 * the template. A small in-memory cache caps LLM spend on repeated lookups.
 */

import type { ChainScan } from "../engine/types";
import { templateSummary } from "./template";

const MODEL = "claude-haiku-4-5";
const TIMEOUT_MS = 10_000;

const CACHE_TTL_MS = 5 * 60_000;
const cache = new Map<string, { summary: string; source: string; at: number }>();

export async function generateSummary(
  scans: ChainScan[],
  apiKey: string | undefined,
): Promise<{ summary: string; source: "llm" | "template" }> {
  const fallback = templateSummary(scans);
  if (!apiKey) return { summary: fallback, source: "template" };

  const key = JSON.stringify(scans.map((s) => [s.chain, s.positions.map((p) => [p.protocol, p.market, p.tier, p.debtUsd, p.collateralUsd])]));
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
    return { summary: hit.summary, source: hit.source as "llm" | "template" };
  }

  try {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system:
          "You are LiquiScope, a cross-protocol, cross-chain DeFi liquidation-risk analyst. Given position scan data (JSON) covering multiple lending protocols and chains for one wallet, write a plain-language risk summary for the wallet owner: overall risk level first, then which single position across all protocols/chains is riskiest (name the protocol, chain, debt asset, health factor, and the price move that triggers liquidation), then each position's key numbers (collateral, debt, health factor, distance to liquidation), then ONE concrete recommendation matched to the worst risk tier. Be precise with numbers, no hedging, no preamble, under 200 words. Plain text only.",
        messages: [{ role: "user", content: JSON.stringify(scans) }],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`anthropic HTTP ${res.status}`);
    const json = (await res.json()) as {
      stop_reason?: string;
      content?: { type: string; text?: string }[];
    };
    if (json.stop_reason === "refusal") throw new Error("refusal");
    const text = json.content?.find((b) => b.type === "text")?.text?.trim();
    if (!text) throw new Error("empty completion");
    cache.set(key, { summary: text, source: "llm", at: Date.now() });
    return { summary: text, source: "llm" };
  } catch {
    // Template fallback — deliberately swallow the reason; the report ships regardless.
    return { summary: fallback, source: "template" };
  }
}
