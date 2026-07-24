/**
 * x402 (exact scheme, v2) seller-side flow on X Layer, per OKX facilitator
 * HTTP API (api-http-onetime). No SDK — plain fetch + WebCrypto HMAC, so it
 * runs on Workers.
 *
 * Flow: no payment header → 402 with PAYMENT-REQUIRED (base64 JSON, also in
 * body). Buyer signs (EIP-3009/Permit2) and replays with X-PAYMENT /
 * PAYMENT-SIGNATURE → we verify then settle via the facilitator, and attach
 * the settlement as a PAYMENT-RESPONSE header on the 200.
 */

export interface X402Env {
  OKX_API_KEY?: string;
  OKX_SECRET_KEY?: string;
  OKX_PASSPHRASE?: string;
}

const NETWORK = "eip155:196"; // X Layer mainnet — gas-free chain
const USDT0 = "0x779ded0c9e1022225f8e0630b35a9b54be713736"; // USD₮0, 6 decimals
export const PAY_TO = "0x5c0a7b5cae9f6ecdf005d80c323d70a4c2c7b556"; // LiquiScope Agentic Wallet
export const PRICE_ATOMIC = "150000"; // $0.15 in 6-decimal USDT units
export const REPORT_DESCRIPTION = "LiquiScope full multi-chain liquidation-risk report";
const FACILITATOR = "https://web3.okx.com";

/** btoa chokes on non-Latin1 (e.g. the ₮ in USD₮0) — encode UTF-8 bytes instead. */
function b64encode(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function b64decode(s: string): string {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export function paymentRequirements(resourceUrl: string, amountAtomic: string = PRICE_ATOMIC, description: string = REPORT_DESCRIPTION) {
  return {
    scheme: "exact",
    network: NETWORK,
    asset: USDT0,
    amount: amountAtomic,
    payTo: PAY_TO,
    maxTimeoutSeconds: 300,
    resource: resourceUrl,
    description,
    extra: { name: "USD₮0", version: "1", assetTransferMethod: "eip3009" },
  };
}

export function challenge402(resourceUrl: string, amountAtomic: string = PRICE_ATOMIC, description: string = REPORT_DESCRIPTION): Response {
  const body = {
    x402Version: 2,
    resource: {
      url: resourceUrl,
      description,
      mimeType: "application/json",
    },
    accepts: [paymentRequirements(resourceUrl, amountAtomic, description)],
  };
  const encoded = b64encode(JSON.stringify(body));
  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json",
      "PAYMENT-REQUIRED": encoded,
    },
  });
}

/** OKX REST signing: Base64(HMAC-SHA256(timestamp + method + path + body, secret)). */
async function okxHeaders(env: X402Env, path: string, body: string): Promise<Record<string, string>> {
  const timestamp = new Date().toISOString();
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.OKX_SECRET_KEY!),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(timestamp + "POST" + path + body));
  return {
    "content-type": "application/json",
    "OK-ACCESS-KEY": env.OKX_API_KEY!,
    "OK-ACCESS-SIGN": btoa(String.fromCharCode(...new Uint8Array(sig))),
    "OK-ACCESS-PASSPHRASE": env.OKX_PASSPHRASE!,
    "OK-ACCESS-TIMESTAMP": timestamp,
  };
}

async function facilitator(env: X402Env, op: "verify" | "settle", payload: unknown, requirements: unknown) {
  const path = `/api/v6/pay/x402/${op}`;
  const body = JSON.stringify({ x402Version: 2, paymentPayload: payload, paymentRequirements: requirements, ...(op === "settle" ? { syncSettle: true } : {}) });
  const res = await fetch(FACILITATOR + path, {
    method: "POST",
    headers: await okxHeaders(env, path, body),
    body,
    signal: AbortSignal.timeout(30_000),
  });
  const json = (await res.json()) as { code: string | number; msg?: string; data?: Record<string, unknown> };
  if (!res.ok || String(json.code) !== "0") throw new Error(`facilitator ${op} failed: HTTP ${res.status} code=${json.code} ${json.msg ?? ""}`);
  return json.data ?? {};
}

export type PaymentResult =
  | { ok: true; settlement: Record<string, unknown> }
  | { ok: false; status: number; error: string };

/**
 * Verify + settle an inbound payment header. Returns the settlement object
 * (goes into the PAYMENT-RESPONSE header) or a typed failure.
 */
export async function processPayment(
  request: Request,
  resourceUrl: string,
  env: X402Env,
  amountAtomic: string = PRICE_ATOMIC,
  description: string = REPORT_DESCRIPTION,
): Promise<PaymentResult | null> {
  const header = request.headers.get("X-PAYMENT") ?? request.headers.get("PAYMENT-SIGNATURE");
  if (!header) return null; // caller sends the 402 challenge

  if (!env.OKX_API_KEY || !env.OKX_SECRET_KEY || !env.OKX_PASSPHRASE) {
    return { ok: false, status: 503, error: "payment processing not configured" };
  }

  let payload: unknown;
  try {
    payload = JSON.parse(b64decode(header));
  } catch {
    return { ok: false, status: 400, error: "malformed payment header (expected base64 JSON)" };
  }

  const requirements = paymentRequirements(resourceUrl, amountAtomic, description);
  try {
    const verify = await facilitator(env, "verify", payload, requirements);
    if (!verify.isValid) {
      return { ok: false, status: 402, error: `payment invalid: ${verify.invalidReason ?? "unknown"} ${verify.invalidMessage ?? ""}`.trim() };
    }
    const settlement = await facilitator(env, "settle", payload, requirements);
    if (settlement.success === false) {
      return { ok: false, status: 402, error: `settlement failed: ${settlement.errorReason ?? "unknown"}` };
    }
    return { ok: true, settlement };
  } catch (e) {
    return { ok: false, status: 502, error: e instanceof Error ? e.message : String(e) };
  }
}

export function paymentResponseHeader(settlement: Record<string, unknown>): string {
  return b64encode(JSON.stringify(settlement));
}
