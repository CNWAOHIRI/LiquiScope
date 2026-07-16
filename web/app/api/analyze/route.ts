import { NextRequest, NextResponse } from "next/server";
import { isAddress, getAddress } from "viem";
import { analyzeWallet } from "@/lib/engine";
import { checkRateLimit } from "@/lib/rateLimit";
import { isWatched } from "@/lib/watchlist";
import { getMonitorState } from "@/lib/kv";

export const maxDuration = 20;

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return "unknown";
}

export async function POST(request: NextRequest) {
  const ip = clientIp(request);
  const rate = checkRateLimit(ip);
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded. Try again shortly." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds ?? 60) } }
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const address = (body as { address?: unknown })?.address;
  if (typeof address !== "string" || !isAddress(address, { strict: true })) {
    return NextResponse.json(
      { error: "Invalid address. Provide a checksummed EVM address (0x...)." },
      { status: 400 }
    );
  }

  try {
    const checksummed = getAddress(address);
    const report = await analyzeWallet(checksummed);
    const monitored = isWatched(checksummed);
    const monitorState = monitored ? await getMonitorState(checksummed) : null;
    return NextResponse.json({
      ...report,
      monitored,
      lastMonitorCheck: monitorState?.lastChecked ?? null,
    });
  } catch (err) {
    console.error("analyzeWallet failed", err);
    return NextResponse.json(
      { error: "Scan failed — the RPC provider or engine hit an error. Try again in a moment." },
      { status: 502 }
    );
  }
}
