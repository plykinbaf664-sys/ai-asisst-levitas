import path from "node:path";
import { parseTeamMembers } from "./mentions.js";

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Не задана обязательная env-переменная ${name}`);
  }
  return value;
}

function withoutTrailingSlash(value) {
  return value.replace(/\/+$/, "");
}

export function loadConfig() {
  const managerUserId = process.env.MANAGER_TELEGRAM_USER_ID?.trim();
  const parsedManagerUserId = managerUserId ? Number(managerUserId) : null;
  if (managerUserId && !Number.isSafeInteger(parsedManagerUserId)) {
    throw new Error(
      "MANAGER_TELEGRAM_USER_ID должен быть целым числовым Telegram user id",
    );
  }

  return {
    telegramToken: required("TELEGRAM_BOT_TOKEN"),
    telegramApiBase: withoutTrailingSlash(required("TELEGRAM_API_BASE")),
    telegramFileBase: withoutTrailingSlash(required("TELEGRAM_FILE_BASE")),
    openaiApiKey: required("OPENAI_API_KEY"),
    openaiApiBase: withoutTrailingSlash(required("OPENAI_API_BASE")),
    transcribeModel:
      process.env.OPENAI_TRANSCRIBE_MODEL?.trim() ||
      "gpt-4o-mini-transcribe",
    parseModel:
      process.env.OPENAI_PARSE_MODEL?.trim() || "gpt-4o-mini",
    assistantModel:
      process.env.OPENAI_ASSISTANT_MODEL?.trim() ||
      process.env.OPENAI_PARSE_MODEL?.trim() ||
      "gpt-4o-mini",
    managerUserId: parsedManagerUserId,
    managerDisplayName: process.env.MANAGER_DISPLAY_NAME?.trim() || null,
    teamMembers: parseTeamMembers(process.env.TEAM_MEMBERS_JSON),
    timeZone: process.env.ASSISTANT_TIME_ZONE?.trim() || "Europe/Moscow",
    storageFile: path.resolve(
      process.env.STORAGE_FILE?.trim() || "./data/storage.json",
    ),
  };
}
