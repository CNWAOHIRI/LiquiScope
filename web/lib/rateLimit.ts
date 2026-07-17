const WINDOW_MS = 60_000;
const MAX_REQUESTS = 5;

const hits = new Map<string, number[]>();

export function checkRateLimit(key: string): { allowed: boolean; retryAfterSeconds?: number } {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const existing = (hits.get(key) ?? []).filter((t) => t > windowStart);

  if (existing.length >= MAX_REQUESTS) {
    const retryAfterSeconds = Math.ceil((existing[0] + WINDOW_MS - now) / 1000);
    hits.set(key, existing);
    return { allowed: false, retryAfterSeconds };
  }

  existing.push(now);
  hits.set(key, existing);
  return { allowed: true };
}
