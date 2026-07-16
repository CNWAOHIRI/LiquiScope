import { Redis } from "@upstash/redis";

// Vercel's Upstash marketplace integration has historically injected either
// naming (KV_REST_API_* for legacy Vercel-KV compatibility, or the native
// UPSTASH_REDIS_REST_*) depending on install path — support both rather
// than guess which one shows up.
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;

let client: Redis | null = null;
if (url && token) {
  client = new Redis({ url, token });
}

export function kvAvailable(): boolean {
  return client !== null;
}

export interface MonitorState {
  tier: "safe" | "watch" | "danger" | "critical" | "liquidatable" | "none";
  healthFactor: number | null;
  lastChecked: number; // epoch ms
  consecutiveErrors: number;
  lastAlertAt: number | null; // epoch ms, last time an alert fired for this address
}

const KEY_PREFIX = "liquiscope:monitor:";

function keyFor(address: string): string {
  return `${KEY_PREFIX}${address.toLowerCase()}`;
}

export async function getMonitorState(address: string): Promise<MonitorState | null> {
  if (!client) return null;
  const val = await client.get<MonitorState>(keyFor(address));
  return val ?? null;
}

export async function setMonitorState(address: string, state: MonitorState): Promise<void> {
  if (!client) return;
  await client.set(keyFor(address), state);
}
