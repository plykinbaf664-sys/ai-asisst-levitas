import test from "node:test";
import assert from "node:assert/strict";
import {
  parseTeamMembers,
  resolveResponsibleMention,
} from "../src/mentions.js";

test("parseTeamMembers tolerates empty and invalid JSON", () => {
  assert.deepEqual(parseTeamMembers(""), []);
  assert.deepEqual(parseTeamMembers("{broken"), []);
  assert.deepEqual(parseTeamMembers('{"name":"Юра"}'), []);
});

test("resolveResponsibleMention prefers username ignoring name case", () => {
  const members = parseTeamMembers(
    '[{"name":"Юра","username":"@yura_username","telegramId":123}]',
  );

  assert.deepEqual(resolveResponsibleMention("юра", members), {
    mention: "@yura_username",
    username: "yura_username",
    telegramId: 123,
  });
});

test("resolveResponsibleMention can use a registered Telegram member", () => {
  assert.deepEqual(
    resolveResponsibleMention("ЮРИЙ", [
      {
        name: "Юрий",
        username: "yura_username",
        telegramId: 123,
      },
    ]),
    {
      mention: "@yura_username",
      username: "yura_username",
      telegramId: 123,
    },
  );
});

test("resolveResponsibleMention uses Telegram id when username is absent", () => {
  const members = parseTeamMembers(
    '[{"name":"Александр","telegramId":456}]',
  );

  assert.deepEqual(resolveResponsibleMention("Александр", members), {
    mention: '<a href="tg://user?id=456">Александр</a>',
    username: null,
    telegramId: 456,
  });
});

test("resolveResponsibleMention falls back to escaped responsible name", () => {
  assert.deepEqual(resolveResponsibleMention("Юра <lead>", []), {
    mention: "Юра &lt;lead&gt;",
    username: null,
    telegramId: null,
  });
});
