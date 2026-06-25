import { escapeHtml, resolveResponsibleMention } from "./mentions.js";

const ALIAS_PATTERN = /^[a-z0-9_-]{1,32}$/i;
const BUTTON_TASK = "📝 Поставить задачу";
const BUTTON_ASSISTANT = "🤖 Личный ассистент";
const BUTTON_TASKS = "📋 Активные задачи";
const BUTTON_CHATS = "💬 Чаты";

export function parseCommand(text) {
  const match = text
    ?.trim()
    .match(/^\/(start|menu|auto|bind|register|tasks|task)(?:@\w+)?(?:\s+([\s\S]+))?$/i);
  if (!match) {
    return null;
  }
  return { name: match[1].toLowerCase(), args: match[2]?.trim() || "" };
}

export function menuReplyMarkup() {
  return {
    keyboard: [
      [{ text: BUTTON_TASK }, { text: BUTTON_ASSISTANT }],
      [{ text: BUTTON_TASKS }, { text: BUTTON_CHATS }],
    ],
    resize_keyboard: true,
  };
}

export function getAudioFile(message) {
  if (message.voice?.file_id) {
    return { fileId: message.voice.file_id, sourceType: "voice" };
  }
  if (message.audio?.file_id) {
    return { fileId: message.audio.file_id, sourceType: "audio" };
  }
  if (
    message.document?.file_id &&
    message.document.mime_type?.startsWith("audio/")
  ) {
    return { fileId: message.document.file_id, sourceType: "audio" };
  }
  return null;
}

function senderName(message, configuredName) {
  if (configuredName) {
    return configuredName;
  }
  const fullName = [message.from?.first_name, message.from?.last_name]
    .filter(Boolean)
    .join(" ");
  return fullName || message.from?.username || String(message.from?.id);
}

function telegramDisplayName(user) {
  return (
    user?.first_name?.trim() ||
    user?.username ||
    String(user?.id ?? "")
  );
}

export function formatParseFailure(sourceText, parsed) {
  const missing = [
    !parsed.assignee && "ответственного",
    !parsed.task?.trim() && "задачу",
  ].filter(Boolean);
  const recognized = sourceText.trim().slice(0, 1000);

  return [
    `Не удалось определить ${missing.join(" и ")}.`,
    recognized ? `Распознано: «${recognized}»` : null,
    "Сформулируйте: имя, действие и ожидаемый результат.",
  ]
    .filter(Boolean)
    .join("\n");
}

export function formatTask(task) {
  return [
    "Новая задача",
    "",
    `Ответственный: ${task.responsible_mention || escapeHtml(task.assignee)}`,
    `Задача: ${escapeHtml(task.task)}`,
    `Срок: ${escapeHtml(task.deadline || "не указан")}`,
    `Контекст: ${escapeHtml(task.context || "не указан")}`,
    `Поставил: ${escapeHtml(task.created_by_name)}`,
    "Статус: в работе",
  ].join("\n");
}

function formatTaskList(tasks) {
  if (tasks.length === 0) {
    return "Активных задач нет.";
  }

  return [
    "Активные задачи",
    "",
    ...tasks.flatMap((task, index) => [
      `${index + 1}. ${task.assignee} — ${task.task}`,
      `Чат: ${task.alias}; срок: ${task.deadline || "не указан"}`,
      "",
    ]),
  ]
    .join("\n")
    .trim();
}

export function formatChatList(chats) {
  const entries = Object.entries(chats);
  if (entries.length === 0) {
    return "Привязанных чатов нет.";
  }
  return [
    "Привязанные чаты",
    "",
    ...entries.map(([alias, chat]) => `• ${alias} — ${chat.title}`),
  ].join("\n");
}

export function splitTelegramText(text, limit = 3900) {
  const chunks = [];
  let remaining = text.trim();
  while (remaining.length > limit) {
    let splitAt = remaining.lastIndexOf("\n", limit);
    if (splitAt < limit / 2) {
      splitAt = remaining.lastIndexOf(" ", limit);
    }
    if (splitAt < limit / 2) {
      splitAt = limit;
    }
    chunks.push(remaining.slice(0, splitAt).trim());
    remaining = remaining.slice(splitAt).trim();
  }
  if (remaining) {
    chunks.push(remaining);
  }
  return chunks;
}

export function markdownToTelegramHtml(text) {
  const links = [];
  let value = String(text ?? "").replace(
    /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g,
    (_, label, url) => {
      const index = links.push({ label, url }) - 1;
      return `\u0000LINK${index}\u0000`;
    },
  );

  value = escapeHtml(value)
    .replace(/^#{1,6}\s+(.+)$/gm, "<b>$1</b>")
    .replace(/\*\*([^*\n]+)\*\*/g, "<b>$1</b>")
    .replace(/__([^_\n]+)__/g, "<b>$1</b>")
    .replace(/`([^`\n]+)`/g, "<code>$1</code>");

  for (const [index, link] of links.entries()) {
    const safeUrl = escapeHtml(link.url);
    const safeLabel = escapeHtml(link.label);
    value = value.replace(
      `\u0000LINK${index}\u0000`,
      `<a href="${safeUrl}">${safeLabel}</a>`,
    );
  }

  return value;
}

export class Bot {
  #telegram;
  #openai;
  #storage;
  #managerUserId;
  #managerDisplayName;
  #teamMembers;

  constructor({
    telegram,
    openai,
    storage,
    managerUserId,
    managerDisplayName,
    teamMembers = [],
  }) {
    this.#telegram = telegram;
    this.#openai = openai;
    this.#storage = storage;
    this.#managerUserId = managerUserId;
    this.#managerDisplayName = managerDisplayName;
    this.#teamMembers = teamMembers;
  }

  async handleMessage(message) {
    const command = parseCommand(message.text);
    const audioFile = getAudioFile(message);

    if (command?.name === "bind") {
      await this.#handleBind(message, command.args);
      return;
    }

    if (command?.name === "register") {
      await this.#handleRegister(message);
      return;
    }

    if (message.chat.type !== "private") {
      if (audioFile) {
        await this.#telegram.sendMessage(
          message.chat.id,
          "Голосовые задачи нужно отправлять боту в личном чате.",
        );
      }
      return;
    }

    if (!this.#isManager(message.from?.id)) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "У вас нет доступа к этому боту.",
      );
      return;
    }

    if (command?.name === "start" || command?.name === "menu") {
      await this.#showMenu(message);
      return;
    }

    if (command?.name === "auto") {
      await this.#storage.setUserMode(message.from.id, "auto");
      await this.#telegram.sendMessage(
        message.chat.id,
        "Включён автоматический режим. При сомнении сообщение останется в личном ассистенте.",
        { reply_markup: menuReplyMarkup() },
      );
      return;
    }

    if (command?.name === "tasks" || message.text === BUTTON_TASKS) {
      await this.#showTasks(message.chat.id);
      return;
    }

    if (message.text === BUTTON_CHATS) {
      await this.#telegram.sendMessage(
        message.chat.id,
        formatChatList(this.#storage.listChats()),
      );
      return;
    }

    if (message.text === BUTTON_TASK) {
      await this.#storage.setUserMode(message.from.id, "task_mode");
      await this.#telegram.sendMessage(
        message.chat.id,
        "Режим постановки задач включён. Отправьте текст или голосовое поручение.",
        { reply_markup: menuReplyMarkup() },
      );
      return;
    }

    if (message.text === BUTTON_ASSISTANT) {
      await this.#storage.setUserMode(message.from.id, "assistant_mode");
      await this.#telegram.sendMessage(
        message.chat.id,
        "Режим личного ассистента включён. Ответы останутся только в этом чате.",
        { reply_markup: menuReplyMarkup() },
      );
      return;
    }

    if (command?.name === "task") {
      const [alias, ...parts] = command.args.split(/\s+/);
      const taskText = parts.join(" ").trim();
      if (!alias || !taskText) {
        await this.#telegram.sendMessage(
          message.chat.id,
          "Формат: /task <alias> <текст задачи>",
        );
        return;
      }
      await this.#createTask(message, taskText, alias.toLowerCase());
      return;
    }

    let sourceText = message.text?.trim() || null;
    let sourceType = "text";
    if (audioFile) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Принял голосовое, расшифровываю…",
      );
      const audio = await this.#telegram.downloadAudio(audioFile.fileId);
      sourceText = await this.#openai.transcribe(audio);
      sourceType = audioFile.sourceType;
    }

    if (!sourceText) {
      await this.#showMenu(message);
      return;
    }

    await this.#routePrivateMessage(message, sourceText, sourceType);
  }

  async #showMenu(message) {
    const mode = this.#storage.getUserMode(message.from.id);
    const labels = {
      auto: "автоматический",
      task_mode: "постановка задач",
      assistant_mode: "личный ассистент",
    };
    await this.#telegram.sendMessage(
      message.chat.id,
      `Выберите режим работы.\nТекущий режим: ${labels[mode]}.`,
      { reply_markup: menuReplyMarkup() },
    );
  }

  async #showTasks(chatId) {
    await this.#telegram.sendMessage(
      chatId,
      formatTaskList(this.#storage.listActiveTasks()),
    );
  }

  async #routePrivateMessage(message, sourceText, sourceType) {
    const mode = this.#storage.getUserMode(message.from.id);
    if (mode === "task_mode") {
      await this.#createTask(message, sourceText, null, sourceType, true);
      return;
    }

    if (mode === "assistant_mode") {
      await this.#answerAssistant(message.chat.id, sourceText);
      return;
    }

    const intent = await this.#openai.classifyIntent(sourceText);
    if (intent === "task_to_chat") {
      await this.#createTask(message, sourceText, null, sourceType, true);
      return;
    }
    await this.#answerAssistant(message.chat.id, sourceText);
  }

  async #answerAssistant(chatId, sourceText) {
    await this.#telegram.sendMessage(chatId, "Выполняю…");
    const answer = await this.#openai.answerAssistant(sourceText);
    for (const chunk of splitTelegramText(answer)) {
      await this.#telegram.sendMessage(
        chatId,
        markdownToTelegramHtml(chunk),
        { parse_mode: "HTML" },
      );
    }
  }

  async #handleBind(message, rawAlias) {
    if (message.chat.type === "private") {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Команду /bind нужно отправить в тестовом групповом чате.",
      );
      return;
    }

    if (!this.#isManager(message.from?.id)) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Только настроенный руководитель может привязать чат.",
      );
      return;
    }

    const alias = rawAlias.toLowerCase();
    if (!ALIAS_PATTERN.test(alias)) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Формат: /bind <alias>. Alias: латиница, цифры, _ или -, до 32 символов.",
      );
      return;
    }

    await this.#storage.bindChat(alias, {
      chat_id: message.chat.id,
      title: message.chat.title || alias,
    });
    await this.#telegram.sendMessage(
      message.chat.id,
      `Чат привязан под alias «${alias}».`,
    );
  }

  async #handleRegister(message) {
    if (message.chat.type === "private") {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Команду /register нужно отправить в групповом чате команды.",
      );
      return;
    }

    if (!message.from?.id) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Не удалось получить Telegram-профиль отправителя.",
      );
      return;
    }

    const member = await this.#storage.registerMember({
      name: telegramDisplayName(message.from),
      username: message.from.username,
      telegramId: message.from.id,
    });
    const mention = resolveResponsibleMention(member.name, [member]).mention;

    await this.#telegram.sendMessage(
      message.chat.id,
      `Участник зарегистрирован: ${mention}`,
      { parse_mode: "HTML" },
    );
  }

  async #createTask(
    message,
    sourceText,
    forcedAlias = null,
    sourceType = "text",
    allowDefaultTest = false,
  ) {
    const aliases = this.#storage.listChats();
    if (Object.keys(aliases).length === 0) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Сначала добавьте бота в тестовый чат и выполните там /bind test.",
      );
      return;
    }

    if (forcedAlias && !aliases[forcedAlias]) {
      await this.#telegram.sendMessage(
        message.chat.id,
        `Чат с alias «${forcedAlias}» не привязан.`,
      );
      return;
    }

    const parsed = await this.#openai.parseTask(
      sourceText,
      aliases,
      forcedAlias,
    );
    let target = parsed.alias ? aliases[parsed.alias.toLowerCase()] : null;
    if (!target && allowDefaultTest && aliases.test) {
      parsed.alias = "test";
      target = aliases.test;
    }

    if (!target) {
      await this.#telegram.sendMessage(
        message.chat.id,
        "Не удалось определить целевой чат. Назовите alias, например «в тестовый чат», или используйте /task test ...",
      );
      return;
    }
    if (!parsed.assignee || !parsed.task?.trim()) {
      await this.#telegram.sendMessage(
        message.chat.id,
        formatParseFailure(sourceText, parsed),
      );
      return;
    }

    const registeredMembers = this.#storage.listMembers();
    const responsible = resolveResponsibleMention(parsed.assignee, [
      ...registeredMembers,
      ...this.#teamMembers,
    ]);
    const task = await this.#storage.addTask({
      alias: parsed.alias.toLowerCase(),
      chat_id: target.chat_id,
      assignee: parsed.assignee.trim(),
      responsible_mention: responsible.mention,
      responsible_username: responsible.username,
      responsible_telegram_id: responsible.telegramId,
      task: parsed.task.trim(),
      deadline: parsed.deadline,
      deadline_iso: parsed.deadline_iso,
      context: parsed.context,
      source_text: sourceText,
      source_type: sourceType,
      created_by_user_id: message.from.id,
      created_by_name: senderName(message, this.#managerDisplayName),
    });

    try {
      await this.#telegram.sendMessage(target.chat_id, formatTask(task), {
        parse_mode: "HTML",
      });
    } catch (error) {
      console.error("Не удалось отправить сохранённую задачу:", error);
      await this.#telegram.sendMessage(
        message.chat.id,
        "Задача сохранена, но отправить её в целевой чат не удалось.",
      );
      return;
    }

    await this.#telegram.sendMessage(
      message.chat.id,
      `Готово. Задача отправлена в «${task.alias}».`,
    );
  }

  #isManager(userId) {
    return !this.#managerUserId || userId === this.#managerUserId;
  }
}
