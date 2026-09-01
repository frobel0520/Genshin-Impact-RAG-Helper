import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_GENERATION_MAX_CHARS,
  ANSWER_GENERATION_SYSTEM_PROMPT,
  buildGenerationPrompt,
  createAnswerGenerator,
  normalizeReply,
} from "../src/generation/answer-generation.js";
import {
  DEFAULT_GENERATION_OPTIONS,
  OLLAMA_CHAT_PATH,
  createOllamaGenerator,
} from "../src/generation/ollama-generator.js";

const contents = [
  {
    evidence_id: "evd:one",
    source_kind: "hoyolab",
    source_title: "「榮花與炎日之途」5.0版本更新說明",
    source_url: "https://www.hoyolab.com/article/32547672",
    game_version: "5.0",
    support_type: "direct",
    text: "元素：水",
  },
];

test("the prompt carries the question, the evidence, and nothing else", () => {
  const prompt = buildGenerationPrompt({
    question: "瑪拉妮是什麼元素？",
    contents,
    versionScope: "5.0",
  });

  assert.match(prompt, /問題：瑪拉妮是什麼元素？/);
  assert.match(prompt, /\[1\] （「榮花與炎日之途」5\.0版本更新說明）元素：水/);
  assert.match(prompt, /適用版本：5\.0/);
  assert.equal(prompt.includes("https://"), false, "the model is given no URL to copy");
});

test("an unknown version scope is left out instead of stated as unknown", () => {
  const prompt = buildGenerationPrompt({ question: "問題", contents, versionScope: "unknown" });

  assert.equal(prompt.includes("適用版本"), false);
});

test("a prompt without a question or without evidence is refused", () => {
  assert.throws(() => buildGenerationPrompt({ question: " ", contents }), /question/);
  assert.throws(() => buildGenerationPrompt({ question: "問題", contents: [] }), /evidence/);
});

test("the system prompt forbids outside knowledge and invented sources", () => {
  assert.match(ANSWER_GENERATION_SYSTEM_PROMPT, /只能根據/);
  assert.match(ANSWER_GENERATION_SYSTEM_PROMPT, /不得使用任何其他知識/);
  assert.match(ANSWER_GENERATION_SYSTEM_PROMPT, /不要自己編造來源/);
  assert.match(ANSWER_GENERATION_SYSTEM_PROMPT, /不要自行翻譯/);
  assert.match(ANSWER_GENERATION_SYSTEM_PROMPT, /性別代稱/);
});

test("the generated text is returned trimmed", async () => {
  const generator = createAnswerGenerator({
    generate: async () => "  瑪拉妮是水元素角色。  ",
  });

  assert.equal(
    await generator.composeAnswerText({ question: "瑪拉妮是什麼元素？", contents }),
    "瑪拉妮是水元素角色。",
  );
});

test("the model is given the system prompt and the built prompt", async () => {
  const seen = [];
  const generator = createAnswerGenerator({
    generate: async (request) => {
      seen.push(request);
      return "答案";
    },
  });

  await generator.composeAnswerText({ question: "問題", contents, versionScope: "5.0" });

  assert.equal(seen.length, 1);
  assert.equal(seen[0].system, ANSWER_GENERATION_SYSTEM_PROMPT);
  assert.match(seen[0].prompt, /問題：問題/);
});

test("a model failure falls back to the template and is logged, not thrown", async () => {
  const failures = [];
  const generator = createAnswerGenerator({
    logger: { logFailure: (record) => failures.push(record) },
    generate: async () => {
      const error = new Error("Ollama is down");
      error.code = "dependency_unavailable";
      throw error;
    },
  });

  assert.equal(
    await generator.composeAnswerText({ question: "問題", contents, traceId: "trace-1" }),
    undefined,
  );
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "dependency_unavailable");
  assert.equal(failures[0].traceId, "trace-1");
  assert.match(failures[0].message, /fell back to the template/);
});

test("an unusable reply is discarded so the template speaks instead", async () => {
  for (const reply of ["", "   ", 42, null, "字".repeat(ANSWER_GENERATION_MAX_CHARS * 2 + 1)]) {
    const generator = createAnswerGenerator({ generate: async () => reply });
    assert.equal(
      await generator.composeAnswerText({ question: "問題", contents }),
      undefined,
      String(reply).slice(0, 20),
    );
  }
});

test("normalizeReply keeps a reply at the limit and drops one past twice it", () => {
  const atLimit = "字".repeat(ANSWER_GENERATION_MAX_CHARS);
  assert.equal(normalizeReply(atLimit), atLimit);
  assert.equal(normalizeReply("字".repeat(ANSWER_GENERATION_MAX_CHARS * 2 + 1)), undefined);
});

test("nothing is generated without evidence", async () => {
  let called = false;
  const generator = createAnswerGenerator({
    generate: async () => {
      called = true;
      return "答案";
    },
  });

  assert.equal(await generator.composeAnswerText({ question: "問題", contents: [] }), undefined);
  assert.equal(called, false);
});

test("the generator validates what it is given", () => {
  assert.throws(() => createAnswerGenerator({}), /generate/);
  assert.throws(() => createAnswerGenerator({ generate: async () => "", extra: 1 }), /Unknown/);
});

test("the Ollama adapter posts one deterministic chat request", async () => {
  const calls = [];
  const generator = createOllamaGenerator({
    host: "http://127.0.0.1:11434",
    model: "qwen2.5-coder:14b",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return { ok: true, json: async () => ({ message: { content: "答案" } }) };
    },
  });

  assert.equal(await generator.generate({ system: "系統", prompt: "問題" }), "答案");
  assert.equal(calls[0].url, `http://127.0.0.1:11434${OLLAMA_CHAT_PATH}`);
  assert.equal(calls[0].body.model, "qwen2.5-coder:14b");
  assert.equal(calls[0].body.stream, false);
  assert.deepEqual(calls[0].body.options, DEFAULT_GENERATION_OPTIONS);
  assert.deepEqual(calls[0].body.messages, [
    { role: "system", content: "系統" },
    { role: "user", content: "問題" },
  ]);
});

test("an unreachable or malformed Ollama reply carries a classifiable code", async () => {
  const unreachable = createOllamaGenerator({
    host: "http://127.0.0.1:11434",
    model: "m",
    fetchImpl: async () => {
      throw new Error("ECONNREFUSED");
    },
  });
  await assert.rejects(unreachable.generate({ prompt: "問題" }), (error) => {
    assert.equal(error.code, "dependency_unavailable");
    return true;
  });

  const httpError = createOllamaGenerator({
    host: "http://127.0.0.1:11434",
    model: "m",
    fetchImpl: async () => ({ ok: false, status: 500 }),
  });
  await assert.rejects(httpError.generate({ prompt: "問題" }), /HTTP 500/);

  const malformed = createOllamaGenerator({
    host: "http://127.0.0.1:11434",
    model: "m",
    fetchImpl: async () => ({ ok: true, json: async () => ({}) }),
  });
  await assert.rejects(malformed.generate({ prompt: "問題" }), /assistant message/);
});

test("the Ollama adapter validates its configuration", () => {
  assert.throws(() => createOllamaGenerator({ model: "m" }), /host/);
  assert.throws(() => createOllamaGenerator({ host: "h" }), /model/);
  assert.throws(
    () => createOllamaGenerator({ host: "h", model: "m", timeoutMs: 0 }),
    /timeoutMs/,
  );
});
