// Proof of Real — thin Telegram Bot API client.
//
// Only the four calls the bot needs; every method throws on a non-ok API
// response so the caller sees real errors instead of silent failures.

const API_BASE = "https://api.telegram.org";
const LONG_POLL_SECONDS = 50;

export function createTelegramClient(token, fetchImpl = fetch) {
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set.");

  async function call(method, payload) {
    const res = await fetchImpl(`${API_BASE}/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await res.json();
    if (!body.ok) throw new Error(`Telegram ${method} failed: ${body.description ?? res.status}`);
    return body.result;
  }

  return {
    getUpdates(offset) {
      return call("getUpdates", {
        timeout: LONG_POLL_SECONDS,
        offset,
        allowed_updates: ["message"],
      });
    },

    sendMessage(chatId, html) {
      return call("sendMessage", {
        chat_id: chatId,
        text: html,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      });
    },

    sendTyping(chatId) {
      return call("sendChatAction", { chat_id: chatId, action: "typing" });
    },

    /** Resolve a file_id to its bytes (Telegram caps bot downloads at 20 MB). */
    async getFileBuffer(fileId) {
      const file = await call("getFile", { file_id: fileId });
      const res = await fetchImpl(`${API_BASE}/file/bot${token}/${file.file_path}`);
      if (!res.ok) throw new Error(`Telegram file download failed: ${res.status}`);
      return Buffer.from(await res.arrayBuffer());
    },
  };
}
