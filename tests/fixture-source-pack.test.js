import test from "node:test";
import assert from "node:assert/strict";

import {
  FIXTURE_SOURCE_PACK_SCHEMA_VERSION,
  FIXTURE_SOURCE_PACK_VALIDATION_CODES,
  assertFixtureSourcePack,
  createSourcePackIndexes,
  isFixtureSourcePack,
  loadFixtureSourcePack,
  validateFixtureSourcePack,
} from "../src/data/fixture-source-pack.js";
import { validateSourceDocument } from "../src/data/source-document-contract.js";
import { validateCanonicalEntity } from "../src/data/canonical-entity-contract.js";
import {
  buildConflictGroups,
  validateClaim,
  validateConflictGroup,
  validateStructuredFact,
} from "../src/data/fact-claim-contract.js";
import { validateDocumentChunk } from "../src/data/document-chunk-contract.js";
import {
  AUTHORITY_RANKS,
  SOURCE_KINDS,
} from "../src/domain/domain-contract.js";

test("fixture source pack file loads and validates against all contract schemas", () => {
  const pack = loadFixtureSourcePack();

  assert.equal(pack.schema_version, FIXTURE_SOURCE_PACK_SCHEMA_VERSION);
  assert.equal(isFixtureSourcePack(pack), true);

  const packResult = validateFixtureSourcePack(pack);
  assert.equal(packResult.ok, true);

  for (const doc of pack.source_documents) {
    const docResult = validateSourceDocument(doc);
    assert.equal(docResult.ok, true, `SourceDocument ${doc.source_id} failed validation`);
  }

  for (const entity of pack.canonical_entities) {
    const entityResult = validateCanonicalEntity(entity);
    assert.equal(entityResult.ok, true, `CanonicalEntity ${entity.entity_id} failed validation`);
  }

  for (const fact of pack.structured_facts) {
    const factResult = validateStructuredFact(fact);
    assert.equal(factResult.ok, true, `StructuredFact ${fact.fact_id} failed validation`);
  }

  for (const claim of pack.claims) {
    const claimResult = validateClaim(claim);
    assert.equal(claimResult.ok, true, `Claim ${claim.claim_id} failed validation`);
  }

  for (const group of pack.conflict_groups) {
    const groupResult = validateConflictGroup(group);
    assert.equal(groupResult.ok, true, `ConflictGroup ${group.conflict_group_id} failed validation`);
  }

  for (const chunk of pack.document_chunks) {
    const chunkResult = validateDocumentChunk(chunk);
    assert.equal(chunkResult.ok, true, `DocumentChunk ${chunk.chunk_id} failed validation`);
  }
});

test("fixture source pack covers all three sources and required authority ranks", () => {
  const pack = loadFixtureSourcePack();
  const sourceKinds = new Set(pack.source_documents.map((doc) => doc.source_kind));

  assert.equal(sourceKinds.has(SOURCE_KINDS.HOYOLAB), true);
  assert.equal(sourceKinds.has(SOURCE_KINDS.GENSHIN_DB), true);
  assert.equal(sourceKinds.has(SOURCE_KINDS.FANDOM), true);

  const sourceMap = new Map(pack.source_documents.map((doc) => [doc.source_id, doc]));

  for (const claim of pack.claims) {
    const source = sourceMap.get(claim.source_id);
    assert.ok(source, `Source document for claim ${claim.claim_id} must exist.`);
    assert.equal(
      claim.authority_rank,
      AUTHORITY_RANKS[source.source_kind],
      `Claim ${claim.claim_id} authority rank must match its source kind ${source.source_kind}`,
    );
  }
});

test("fixture source pack maintains referential integrity across all records", () => {
  const pack = loadFixtureSourcePack();
  const sourceIds = new Set(pack.source_documents.map((doc) => doc.source_id));
  const entityIds = new Set(pack.canonical_entities.map((entity) => entity.entity_id));
  const claimIds = new Set(pack.claims.map((claim) => claim.claim_id));

  for (const fact of pack.structured_facts) {
    assert.equal(sourceIds.has(fact.source_id), true, `Fact ${fact.fact_id} references missing source`);
    assert.equal(entityIds.has(fact.entity_id), true, `Fact ${fact.fact_id} references missing entity`);
  }

  for (const claim of pack.claims) {
    assert.equal(sourceIds.has(claim.source_id), true, `Claim ${claim.claim_id} references missing source`);
    assert.equal(entityIds.has(claim.entity_id), true, `Claim ${claim.claim_id} references missing entity`);
  }

  for (const group of pack.conflict_groups) {
    for (const claimId of group.claim_ids) {
      assert.equal(claimIds.has(claimId), true, `ConflictGroup ${group.conflict_group_id} references missing claim`);
    }
  }

  for (const chunk of pack.document_chunks) {
    assert.equal(sourceIds.has(chunk.source_id), true, `Chunk ${chunk.chunk_id} references missing source`);
    for (const entityId of chunk.entity_ids) {
      assert.equal(entityIds.has(entityId), true, `Chunk ${chunk.chunk_id} references missing entity`);
    }
  }
});

test("fixture source pack includes conflict groups consistent with buildConflictGroups", () => {
  const pack = loadFixtureSourcePack();
  const derivedConflictGroups = buildConflictGroups(pack.claims);

  assert.equal(derivedConflictGroups.length, pack.conflict_groups.length);
  assert.equal(
    derivedConflictGroups[0].conflict_group_id,
    pack.conflict_groups[0].conflict_group_id,
  );
  assert.deepEqual(
    derivedConflictGroups[0].claim_ids.sort(),
    pack.conflict_groups[0].claim_ids.sort(),
  );
});

test("createSourcePackIndexes builds fast in-memory lookup maps", () => {
  const pack = loadFixtureSourcePack();
  const indexes = createSourcePackIndexes(pack);

  assert.equal(indexes.sourceDocumentsById.size, pack.source_documents.length);
  assert.equal(indexes.canonicalEntitiesById.size, pack.canonical_entities.length);
  assert.equal(indexes.structuredFactsById.size, pack.structured_facts.length);
  assert.equal(indexes.claimsById.size, pack.claims.length);
  assert.equal(indexes.conflictGroupsById.size, pack.conflict_groups.length);
  assert.equal(indexes.documentChunksById.size, pack.document_chunks.length);

  assert.ok(indexes.canonicalEntitiesById.get("ent:raiden-shogun"));
  assert.ok(indexes.structuredFactsById.get("fact:raiden-shogun-element"));
  assert.ok(indexes.documentChunksById.get("chunk:hoyolab-5-0-character-updates"));
});

test("validateFixtureSourcePack rejects duplicate IDs, unreferenced foreign keys, and malformed structures", () => {
  const validPack = loadFixtureSourcePack();

  // Test non-record
  const notRecordResult = validateFixtureSourcePack("invalid");
  assert.equal(notRecordResult.ok, false);
  assert.equal(notRecordResult.errors[0].code, FIXTURE_SOURCE_PACK_VALIDATION_CODES.INVALID_PACK);

  // Test duplicate source_id
  const duplicateSourcePack = {
    ...validPack,
    source_documents: [validPack.source_documents[0], validPack.source_documents[0]],
  };
  const dupResult = validateFixtureSourcePack(duplicateSourcePack);
  assert.equal(dupResult.ok, false);
  assert.ok(dupResult.errors.some((e) => e.code === FIXTURE_SOURCE_PACK_VALIDATION_CODES.DUPLICATE_ID));

  // Test unresolved entity reference in structured fact
  const unresolvedEntityPack = {
    ...validPack,
    structured_facts: [
      {
        ...validPack.structured_facts[0],
        entity_id: "ent:non-existent-entity",
      },
    ],
  };
  const unresResult = validateFixtureSourcePack(unresolvedEntityPack);
  assert.equal(unresResult.ok, false);
  assert.ok(unresResult.errors.some((e) => e.code === FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE));

  // Test unresolved source reference in chunk
  const unresolvedChunkSourcePack = {
    ...validPack,
    document_chunks: [
      {
        ...validPack.document_chunks[0],
        source_id: "src:non-existent-source",
      },
    ],
  };
  const unresChunkResult = validateFixtureSourcePack(unresolvedChunkSourcePack);
  assert.equal(unresChunkResult.ok, false);
  assert.ok(unresChunkResult.errors.some((e) => e.code === FIXTURE_SOURCE_PACK_VALIDATION_CODES.UNRESOLVED_REFERENCE));

  // Test assertion throws
  assert.throws(
    () => assertFixtureSourcePack(unresolvedEntityPack),
    /Invalid Fixture source pack/,
  );
});
