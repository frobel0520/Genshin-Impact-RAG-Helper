import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync, readdirSync } from "node:fs";

import { createQueryRoute, createQueryService } from "../src/api/query-api.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { assertEvalCase, assertEvalResult } from "../src/evaluation/evaluation-contract.js";
import { runEvaluation } from "../src/evaluation/evaluation-runner.js";
import { assertRunResponse } from "../src/domain/run-response-contract.js";
import { assertAnswerResponse } from "../src/policy/evidence-answer-contract.js";
import { assertQueryPlan, assertQueryRequest } from "../src/query/query-contract.js";

/**
 * The contract surface CI must be able to check with no model and no live
 * source. Every one of these runs from fixtures alone: if a change makes one of
 * them need Ollama or a wiki, CI stops being able to tell whether the contracts
 * still hold.
 */
const CONTRACT_SUITES = Object.freeze({
  schema: [
    "domain-contract.test.js",
    "contract-validation.test.js",
    "source-document.test.js",
    "canonical-entity.test.js",
    "fact-claim.test.js",
    "document-chunk.test.js",
    "query-contract.test.js",
    "evidence-answer-contract.test.js",
    "evaluation-contract.test.js",
    "run-response-contract.test.js",
  ],
  policy: [
    "conflict-version-policy.test.js",
    "refusal-scope-policy.test.js",
    "answer-formatter.test.js",
  ],
  api: ["query-api.test.js", "health-api.test.js", "static-assets.test.js", "server.test.js"],
  evaluation: ["evaluation-runner.test.js"],
  acceptance: ["acceptance-scenarios.test.js"],
});

const fixturePack = loadFixtureSourcePack();

test("every contract suite CI depends on is present", () => {
  const files = new Set(readdirSync("tests"));

  for (const [area, suites] of Object.entries(CONTRACT_SUITES)) {
    for (const suite of suites) {
      assert.ok(files.has(suite), `${area} suite ${suite} must exist`);
    }
  }
});

test("the offline guard blocks a live service and allows loopback", async () => {
  await assert.rejects(
    async () => fetch("https://example.com/model"),
    (error) => error.code === "OFFLINE_GUARD",
    "the suite must not be able to reach an external host",
  );

  // Loopback stays open: the API tests serve their own HTTP.
  await assert.rejects(
    async () => fetch("http://127.0.0.1:1/nothing"),
    (error) => error.code !== "OFFLINE_GUARD",
  );
});

test("the fixture pack is a complete stand-in for real sources", () => {
  const kinds = new Set(fixturePack.source_documents.map((source) => source.source_kind));

  assert.deepEqual([...kinds].sort(), ["fandom", "genshin-db", "hoyolab"]);
  assert.ok(fixturePack.conflict_groups.length > 0, "a conflict must be reproducible offline");
  assert.ok(
    fixturePack.document_chunks.some((chunk) => chunk.game_version === "unknown"),
    "an unknown version must be reproducible offline",
  );
  assert.ok(Object.keys(fixturePack.test_scenarios).length >= 6);
});

test("the whole query contract runs on fixtures with a stubbed pipeline", async () => {
  const request = assertQueryRequest({ question: "雷電將軍的元素屬性是什麼？" });
  const queryPlan = assertQueryPlan({
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
    spoiler_level: "none",
  });
  const source = fixturePack.source_documents.find((entry) => entry.source_kind === "hoyolab");

  const service = createQueryService({
    generateTraceId: () => "trace:ci",
    orchestrator: {
      run: async ({ queryId }) => ({
        query_plan: queryPlan,
        bundle: {
          query_id: queryId,
          items: [
            {
              evidence_id: "evd:ci",
              source_id: source.source_id,
              source_kind: source.source_kind,
              source_url: source.source_url,
              source_title: source.title,
              source_retrieved_at: source.retrieved_at,
              game_version: "5.0",
              fact_id: "fact:ci",
              rank: 1,
              support_type: "direct",
            },
          ],
          conflict_groups: [],
        },
      }),
    },
  });

  const response = await service.answer(request);

  assert.equal(assertAnswerResponse(response), response);
  assert.equal(response.answer_status, "answered");
  assert.equal(response.citations[0].source_url, source.source_url);
  assert.equal(typeof createQueryRoute({ service }), "function");
});

test("the evaluation contract runs end to end without a model", async () => {
  const cases = loadEvaluationFixture().cases;

  const { run, results } = await runEvaluation({
    cases,
    runId: "run:ci-contract",
    answer: async () => ({
      answer_status: "refused",
      answer_text: "拒答。",
      query_category: "out_of_scope",
      citations: [],
      version_scope: "unknown",
      uncertainty_reason: "out_of_scope",
      trace_id: "trace:ci",
    }),
  });

  assert.equal(assertRunResponse(run), run);
  for (const evalCase of cases) {
    assert.equal(assertEvalCase(evalCase), evalCase);
  }
  for (const result of results) {
    assert.equal(assertEvalResult(result), result);
  }
});

test("no test reaches a live model or source through the ingest adapters", () => {
  const suites = readdirSync("tests").filter((file) => file.endsWith(".test.js"));

  for (const suite of suites) {
    const source = readFileSync(`tests/${suite}`, "utf8");
    if (!source.includes("createOllamaEmbedder")) {
      continue;
    }
    assert.match(
      source,
      /fetchImpl/,
      `${suite} exercises the Ollama adapter and must inject fetchImpl`,
    );
  }
});

function loadEvaluationFixture() {
  return JSON.parse(readFileSync("fixtures/evaluation-contract.json", "utf8"));
}
