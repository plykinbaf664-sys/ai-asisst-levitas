import test from "node:test";
import assert from "node:assert/strict";
import {
  extractOutputText,
  formatAssistantResponse,
} from "../src/openai.js";

test("extractOutputText reads Responses API output", () => {
  assert.equal(
    extractOutputText({
      output: [{ content: [{ type: "output_text", text: "Готово" }] }],
    }),
    "Готово",
  );
});

test("formatAssistantResponse keeps inline web citations without duplication", () => {
  assert.equal(
    formatAssistantResponse({
      output: [
        {
          content: [
            {
              type: "output_text",
              text: "Краткий вывод.",
              annotations: [
                {
                  type: "url_citation",
                  title: "Источник",
                  url: "https://example.com/info",
                },
                {
                  type: "url_citation",
                  title: "Источник",
                  url: "https://example.com/info",
                },
              ],
            },
          ],
        },
      ],
    }),
    "Краткий вывод.",
  );
});
