export class TelegramClient {
  #token;
  #apiBase;
  #fileBase;

  constructor({ token, apiBase, fileBase }) {
    this.#token = token;
    this.#apiBase = apiBase;
    this.#fileBase = fileBase;
  }

  async call(method, body = {}) {
    const response = await fetch(
      `${this.#apiBase}/bot${this.#token}/${method}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok || !payload?.ok) {
      const description =
        payload?.description || `${response.status} ${response.statusText}`;
      throw new Error(`Telegram ${method}: ${description}`);
    }

    return payload.result;
  }

  sendMessage(chatId, text, options = {}) {
    return this.call("sendMessage", {
      chat_id: chatId,
      text: text.slice(0, 4096),
      ...options,
    });
  }

  getUpdates(offset, timeout = 30) {
    return this.call("getUpdates", {
      offset,
      timeout,
      allowed_updates: ["message"],
    });
  }

  async downloadAudio(fileId) {
    const file = await this.call("getFile", { file_id: fileId });
    const response = await fetch(
      `${this.#fileBase}/bot${this.#token}/${file.file_path}`,
    );

    if (!response.ok) {
      throw new Error(
        `Telegram download: ${response.status} ${response.statusText}`,
      );
    }

    return {
      bytes: await response.arrayBuffer(),
      fileName: file.file_path.split("/").at(-1) || "audio.ogg",
    };
  }
}
