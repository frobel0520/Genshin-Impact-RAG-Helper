import assert from "node:assert/strict";
import test from "node:test";

import {
  COVERAGE_VERDICTS,
  buildCoveragePrompt,
  createCoverageJudge,
  readCoverageVerdict,
} from "../src/generation/evidence-coverage.js";

const CONTENTS = [{ text: "納塔的新區域包括「堅岩隘谷」。" }, { text: "瑪拉妮的元素：水" }];

function judgeWith(reply, overrides = {}) {
  const calls = [];
  const judge = createCoverageJudge({
    chat: async (request) => {
      calls.push(request);
      if (reply instanceof Error) throw reply;
      return reply;
    },
    ...overrides,
  });
  return { judge: judge.judge, calls };
}

test("the prompt carries the question and the approved evidence, numbered", () => {
  const prompt = buildCoveragePrompt({ question: "納塔的火神是誰？", contents: CONTENTS });

  assert.match(prompt, /^問題：納塔的火神是誰？/);
  assert.match(prompt, /\[1\] 納塔的新區域/);
  assert.match(prompt, /\[2\] 瑪拉妮的元素/);
  assert.match(prompt, /YES 或 NO。$/);
  // The generator refuses a prompt with surrounding whitespace, and so should
  // anything else that is handed to a model.
  assert.equal(prompt, prompt.trim());
});

test("a prompt without a question or evidence is refused", () => {
  assert.throws(() => buildCoveragePrompt({ contents: CONTENTS }), /needs a question/);
  assert.throws(
    () => buildCoveragePrompt({ question: "Q", contents: [] }),
    /at least one piece of evidence/,
  );
});

test("YES and NO are read, and anything else is unknown", () => {
  for (const reply of ["YES", "yes", " Yes.", "YES\n"]) {
    assert.equal(readCoverageVerdict(reply), COVERAGE_VERDICTS.COVERED, reply);
  }
  for (const reply of ["NO", "no", " No，證據沒有提到"]) {
    assert.equal(readCoverageVerdict(reply), COVERAGE_VERDICTS.NOT_COVERED, reply);
  }
  // A reviewer that answered oddly has told us nothing. Treating that as a
  // refusal would take a working answer from the reader on no evidence.
  for (const reply of ["也許", "", undefined, null, 42, "I think so"]) {
    assert.equal(readCoverageVerdict(reply), COVERAGE_VERDICTS.UNKNOWN, String(reply));
  }
});

test("the judge reports what the reviewer said", async () => {
  const covered = judgeWith("YES");
  assert.equal(
    await covered.judge({ question: "瑪拉妮是什麼元素？", contents: CONTENTS }),
    COVERAGE_VERDICTS.COVERED,
  );
  assert.equal(covered.calls.length, 1);
  assert.match(covered.calls[0].system, /只回答 YES 或 NO/);

  const notCovered = judgeWith("NO");
  assert.equal(
    await notCovered.judge({ question: "納塔的火神是誰？", contents: CONTENTS }),
    COVERAGE_VERDICTS.NOT_COVERED,
  );
});

test("a judge that cannot run fails open", async () => {
  // The cost of a broken check is a missing check, never a refusal the reader
  // did not earn.
  const failing = judgeWith(new Error("Ollama could not be reached."));
  assert.equal(
    await failing.judge({ question: "Q", contents: CONTENTS }),
    COVERAGE_VERDICTS.UNKNOWN,
  );

  const nonsense = judgeWith("大概吧");
  assert.equal(
    await nonsense.judge({ question: "Q", contents: CONTENTS }),
    COVERAGE_VERDICTS.UNKNOWN,
  );
});

test("no evidence means nothing to judge, and no model call", async () => {
  const { judge, calls } = judgeWith("NO");

  assert.equal(await judge({ question: "Q", contents: [] }), COVERAGE_VERDICTS.UNKNOWN);
  assert.equal(await judge(undefined), COVERAGE_VERDICTS.UNKNOWN);
  assert.equal(calls.length, 0, "a refusal upstream must not cost a model call");
});

test("a check that could not run is logged under the query's trace", async () => {
  const records = [];
  const logger = { logAnswerRun() {}, logFailure: (entry) => records.push(entry) };
  const { judge } = judgeWith(new Error("timeout"), { logger });

  await judge({ question: "Q", contents: CONTENTS, traceId: "t-1", queryId: "qry:t-1" });

  assert.equal(records.length, 1);
  assert.equal(records[0].code, "coverage_check_unavailable");
  assert.equal(records[0].trace_id ?? records[0].traceId, "t-1");
  // Without a trace the record helps nobody and the logger refuses it anyway.
  const untraced = [];
  const quiet = judgeWith(new Error("timeout"), {
    logger: { logAnswerRun() {}, logFailure: (entry) => untraced.push(entry) },
  });
  await quiet.judge({ question: "Q", contents: CONTENTS });
  assert.deepEqual(untraced, []);
});

test("malformed options fail closed", () => {
  assert.throws(() => createCoverageJudge(undefined), /must be a plain object/);
  assert.throws(() => createCoverageJudge({}), /chat must be a function/);
  assert.throws(
    () => createCoverageJudge({ chat: async () => "YES", extra: 1 }),
    /Unknown coverage judge option: extra/,
  );
});
