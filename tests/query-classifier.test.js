import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import {
  QUERY_CLASSIFIER_RULESET_VERSION,
  classifyQuery,
  createQueryClassifier,
} from "../src/query/query-classifier.js";
import { assertQueryPlan } from "../src/query/query-contract.js";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const queryFixture = JSON.parse(
  readFileSync(resolve(PROJECT_ROOT, "fixtures/query-contract.json"), "utf8"),
);
const fixturePack = loadFixtureSourcePack();
const canonicalEntities = fixturePack.canonical_entities;

test("T07 fixture requests classify as structured, narrative, and out of scope", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  assert.deepEqual(classifier.classify(queryFixture.requests[0]), {
    query_category: "structured",
    normalized_entities: [
      {
        entity_id: "ent:raiden-shogun",
        text: "雷電將軍",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: [],
      },
    ],
    version_constraint: "current-unspecified",
    retrieval_mode: "structured",
    spoiler_level: "notice",
  });

  assert.deepEqual(classifier.classify(queryFixture.requests[1]), {
    query_category: "narrative",
    normalized_entities: [
      {
        entity_id: "ent:kamisato-ayaka",
        text: "神里綾華",
        entity_type: "character",
        resolution_status: "resolved",
        aliases_used: [],
      },
    ],
    version_constraint: "exact",
    game_version: "5.0",
    retrieval_mode: "document",
    spoiler_level: "explicit",
  });

  assert.deepEqual(classifier.classify(queryFixture.requests[2]), {
    query_category: "out_of_scope",
    normalized_entities: [],
    version_constraint: "unknown",
    retrieval_mode: "none",
    spoiler_level: "none",
  });
});

test("version update questions use document retrieval without inventing entities", () => {
  const plan = classifyQuery(
    {
      question: "5.0 到 5.1 版本有哪些角色調整與已知問題？",
      spoiler_level: "notice",
    },
    { canonicalEntities },
  );

  assert.deepEqual(plan, {
    query_category: "version",
    normalized_entities: [],
    version_constraint: "range",
    retrieval_mode: "document",
    spoiler_level: "notice",
  });
});

test("explicit aliases resolve deterministically and preserve the matched text", () => {
  const classifier = createQueryClassifier({ canonicalEntities });
  const plan = classifier.classify({
    question: "雷神的元素與武器類型是什麼？",
  });

  assert.equal(plan.query_category, "structured");
  assert.equal(plan.spoiler_level, "none");
  assert.deepEqual(plan.normalized_entities, [
    {
      entity_id: "ent:raiden-shogun",
      text: "雷神",
      entity_type: "character",
      resolution_status: "resolved",
      aliases_used: ["雷神"],
    },
  ]);
});

test("longest explicit name wins and each entity appears once", () => {
  const classifier = createQueryClassifier({ canonicalEntities });
  const plan = classifier.classify({
    question: "Kamisato Ayaka 和 Ayaka 的稀有度",
  });

  assert.deepEqual(plan.normalized_entities, [
    {
      entity_id: "ent:kamisato-ayaka",
      text: "Kamisato Ayaka",
      entity_type: "character",
      resolution_status: "resolved",
      aliases_used: ["Kamisato Ayaka"],
    },
  ]);
});

test("mixed structured and narrative intent routes to hybrid retrieval", () => {
  const classifier = createQueryClassifier({ canonicalEntities });
  const plan = classifier.classify({
    question: "納西妲的稀有度和故事背景是什麼？",
    game_version: null,
    spoiler_level: "explicit",
  });

  assert.equal(plan.query_category, "composite");
  assert.equal(plan.retrieval_mode, "hybrid");
  assert.equal(plan.version_constraint, "current-unspecified");
  assert.equal(plan.normalized_entities[0].entity_id, "ent:nahida");
});

test("out-of-scope policy is fail closed even when a known entity is present", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  for (const question of [
    "雷電將軍怎麼配隊？",
    "神里綾華值得抽嗎？",
    "測試服洩漏了哪些新角色？",
    "天雲草實的最快採集路線",
    fixturePack.test_scenarios.out_of_scope_query.question,
    "下一期卡池是誰？",
    "建議練雷電將軍還是納西妲？",
    "神里綾華的聖遺物推薦是什麼？",
    "要不要抽專武？",
  ]) {
    const plan = classifier.classify({ question });
    assert.equal(plan.query_category, "out_of_scope", question);
    assert.equal(plan.retrieval_mode, "none", question);
  }
});

test("in-scope questions are not over-blocked by the scope patterns", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  for (const question of [
    "雷電將軍的元素屬性是什麼？",
    "雷電將軍的故事背景是什麼？",
    "薙草之稻光的滿級基礎攻擊力是多少？",
    "神里綾華的元素爆發名稱是什麼？",
    "5.0版本更新了哪些內容？",
    "稻妻的世界觀設定是什麼？",
  ]) {
    const plan = classifier.classify({ question });
    assert.notEqual(plan.query_category, "out_of_scope", question);
    assert.notEqual(plan.retrieval_mode, "none", question);
  }
});

test("an unknown entity is never guessed and its question is not called off-topic", () => {
  const classifier = createQueryClassifier({ canonicalEntities });
  const plan = classifier.classify({
    question: "不存在的角色阿晴有什麼能力？",
    game_version: "unknown",
  });

  // The entity stays unresolved — nothing is guessed — but a field question
  // about an unknown character is a question this dataset cannot answer, not
  // one outside the assistant's scope. Structured retrieval returns nothing
  // without a resolved entity, so the refusal reads "insufficient evidence".
  assert.deepEqual(plan, {
    query_category: "structured",
    normalized_entities: [],
    version_constraint: "unknown",
    retrieval_mode: "structured",
    spoiler_level: "none",
  });
});

test("a request for a team is refused however it is worded", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  for (const question of [
    "雷電將軍該配什麼隊伍？",
    "雷電將軍的隊伍怎麼配？",
    "神里綾華適合什麼陣容？",
    "推薦一下雷電將軍的配隊",
  ]) {
    assert.equal(classifier.classify({ question }).query_category, "out_of_scope", question);
  }
});

test("a version nobody has data for is a version question, not an off-topic one", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  for (const question of ["8.0版本有哪些新角色？", "6.0版本新增了什麼武器？"]) {
    const plan = classifier.classify({ question });
    assert.equal(plan.query_category, "version", question);
    assert.equal(plan.retrieval_mode, "document", question);
  }
});

test("request version values take precedence over question inference", () => {
  const classifier = createQueryClassifier({ canonicalEntities });

  assert.equal(
    classifier.classify({ question: "5.0 更新了什麼？", game_version: "unknown" })
      .version_constraint,
    "unknown",
  );
  assert.equal(
    classifier.classify({ question: "雷電將軍的故事", game_version: "3.0-3.8" })
      .version_constraint,
    "range",
  );
  assert.equal(
    classifier.classify({ question: "雷電將軍的故事", game_version: "5.0" })
      .version_constraint,
    "exact",
  );
});

test("classifier validates boundaries, preserves input, and returns QueryPlan", () => {
  const request = {
    question: "  稻妻 的 世界觀？  ",
    locale: "zh-TW",
    request_id: "request-15",
  };
  const before = structuredClone(request);
  const classifier = createQueryClassifier({ canonicalEntities });
  const plan = classifier.classify(request);

  assert.equal(assertQueryPlan(plan), plan);
  assert.deepEqual(request, before);
  assert.equal(classifier.rulesetVersion, QUERY_CLASSIFIER_RULESET_VERSION);
  assert.throws(() => classifier.classify({ question: "" }), /QueryRequest/);
  assert.throws(() => createQueryClassifier({ canonicalEntities: "bad" }), /array/);
  assert.throws(
    () => createQueryClassifier({
      canonicalEntities: [canonicalEntities[0], structuredClone(canonicalEntities[0])],
    }),
    /Duplicate entity ID/,
  );
  assert.throws(
    () => createQueryClassifier({
      canonicalEntities: [
        canonicalEntities[0],
        { ...canonicalEntities[1], aliases: [...canonicalEntities[1].aliases, "雷神"] },
      ],
    }),
    /Ambiguous explicit entity name/,
  );
});
