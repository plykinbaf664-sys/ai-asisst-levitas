import test from "node:test";
import assert from "node:assert/strict";
import {
  formatParseFailure,
  formatChatList,
  formatTask,
  getAudioFile,
  menuReplyMarkup,
  markdownToTelegramHtml,
  parseCommand,
  splitTelegramText,
} from "../src/bot.js";
import { normalizeAudioFileName } from "../src/openai.js";

test("parseCommand parses commands with bot suffix", () => {
  assert.deepEqual(parseCommand("/bind@demo_bot test"), {
    name: "bind",
    args: "test",
  });
  assert.deepEqual(parseCommand("/register@demo_bot"), {
    name: "register",
    args: "",
  });
  assert.deepEqual(parseCommand("/menu"), { name: "menu", args: "" });
  assert.deepEqual(parseCommand("/auto"), { name: "auto", args: "" });
  assert.deepEqual(parseCommand("/task test Маша, подготовь оффер"), {
    name: "task",
    args: "test Маша, подготовь оффер",
  });
});

test("menuReplyMarkup contains personal assistant controls", () => {
  assert.deepEqual(menuReplyMarkup().keyboard, [
    [{ text: "📝 Поставить задачу" }, { text: "🤖 Личный ассистент" }],
    [{ text: "📋 Активные задачи" }, { text: "💬 Чаты" }],
  ]);
});

test("formatChatList shows bound chat aliases", () => {
  assert.equal(
    formatChatList({ test: { title: "Тест Левитас", chat_id: -1001 } }),
    "Привязанные чаты\n\n• test — Тест Левитас",
  );
});

test("splitTelegramText preserves long assistant responses", () => {
  const text = `${"а".repeat(30)}\n${"б".repeat(30)}`;
  assert.deepEqual(splitTelegramText(text, 40), [
    "а".repeat(30),
    "б".repeat(30),
  ]);
});

test("markdownToTelegramHtml renders safe Telegram formatting", () => {
  assert.equal(
    markdownToTelegramHtml(
      "## Вывод\n**Важно:** открыть [сайт](https://example.com?a=1&b=2) и `проверить` <данные>",
    ),
    [
      "<b>Вывод</b>",
      '<b>Важно:</b> открыть <a href="https://example.com?a=1&amp;b=2">сайт</a> и <code>проверить</code> &lt;данные&gt;',
    ].join("\n"),
  );
});

test("formatTask creates expected Telegram message", () => {
  assert.equal(
    formatTask({
      assignee: "Маша",
      task: "подготовить три варианта оффера",
      deadline: "завтра 15:00",
      context: "нужно для запуска рекламы",
      created_by_name: "Юрий",
    }),
    [
      "Новая задача",
      "",
      "Ответственный: Маша",
      "Задача: подготовить три варианта оффера",
      "Срок: завтра 15:00",
      "Контекст: нужно для запуска рекламы",
      "Поставил: Юрий",
      "Статус: в работе",
    ].join("\n"),
  );
});

test("formatTask renders resolved responsible mention as HTML", () => {
  assert.match(
    formatTask({
      assignee: "Юра",
      responsible_mention: '<a href="tg://user?id=123">Юра</a>',
      task: "проверить <отчёт>",
      deadline: null,
      context: null,
      created_by_name: "Boss",
    }),
    /Ответственный: <a href="tg:\/\/user\?id=123">Юра<\/a>\nЗадача: проверить &lt;отчёт&gt;/,
  );
});

test("formatParseFailure includes recognized voice text and missing fields", () => {
  assert.equal(
    formatParseFailure("Маша подготовь оффер", {
      assignee: null,
      task: "",
    }),
    [
      "Не удалось определить ответственного и задачу.",
      "Распознано: «Маша подготовь оффер»",
      "Сформулируйте: имя, действие и ожидаемый результат.",
    ].join("\n"),
  );
});

test("getAudioFile supports Telegram voice, audio and audio documents", () => {
  assert.deepEqual(getAudioFile({ voice: { file_id: "voice-id" } }), {
    fileId: "voice-id",
    sourceType: "voice",
  });
  assert.deepEqual(getAudioFile({ audio: { file_id: "audio-id" } }), {
    fileId: "audio-id",
    sourceType: "audio",
  });
  assert.deepEqual(
    getAudioFile({
      document: { file_id: "document-id", mime_type: "audio/mpeg" },
    }),
    { fileId: "document-id", sourceType: "audio" },
  );
  assert.equal(
    getAudioFile({
      document: { file_id: "document-id", mime_type: "application/pdf" },
    }),
    null,
  );
});

test("normalizeAudioFileName converts Telegram oga files to supported ogg", () => {
  assert.equal(normalizeAudioFileName("voice/file_1.oga"), "voice/file_1.ogg");
  assert.equal(normalizeAudioFileName("voice/file_1.ogg"), "voice/file_1.ogg");
});
