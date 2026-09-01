const TELEGRAM_API = "https://api.telegram.org";

export class TelegramClient {
  constructor(token) {
    this.baseUrl = `${TELEGRAM_API}/bot${token}`;
  }

  async call(method, payload = {}) {
    const response = await fetch(`${this.baseUrl}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!body.ok) throw new Error(`Telegram API ${method}: ${body.description ?? "request failed"}`);
    return body.result;
  }

  async getUpdates(offset) {
    return this.call("getUpdates", { offset, timeout: 45, allowed_updates: ["message"] });
  }

  async sendMessage(chatId, text, options = {}) {
    return this.call("sendMessage", { chat_id: chatId, text, ...options });
  }

  async deleteMessage(chatId, messageId) {
    try {
      await this.call("deleteMessage", { chat_id: chatId, message_id: messageId });
    } catch {
      // Telegram may reject deletion in groups; never expose the token in logs.
    }
  }

  async typing(chatId) {
    return this.call("sendChatAction", { chat_id: chatId, action: "typing" });
  }
}

export function splitTelegramMessage(text, maxLength = 3900) {
  const chunks = [];
  let remaining = String(text);
  while (remaining.length > maxLength) {
    let splitAt = remaining.lastIndexOf("\n", maxLength);
    if (splitAt < Math.floor(maxLength * 0.6)) splitAt = remaining.lastIndexOf(" ", maxLength);
    if (splitAt < 1) splitAt = maxLength;
    chunks.push(remaining.slice(0, splitAt));
    remaining = remaining.slice(splitAt).trimStart();
  }
  if (remaining) chunks.push(remaining);
  return chunks.length ? chunks : [""];
}