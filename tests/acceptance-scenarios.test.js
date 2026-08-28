import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { createQueryService } from "../src/api/query-api.js";
import {
  assertAnswerResponse,
  assertEvidenceBundle,
} from "../src/policy/evidence-answer-contract.js";
import { createDocumentRetriever } from "../src/query/document-retrieval.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
import { createQueryOrchestrator } from "../src/query/query-orchestrator.js";
import { createStructuredRetriever } from "../src/query/structured-retrieval.js";

/**
 * End-to-end regression net for the T12 acceptance scenarios.
 *
 * Every case is driven from `fixtures/fixture-source-pack.json` rather than
 * from copied strings, so a scenario can never silently drift away from the
 * pipeline that is supposed to satisfy it. Scenarios that the current pipeline
 * cannot satisfy are skipped with the reason, never rewritten to match the
 * behaviour we actually have.
 */

const fixturePack = loadFixtureSourcePack();
const scenarios = fixturePack.test_scenarios;

/** Deterministic offline embedder: character codes hashed into fixed buckets. */
function embedText(text) {
  const vector = new Float32Array(FIXED_EMBEDDING_DIMENSIONS);
  for (const character of text) {
    vector[character.codePointAt(0) % FIXED_EMBEDDING_DIMENSIONS] += 1;
  }
  vector[0] += 1;
  return vector;
}

async function createPipeline(context) {
  const structuredStore = createStructuredStore();
  const documentStore = createDocumentStore();
  context.after(() => {
    if (structuredStore.getStatus().isOpen) structuredStore.close();
    if (documentStore.getStatus().isOpen) documentStore.close();
  });

  structuredStore.replaceData(structuredClone({
    source_documents: fixturePack.source_documents,
    canonical_entities: fixturePack.canonical_entities,
    structured_facts: fixturePack.structured_facts,
    claims: fixturePack.claims,
    conflict_groups: fixturePack.conflict_groups,
  }));
  await buildFixedIndex({
    store: documentStore,
    data: structuredClone({
      source_documents: fixturePack.source_documents,
      canonical_entities: fixturePack.canonical_entities,
      document_chunks: fixturePack.document_chunks,
    }),
    embedDocuments: (texts) => texts.map((text) => embedText(text)),
  });

  const classifier = createQueryClassifier({
    canonicalEntities: fixturePack.canonical_entities,
  });
  const structuredRetriever = createStructuredRetriever({ store: structuredStore });
  const documentRetriever = createDocumentRetriever({
    store: documentStore,
    embedQuery: embedText,
  });

  const service = createQueryService({
    orchestrator: createQueryOrchestrator({
      classifier,
      structuredRetriever,
      documentRetriever,
    }),
    generateTraceId: () => "trace-acceptance",
  });

  async function run(scenarioName) {
    const { question } = scenarios[scenarioName];
    const queryId = `qry:${scenarioName.replaceAll("_", "-")}`;
    const queryPlan = classifier.classify({ question });
    const structured = structuredRetriever.retrieve({ queryId, queryPlan });
    const document = await documentRetriever.retrieve({ queryId, queryPlan, question });

    assert.equal(assertEvidenceBundle(structured), structured);
    assert.equal(assertEvidenceBundle(document), document);
    return { queryPlan, structured, document };
  }

  /** The same scenario as the player would ask it: question in, AnswerResponse out. */
  run.answer = (scenarioName, overrides = {}) =>
    service.answer({ question: scenarios[scenarioName].question, ...overrides });
  return run;
}

/**
 * What each acceptance scenario must end as. Retrieval assertions alone cannot
 * catch a policy that quietly answers a refusal or refuses an answerable
 * question, so every scenario is pinned to its final status here.
 */
const EXPECTED_ANSWERS = Object.freeze({
  // A single-source structured fact with a known version.
  answerable_character_query: { answer_status: "answered", citations: "some" },
  // The weapon fact carries no game version, so the answer is scoped-unsure.
  answerable_weapon_query: {
    answer_status: "uncertain",
    uncertainty_reason: "version_unknown",
    citations: "some",
  },
  // Official HoYoLAB dominates the differing wiki claim, which is not cited.
  conflict_query: { answer_status: "answered", citations: "some" },
  version_range_query: { answer_status: "answered", citations: "some" },
  // Entity-less lore retrieval spans chunks whose versions are not all known.
  unclassified_lore_query: {
    answer_status: "uncertain",
    uncertainty_reason: "version_unknown",
    citations: "some",
  },
  out_of_scope_query: {
    answer_status: "refused",
    uncertainty_reason: "out_of_scope",
    citations: "none",
  },
});

function resolvedEntityIds(queryPlan) {
  return queryPlan.normalized_entities
    .filter((entity) => entity.resolution_status === "resolved")
    .map((entity) => entity.entity_id);
}

test("every declared scenario ID exists in the fixture pack", () => {
  const factIds = new Set(fixturePack.structured_facts.map((fact) => fact.fact_id));
  const claimIds = new Set(fixturePack.claims.map((claim) => claim.claim_id));
  const chunkIds = new Set(fixturePack.document_chunks.map((chunk) => chunk.chunk_id));
  const entityIds = new Set(fixturePack.canonical_entities.map((entity) => entity.entity_id));
  const groupIds = new Set(
    fixturePack.conflict_groups.map((group) => group.conflict_group_id),
  );
  const collections = {
    expected_fact_id: factIds,
    official_claim_id: claimIds,
    differing_claim_id: claimIds,
    target_chunk_id: chunkIds,
    target_entity_id: entityIds,
    conflict_group_id: groupIds,
  };

  for (const [name, scenario] of Object.entries(scenarios)) {
    assert.ok(scenario.question?.length > 0, `${name} must declare a question`);
    for (const [field, ids] of Object.entries(collections)) {
      if (scenario[field] !== undefined) {
        assert.ok(ids.has(scenario[field]), `${name}.${field} references ${scenario[field]}`);
      }
    }
  }
});

test("answerable_character_query returns the expected structured fact", async (context) => {
  const run = await createPipeline(context);
  const { queryPlan, structured } = await run("answerable_character_query");
  const scenario = scenarios.answerable_character_query;

  assert.equal(queryPlan.retrieval_mode, "structured");
  assert.deepEqual(resolvedEntityIds(queryPlan), [scenario.target_entity_id]);
  assert.ok(
    structured.items.some((item) => item.fact_id === scenario.expected_fact_id),
    `structured bundle must contain ${scenario.expected_fact_id}`,
  );
});

test("answerable_weapon_query returns the expected structured fact", async (context) => {
  const run = await createPipeline(context);
  const { queryPlan, structured } = await run("answerable_weapon_query");
  const scenario = scenarios.answerable_weapon_query;

  assert.equal(queryPlan.retrieval_mode, "structured");
  assert.deepEqual(resolvedEntityIds(queryPlan), [scenario.target_entity_id]);
  assert.ok(
    structured.items.some((item) => item.fact_id === scenario.expected_fact_id),
    `structured bundle must contain ${scenario.expected_fact_id}`,
  );
});

test("conflict_query surfaces both claims and their conflict group", async (context) => {
  const run = await createPipeline(context);
  const { queryPlan, structured } = await run("conflict_query");
  const scenario = scenarios.conflict_query;

  assert.deepEqual(resolvedEntityIds(queryPlan), [scenario.target_entity_id]);

  const claimIds = structured.items.filter((item) => item.claim_id).map((item) => item.claim_id);
  assert.ok(claimIds.includes(scenario.official_claim_id));
  assert.ok(claimIds.includes(scenario.differing_claim_id));

  const group = structured.conflict_groups.find(
    (candidate) => candidate.conflict_group_id === scenario.conflict_group_id,
  );
  assert.ok(group, `conflict group ${scenario.conflict_group_id} must be reported`);
  assert.deepEqual(
    [...group.claim_ids].sort(),
    [scenario.official_claim_id, scenario.differing_claim_id].sort(),
  );
  for (const claimId of [scenario.official_claim_id, scenario.differing_claim_id]) {
    const item = structured.items.find((candidate) => candidate.claim_id === claimId);
    assert.equal(item.support_type, "conflicting", claimId);
  }
});

test("out_of_scope_query is refused and retrieves no evidence", async (context) => {
  const run = await createPipeline(context);
  const { queryPlan, structured, document } = await run("out_of_scope_query");

  assert.equal(queryPlan.query_category, "out_of_scope");
  assert.equal(queryPlan.retrieval_mode, "none");
  assert.deepEqual(structured.items, []);
  assert.deepEqual(document.items, []);
});

test("version_range_query returns the expected release-window fact", async (context) => {
  const run = await createPipeline(context);
  const { queryPlan, structured } = await run("version_range_query");
  const scenario = scenarios.version_range_query;

  assert.equal(queryPlan.version_constraint, "range");
  assert.ok(structured.items.some((item) => item.fact_id === scenario.expected_fact_id));
});

test("unclassified_lore_query returns the unclassified world-lore chunk", async (context) => {
  const run = await createPipeline(context);
  const { document } = await run("unclassified_lore_query");
  const scenario = scenarios.unclassified_lore_query;

  assert.ok(document.items.some((item) => item.chunk_id === scenario.target_chunk_id));
});

test("every acceptance scenario ends in the answer status it is meant to", async (context) => {
  const run = await createPipeline(context);

  for (const [name, expected] of Object.entries(EXPECTED_ANSWERS)) {
    const response = await run.answer(name);

    assert.equal(assertAnswerResponse(response), response, name);
    assert.equal(response.answer_status, expected.answer_status, name);
    assert.equal(response.uncertainty_reason, expected.uncertainty_reason, name);
    assert.equal(response.citations.length > 0, expected.citations === "some", name);
  }
});

test("the conflict scenario never cites the source whose claim was rejected", async (context) => {
  const run = await createPipeline(context);
  const scenario = scenarios.conflict_query;

  const response = await run.answer("conflict_query");

  const rejectedSourceId = fixturePack.claims.find(
    (claim) => claim.claim_id === scenario.differing_claim_id,
  ).source_id;
  const rejectedSourceUrl = fixturePack.source_documents.find(
    (source) => source.source_id === rejectedSourceId,
  ).source_url;
  assert.equal(
    response.citations.some((citation) => citation.source_url === rejectedSourceUrl),
    false,
  );
});

test("a refused answer carries no spoiler notice, because it has no content", async (context) => {
  const run = await createPipeline(context);

  const refused = await run.answer("out_of_scope_query", { spoiler_level: "notice" });
  const answered = await run.answer("answerable_character_query", { spoiler_level: "notice" });

  assert.equal(refused.answer_status, "refused");
  assert.equal(refused.spoiler_notice, undefined);
  assert.equal(answered.answer_status, "answered");
  assert.ok(answered.spoiler_notice.length > 0);
});
