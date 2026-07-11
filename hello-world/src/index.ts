/**
 * LiquiScope hello-world A2MCP probe: "ETH gas price now".
 *
 * Free A2MCP endpoint per the OKX.AI spec: any request → HTTP 200 with the
 * result directly (no manifest, no x402). Exists to test the OKX.AI
 * registration + review pipeline end-to-end before the real service ships.
 *
 * Reliability pattern (same one the real service will use): try each free
 * public RPC in order, first success wins, never 500 while any endpoint is up.
 */

const RPCS = [
  "https://cloudflare-eth.com",
  "https://ethereum-rpc.publicnode.com",
  "https://eth.llamarpc.com",
];

type RpcResult = { gasPriceWei: bigint; blockNumber: bigint; rpc: string };

async function rpcCall(rpc: string, method: string): Promise<bigint> {
  const res = await fetch(rpc, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
    signal: AbortSignal.timeout(4000),
  });
  if (!res.ok) throw new Error(`${rpc} HTTP ${res.status}`);
  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (!json.result) throw new Error(`${rpc} RPC error: ${json.error?.message ?? "no result"}`);
  return BigInt(json.result);
}

async function gasPriceWithFallback(): Promise<RpcResult> {
  const errors: string[] = [];
  for (const rpc of RPCS) {
    try {
      const [gasPriceWei, blockNumber] = await Promise.all([
        rpcCall(rpc, "eth_gasPrice"),
        rpcCall(rpc, "eth_blockNumber"),
      ]);
      return { gasPriceWei, blockNumber, rpc };
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e));
    }
  }
  throw new Error(`all RPCs failed: ${errors.join(" | ")}`);
}

export default {
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/health") {
      return Response.json({ status: "ok" });
    }

    try {
      const { gasPriceWei, blockNumber, rpc } = await gasPriceWithFallback();
      const gwei = Number(gasPriceWei) / 1e9;
      return Response.json({
        service: "eth-gas-price-now",
        chain: "ethereum-mainnet",
        gasPrice: {
          wei: gasPriceWei.toString(),
          gwei: Math.round(gwei * 1000) / 1000,
        },
        blockNumber: Number(blockNumber),
        source: rpc,
        timestamp: new Date().toISOString(),
      });
    } catch (e) {
      // Degrade with 503 + detail rather than a bare 500; callers can retry.
      return Response.json(
        { error: "upstream RPCs unavailable", detail: e instanceof Error ? e.message : String(e) },
        { status: 503 },
      );
    }
  },
};
