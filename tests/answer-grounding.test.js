import assert from "node:assert/strict";
import test from "node:test";

import {
  checkAnswerGrounding,
  readsAsCannotAnswer,
  collectQuotedTerms,
} from "../src/generation/answer-grounding.js";
import { createAnswerGenerator } from "../src/generation/answer-generation.js";

const natlanEvidence = [
  {
    text: "◇新增區域：在5.0版本中，納塔地區將開放「堅岩隘谷」、「踞石山」、「湧流地」和「萬火之甌」。",
  },
];

test("a name the evidence never contains is reported", () => {
  // The case this checker exists for: 踞石山 came back as 蓋石山, in a list, with
  // an official announcement cited behind it.
  const result = checkAnswerGrounding({
    answerText: "納塔在5.0版本開放了以下區域：\n\n- 堅岩隘谷\n- 蓋石山\n- 湧流地\n- 萬火之甌",
    contents: natlanEvidence,
  });

  assert.equal(result.grounded, false);
  assert.deepEqual(result.unsupportedTerms, ["蓋石山"]);
});

test("the same list with the right names is grounded", () => {
  const result = checkAnswerGrounding({
    answerText: "納塔在5.0版本開放了以下區域：\n\n- 堅岩隘谷\n- 踞石山\n- 湧流地\n- 萬火之甌",
    contents: natlanEvidence,
  });

  assert.equal(result.grounded, true);
  assert.deepEqual(result.unsupportedTerms, []);
});

test("quoted names are checked wherever they appear", () => {
  const grounded = checkAnswerGrounding({
    answerText: "納塔開放了「踞石山」。",
    contents: natlanEvidence,
  });
  const invented = checkAnswerGrounding({
    answerText: "納塔開放了「無名之地」。",
    contents: natlanEvidence,
  });

  assert.equal(grounded.grounded, true);
  assert.equal(invented.grounded, false);
  assert.deepEqual(invented.unsupportedTerms, ["無名之地"]);
});

test("composed prose is not treated as a copied name", () => {
  // None of this wording appears in the evidence, and none of it is a claim to
  // have copied a name. A checker that fired here would be ignored.
  const result = checkAnswerGrounding({
    answerText: "納塔在5.0版本開放了以下區域，共計四個新的探索地點。",
    contents: natlanEvidence,
  });

  assert.equal(result.grounded, true);
});

test("a list item that is a sentence or carries its own detail is left alone", () => {
  const result = checkAnswerGrounding({
    answerText: "1. 全新角色：\n   - 「瑪拉妮」（五星，水屬性，法器）\n   - 這是模型自己寫的一句話。",
    contents: [{ text: "「嘩啦啦逐浪客·瑪拉妮(水)」（五星）" }],
  });

  // 瑪拉妮 is quoted and does appear; the rest is prose, not a copied name.
  assert.equal(result.grounded, true);
});

test("terms are collected once, in order, and single characters are ignored", () => {
  assert.deepEqual(
    collectQuotedTerms("「踞石山」與「踞石山」，還有「湧流地」，以及「水」。"),
    ["踞石山", "湧流地"],
  );
  assert.deepEqual(collectQuotedTerms(42), []);
});

test("an ungrounded answer falls back to the template and is logged", async () => {
  const failures = [];
  const generator = createAnswerGenerator({
    logger: { logFailure: (record) => failures.push(record) },
    generate: async () => "納塔開放了「蓋石山」。",
  });

  const text = await generator.composeAnswerText({
    question: "納塔在5.0版本開放了哪些區域？",
    contents: natlanEvidence,
    traceId: "trace-1",
    queryId: "qry:trace-1",
  });

  assert.equal(text, undefined, "the citation-only template is safer than a wrong name");
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "ungrounded_answer");
  assert.equal(failures[0].traceId, "trace-1");
  assert.match(failures[0].message, /蓋石山/);
});

test("a logger that rejects the record does not turn a safe fallback into a failure", async () => {
  const generator = createAnswerGenerator({
    logger: {
      logFailure: () => {
        throw new Error("trace_id is required");
      },
    },
    generate: async () => "納塔開放了「蓋石山」。",
  });

  assert.equal(
    await generator.composeAnswerText({
      question: "問題",
      contents: natlanEvidence,
      traceId: "trace-1",
    }),
    undefined,
  );
});

test("without a trace to file it under, the fallback is still taken and simply not logged", async () => {
  let logged = false;
  const generator = createAnswerGenerator({
    logger: { logFailure: () => (logged = true) },
    generate: async () => "納塔開放了「蓋石山」。",
  });

  assert.equal(
    await generator.composeAnswerText({ question: "問題", contents: natlanEvidence }),
    undefined,
  );
  assert.equal(logged, false);
});

test("a grounded answer is returned untouched", async () => {
  const generator = createAnswerGenerator({
    generate: async () => "納塔開放了「踞石山」。",
  });

  assert.equal(
    await generator.composeAnswerText({ question: "問題", contents: natlanEvidence }),
    "納塔開放了「踞石山」。",
  );
});

test("a reply that is nothing but a statement of inability is recognised", () => {
  for (const reply of [
    "證據中沒有提到納塔的火神是誰。",
    "資料中未提及她的生日。",
    "無法根據現有證據回答這個問題。",
    "來源不足以回答這個問題。",
  ]) {
    assert.equal(readsAsCannotAnswer(reply), true, reply);
  }
});

test("a reply that names a gap and then answers is still an answer", () => {
  // The point of the check is to stop a refusal being reported as an answer.
  // Turning a real answer into a refusal would be the worse error, so anything
  // that goes on to say something is left alone.
  for (const reply of [
    "證據中沒有提到她的生日，但瑪拉妮是水元素角色。",
    "證據中沒有提到納塔的火神是誰。不過納塔在5.0版本開放。",
    "瑪拉妮的元素是水。",
    "資料中未提及生日，然而她使用法器。",
  ]) {
    assert.equal(readsAsCannotAnswer(reply), false, reply);
  }
});

test("a long reply is prose, whatever phrases it contains", () => {
  // Past the length limit the reply is no longer a bare statement of inability,
  // and the check refuses to guess which half of it matters.
  assert.equal(
    readsAsCannotAnswer(
      "證據中沒有提到納塔的火神是誰，這個問題需要更多來源才能回答，" +
        "目前匯入的資料只涵蓋版本更新公告與角色簡介，兩者都不談論神明的身分與名號",
    ),
    false,
  );
  // Under the limit and saying nothing else, it is what it looks like.
  assert.equal(
    readsAsCannotAnswer("證據中沒有提到納塔的火神是誰，需要更多來源。"),
    true,
  );
});

test("the inability check is not fooled by non-strings", () => {
  for (const value of [undefined, null, 42, "", "   "]) {
    assert.equal(readsAsCannotAnswer(value), false);
  }
});
