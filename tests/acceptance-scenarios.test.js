import assert from "node:assert/strict";
import test from "node:test";

import {
  FIXED_EMBEDDING_DIMENSIONS,
  buildFixedIndex,
  createDocumentStore,
} from "../src/data/document-store.js";
import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { assertEvidenceBundle } from "../src/policy/evidence-answer-contract.js";
import { createDocumentRetriever } from "../src/query/document-retrieval.js";
import { createQueryClassifier } from "../src/query/query-classifier.js";
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

  return async function run(scenarioName) {
    const { question } = scenarios[scenarioName];
    const queryId = `qry:${scenarioName.replaceAll("_", "-")}`;
    const queryPlan = classifier.classify({ question });
    const structured = structuredRetriever.retrieve({ queryId, queryPlan });
    const document = await documentRetriever.retrieve({ queryId, queryPlan, question });

    assert.equal(assertEvidenceBundle(structured), structured);
    assert.equal(assertEvidenceBundle(document), document);
    return { queryPlan, structured, document };
  };
}

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
