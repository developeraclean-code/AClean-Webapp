import { afterEach, describe, expect, it } from "vitest";
import { callVision } from "../../../api/_vision-provider.js";

const previousClaude = process.env.ANTHROPIC_API_KEY;
const previousOpenAI = process.env.OPENAI_API_KEY;
afterEach(() => {
  if (previousClaude === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = previousClaude;
  if (previousOpenAI === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = previousOpenAI;
});

describe("provider AI Vision", () => {
  it("mengirim skema Claude saat provider Claude dipilih", async () => {
    process.env.ANTHROPIC_API_KEY = "test-claude";
    let request;
    const result = await callVision({ provider: "claude", imageBase64: "YWJj", prompt: "Baca foto", fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ content: [{ text: '{"ok":true}' }], usage: { input_tokens: 12, output_tokens: 4 } }) };
    } });
    expect(request.url).toBe("https://api.anthropic.com/v1/messages");
    expect(JSON.parse(request.options.body).messages[0].content[0].source.type).toBe("base64");
    expect(result).toMatchObject({ provider: "claude", text: '{"ok":true}', usage: { input_tokens: 12 } });
  });

  it("mengirim skema gambar OpenAI dan menormalisasi usage", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    let request;
    const result = await callVision({ provider: "openai", imageBase64: "YWJj", prompt: "Baca foto", fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }], usage: { prompt_tokens: 20, completion_tokens: 5 } }) };
    } });
    const body = JSON.parse(request.options.body);
    expect(request.url).toBe("https://api.openai.com/v1/chat/completions");
    expect(body.model).toBe("gpt-6-luna");
    expect(body.messages[0].content[1].image_url.url).toMatch(/^data:image\/jpeg;base64,/);
    expect(result).toMatchObject({ provider: "openai", usage: { input_tokens: 20, output_tokens: 5 } });
  });

  it("tidak mengganti ke Claude diam-diam ketika OpenAI kehabisan kredit", async () => {
    process.env.OPENAI_API_KEY = "test-openai";
    await expect(callVision({ provider: "openai", imageUrl: "https://example.test/photo.jpg", prompt: "Baca foto",
      fetchImpl: async () => ({ ok: false, status: 429, json: async () => ({ error: { code: "credit_balance_exhausted" } }) }),
    })).rejects.toThrow("credit_balance_exhausted");
  });
});
