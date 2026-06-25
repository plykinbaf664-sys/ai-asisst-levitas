import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { JsonStorage } from "../src/storage.js";

test("JsonStorage persists chats and active tasks", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "levitas-bot-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const file = path.join(directory, "storage.json");
  const storage = new JsonStorage(file);

  await storage.init();
  await storage.bindChat("test", { chat_id: -1001, title: "Test" });
  await storage.registerMember({
    name: "Юрий",
    username: "yura_username",
    telegramId: 123,
  });
  assert.equal(storage.getUserMode(999), "auto");
  await storage.setUserMode(999, "assistant_mode");
  await storage.addTask({
    alias: "test",
    assignee: "Маша",
    task: "подготовить оффер",
  });

  assert.equal(storage.getChat("test").chat_id, -1001);
  assert.deepEqual(storage.listMembers()[0], {
    name: "Юрий",
    username: "yura_username",
    telegramId: 123,
    registered_at: storage.listMembers()[0].registered_at,
  });
  assert.equal(storage.listActiveTasks().length, 1);
  const persisted = JSON.parse(await readFile(file, "utf8"));
  assert.equal(persisted.chats.test.chat_id, -1001);
  assert.equal(persisted.members["123"].username, "yura_username");
  assert.equal(persisted.user_modes["999"], "assistant_mode");
  assert.equal(persisted.tasks.length, 1);
});
