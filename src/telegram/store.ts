/**
 * KV mapping between an opaque relay token (safe to put in a public-ish
 * webhook URL, per /watch's notify_webhook contract) and a Telegram chat
 * id (Telegram-internal, not meant to be exposed). Reuses WATCH_KV — same
 * "no new architecture for a small feature" reasoning as stats/store.ts.
 */

const tokenKey = (token: string) => `telegram:token:${token}`;
const chatKey = (chatId: string) => `telegram:chat:${chatId}`;

export async function getChatIdForToken(kv: KVNamespace, token: string): Promise<string | null> {
  return kv.get(tokenKey(token));
}

/** Idempotent: a chat that already has a token gets the same one back, rather than minting a new one every time someone re-sends /start. */
export async function getOrCreateTokenForChat(kv: KVNamespace, chatId: string): Promise<string> {
  const existing = await kv.get(chatKey(chatId));
  if (existing) return existing;

  const token = crypto.randomUUID();
  await kv.put(tokenKey(token), chatId);
  await kv.put(chatKey(chatId), token);
  return token;
}
