const TASK_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "alias",
    "assignee",
    "task",
    "deadline",
    "deadline_iso",
    "context",
  ],
  properties: {
    alias: {
      type: ["string", "null"],
      description: "Alias целевого Telegram-чата.",
    },
    assignee: {
      type: ["string", "null"],
      description: "Имя ответственного в именительном падеже.",
    },
    task: {
      type: "string",
      description: "Краткая задача в форме инфинитива, без ответственного.",
    },
    deadline: {
      type: ["string", "null"],
      description: "Короткий срок для отображения, например «завтра 15:00».",
    },
    deadline_iso: {
      type: ["string", "null"],
      description: "Срок в ISO 8601 с часовым поясом, если он определён.",
    },
    context: {
      type: ["string", "null"],
      description: "Причина или дополнительный контекст задачи.",
    },
  },
};

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["intent"],
  properties: {
    intent: {
      type: "string",
      enum: ["task_to_chat", "personal_assistant"],
    },
  },
};

export function normalizeAudioFileName(fileName) {
  return fileName.toLowerCase().endsWith(".oga")
    ? `${fileName.slice(0, -4)}.ogg`
    : fileName;
}

export class OpenAIClient {
  #apiKey;
  #apiBase;
  #transcribeModel;
  #parseModel;
  #assistantModel;
  #timeZone;

  constructor({
    apiKey,
    apiBase,
    transcribeModel,
    parseModel,
    assistantModel,
    timeZone,
  }) {
    this.#apiKey = apiKey;
    this.#apiBase = apiBase;
    this.#transcribeModel = transcribeModel;
    this.#parseModel = parseModel;
    this.#assistantModel = assistantModel;
    this.#timeZone = timeZone;
  }

  async transcribe({ bytes, fileName }) {
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "audio/ogg" }),
      normalizeAudioFileName(fileName),
    );
    form.append("model", this.#transcribeModel);
    form.append("response_format", "json");
    form.append(
      "prompt",
      "Русская голосовая команда руководителя: чат, ответственный, задача, дедлайн и контекст.",
    );

    const payload = await this.#request("/audio/transcriptions", {
      method: "POST",
      body: form,
    });

    if (!payload.text?.trim()) {
      throw new Error("OpenAI вернул пустую транскрипцию");
    }

    return payload.text.trim();
  }

  async parseTask(text, aliases, forcedAlias = null) {
    const now = new Date();
    const aliasList = Object.entries(aliases).map(([alias, chat]) => ({
      alias,
      title: chat.title,
    }));

    const payload = await this.#request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#parseModel,
        store: false,
        input: [
          {
            role: "system",
            content: [
              "Извлеки управленческую задачу из русской команды.",
              `Текущая дата и время: ${now.toISOString()}. Часовой пояс пользователя: ${this.#timeZone}.`,
              `Доступные чаты: ${JSON.stringify(aliasList)}.`,
              forcedAlias
                ? `Целевой alias уже задан командой: ${forcedAlias}.`
                : "Сопоставь упоминание чата с доступным alias. Если доступен ровно один чат и целевой чат очевиден или не назван, используй его.",
              "Текст может быть неточной транскрипцией разговорной русской речи без пунктуации.",
              "Имя перед просьбой или повелительным глаголом считай ответственным: «Маша подготовь оффер» означает assignee «Маша» и task «подготовить оффер».",
              "Формулировки «попроси Машу подготовить оффер» и «Маше нужно подготовить оффер» также означают assignee «Маша».",
              "Ответственный, действие, срок и контекст могут находиться в любом порядке и быть разделены лишними разговорными фразами.",
              "Приводи имя ответственного к именительному падежу, если оно явно названо: «передай Васе» означает assignee «Вася».",
              "Не требуй явных слов «задача», «ответственный», «срок» или специального шаблона команды.",
              "Если действие и ожидаемый результат понятны, обязательно заполни task, даже если в речи есть слова-паразиты или вводные слова.",
              "Не выдумывай ответственного, срок или контекст.",
              "Поле task должно содержать только действие и результат, без вводных слов.",
            ].join("\n"),
          },
          { role: "user", content: text },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "telegram_task",
            strict: true,
            schema: TASK_SCHEMA,
          },
        },
      }),
    });

    const outputText = payload.output
      ?.flatMap((item) => item.content ?? [])
      .find((item) => item.type === "output_text")?.text;

    if (!outputText) {
      throw new Error("OpenAI не вернул структурированный результат");
    }

    const parsed = JSON.parse(outputText);
    if (forcedAlias) {
      parsed.alias = forcedAlias;
    }
    return parsed;
  }

  async classifyIntent(text) {
    const payload = await this.#request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#parseModel,
        store: false,
        input: [
          {
            role: "system",
            content: [
              "Классифицируй сообщение руководителя для Telegram-ассистента.",
              "task_to_chat выбирай только для явного поручения конкретному человеку или явной просьбы поставить/отправить задачу в рабочий чат.",
              "Примеры task_to_chat: «Маша сделай отчёт», «поставь Саше задачу», «отправь в тестовый чат», «передай Юре подготовить оффер».",
              "personal_assistant выбирай для вопросов, анализа, поиска вариантов, планирования, советов, разбора рисков и просьб помочь подумать.",
              "Примеры personal_assistant: «подбери варианты», «разбери риски», «что лучше», «составь план поездки», «помоги принять решение».",
              "Если есть сомнение, выбирай personal_assistant, чтобы личный запрос не ушёл в рабочий чат.",
            ].join("\n"),
          },
          { role: "user", content: text },
        ],
        text: {
          format: {
            type: "json_schema",
            name: "message_intent",
            strict: true,
            schema: INTENT_SCHEMA,
          },
        },
      }),
    });

    return JSON.parse(extractOutputText(payload)).intent;
  }

  async answerAssistant(text) {
    const payload = await this.#request("/responses", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        model: this.#assistantModel,
        store: false,
        tools: [
          {
            type: "web_search_preview",
            search_context_size: "medium",
          },
        ],
        input: [
          `Request ID: ${crypto.randomUUID()}.`,
          "Ты исполнительный личный ассистент руководителя.",
          "Сделай то, что просит пользователь: дай готовый план, список, сравнение, текст, решение или конкретные варианты.",
          "Не пересказывай запрос, не объясняй ход рассуждений и не добавляй общие советы.",
          "Сохрани все детали исходного запроса: имена, компании, города, даты, длительность, бюджет, ограничения и желаемый результат.",
          "Не заменяй указанные пользователем компании, маршруты и условия на похожие.",
          "Если в исходных данных есть противоречие, сначала коротко укажи его, затем предложи рабочее решение.",
          "Для актуальных внешних фактов используй интернет-поиск. Проверяй именно сущности и условия из исходного запроса; приоритет — официальные сайты компаний, аэропортов и государственных органов.",
          "Первое предложение должно содержать конкретный вывод или рекомендацию.",
          "Пиши по-русски, коротко и конкретно: обычно до 800 символов.",
          "Не добавляй справочную историю и фон, если пользователь их не просил.",
          "Используй не больше трёх коротких разделов. Не создавай разделы, которые не помогают выполнить запрос.",
          "Ссылки оставляй кликабельными.",
          "Не утверждай, что выполнил покупку, бронирование или другое внешнее действие.",
          "",
          "ИСХОДНЫЙ ЗАПРОС — не изменяй его смысл:",
          "---",
          text,
          "---",
        ].join("\n"),
      }),
    });

    return formatAssistantResponse(payload);
  }

  async #request(path, options) {
    const headers = new Headers(options.headers);
    headers.set("authorization", `Bearer ${this.#apiKey}`);

    const response = await fetch(`${this.#apiBase}${path}`, {
      ...options,
      headers,
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      const message =
        payload?.error?.message || `${response.status} ${response.statusText}`;
      throw new Error(`OpenAI API: ${message}`);
    }

    return payload;
  }
}

export function extractOutputText(payload) {
  const text = payload.output
    ?.flatMap((item) => item.content ?? [])
    .find((item) => item.type === "output_text")?.text;
  if (!text?.trim()) {
    throw new Error("OpenAI не вернул текстовый результат");
  }
  return text.trim();
}

export function formatAssistantResponse(payload) {
  const contentItems = payload.output?.flatMap((item) => item.content ?? []) ?? [];
  const output = contentItems.find((item) => item.type === "output_text");
  if (!output?.text?.trim()) {
    throw new Error("OpenAI не вернул ответ личного ассистента");
  }
  return output.text.trim();
}
