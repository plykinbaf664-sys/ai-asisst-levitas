import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const EMPTY_STATE = {
  chats: {},
  members: {},
  tasks: [],
  user_modes: {},
};

export class JsonStorage {
  #file;
  #state = structuredClone(EMPTY_STATE);
  #writeQueue = Promise.resolve();

  constructor(file) {
    this.#file = file;
  }

  async init() {
    await mkdir(path.dirname(this.#file), { recursive: true });

    try {
      const raw = await readFile(this.#file, "utf8");
      const parsed = JSON.parse(raw);
      this.#state = {
        chats: parsed.chats ?? {},
        members: parsed.members ?? {},
        tasks: parsed.tasks ?? [],
        user_modes: parsed.user_modes ?? {},
      };
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.#persist();
    }
  }

  listChats() {
    return structuredClone(this.#state.chats);
  }

  getChat(alias) {
    const chat = this.#state.chats[alias];
    return chat ? structuredClone(chat) : null;
  }

  async bindChat(alias, chat) {
    this.#state.chats[alias] = {
      ...chat,
      bound_at: new Date().toISOString(),
    };
    await this.#persist();
    return this.getChat(alias);
  }

  listMembers() {
    return Object.values(this.#state.members).map((member) =>
      structuredClone(member),
    );
  }

  async registerMember(member) {
    const telegramId = Number(member.telegramId);
    if (!Number.isSafeInteger(telegramId) || telegramId <= 0) {
      throw new Error("Для регистрации нужен корректный Telegram user id");
    }

    const saved = {
      name: String(member.name ?? "").trim(),
      username: member.username
        ? String(member.username).trim().replace(/^@/, "")
        : null,
      telegramId,
      registered_at: new Date().toISOString(),
    };
    this.#state.members[String(telegramId)] = saved;
    await this.#persist();
    return structuredClone(saved);
  }

  getUserMode(userId) {
    return this.#state.user_modes[String(userId)] ?? "auto";
  }

  async setUserMode(userId, mode) {
    if (!["task_mode", "assistant_mode", "auto"].includes(mode)) {
      throw new Error(`Неизвестный режим пользователя: ${mode}`);
    }
    this.#state.user_modes[String(userId)] = mode;
    await this.#persist();
    return mode;
  }

  async addTask(task) {
    const saved = {
      id: crypto.randomUUID(),
      status: "in_progress",
      created_at: new Date().toISOString(),
      ...task,
    };
    this.#state.tasks.push(saved);
    await this.#persist();
    return structuredClone(saved);
  }

  listActiveTasks() {
    return this.#state.tasks
      .filter((task) => task.status === "in_progress")
      .map((task) => structuredClone(task));
  }

  async #persist() {
    const snapshot = JSON.stringify(this.#state, null, 2);
    const temporaryFile = `${this.#file}.tmp`;

    this.#writeQueue = this.#writeQueue.then(async () => {
      await writeFile(temporaryFile, snapshot, "utf8");
      await rename(temporaryFile, this.#file);
    });

    return this.#writeQueue;
  }
}
