/** Thin Telegram Bot API client — just the two calls this integration needs. */

const API_BASE = "https://api.telegram.org";

export async function sendMessage(botToken: string, chatId: string, text: string): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch(`${API_BASE}/bot${botToken}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML", disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = (await res.json()) as { ok: boolean; description?: string };
    if (!res.ok || !body.ok) return { ok: false, error: body.description ?? `HTTP ${res.status}` };
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** One-time setup call — registers our /telegram/webhook URL with Telegram and pins a secret token Telegram will echo back on every delivery, so the webhook handler can reject anything that isn't really from Telegram. */
export async function setWebhook(botToken: string, url: string, secretToken: string): Promise<{ ok: boolean; description?: string }> {
  const res = await fetch(`${API_BASE}/bot${botToken}/setWebhook`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url, secret_token: secretToken, allowed_updates: ["message"] }),
  });
  return res.json();
}

export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}
