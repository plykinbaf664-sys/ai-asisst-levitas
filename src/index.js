import { Bot } from "./bot.js";
import { loadConfig } from "./config.js";
import { OpenAIClient } from "./openai.js";
import { JsonStorage } from "./storage.js";
import { TelegramClient } from "./telegram.js";

const config = loadConfig();
const storage = new JsonStorage(config.storageFile);
await storage.init();

const telegram = new TelegramClient({
  token: config.telegramToken,
  apiBase: config.telegramApiBase,
  fileBase: config.telegramFileBase,
});
const openai = new OpenAIClient({
  apiKey: config.openaiApiKey,
  apiBase: config.openaiApiBase,
  transcribeModel: config.transcribeModel,
  parseModel: config.parseModel,
  assistantModel: config.assistantModel,
  timeZone: config.timeZone,
});
const bot = new Bot({
  telegram,
  openai,
  storage,
  managerUserId: config.managerUserId,
  managerDisplayName: config.managerDisplayName,
  teamMembers: config.teamMembers,
});

let offset = 0;
let stopping = false;

process.once("SIGINT", () => {
  stopping = true;
});
process.once("SIGTERM", () => {
  stopping = true;
});

console.log("Telegram AI-ассистент запущен в режиме long polling.");

while (!stopping) {
  try {
    const updates = await telegram.getUpdates(offset);
    for (const update of updates) {
      offset = update.update_id + 1;
      if (!update.message) {
        continue;
      }
      try {
        await bot.handleMessage(update.message);
      } catch (error) {
        console.error("Ошибка обработки сообщения:", error);
        await telegram
          .sendMessage(
            update.message.chat.id,
            "Не удалось обработать сообщение. Проверьте настройки и попробуйте ещё раз.",
          )
          .catch((sendError) =>
            console.error("Ошибка отправки уведомления:", sendError),
          );
      }
    }
  } catch (error) {
    console.error("Ошибка polling:", error);
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

console.log("Telegram AI-ассистент остановлен.");
