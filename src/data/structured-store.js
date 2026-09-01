import { DatabaseSync } from "node:sqlite";

import { assertCanonicalEntity } from "./canonical-entity-contract.js";
import {
  assertClaim,
  assertConflictGroup,
  assertStructuredFact,
  buildConflictGroups,
  isConflictGroupId,
  sortClaims,
} from "./fact-claim-contract.js";
import { assertSourceDocument } from "./source-document-contract.js";
import { AUTHORITY_RANKS, isDomainId } from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";

export const STRUCTURED_STORE_SCHEMA_VERSION = 2;
export const DEFAULT_STRUCTURED_STORE_DATABASE_PATH = ":memory:";

const STORE_OPTION_FIELDS = new Set(["databasePath"]);
const STORE_DATA_REQUIRED_FIELDS = Object.freeze([
  "source_documents",
  "canonical_entities",
  "structured_facts",
  "claims",
  "conflict_groups",
]);
const STORE_DATA_OPTIONAL_FIELDS = Object.freeze([
  "schema_version",
  "document_chunks",
  "test_scenarios",
]);
const STORE_DATA_FIELDS = new Set([
  ...STORE_DATA_REQUIRED_FIELDS,
  ...STORE_DATA_OPTIONAL_FIELDS,
]);
const FACT_FILTER_FIELDS = new Set(["entityId", "fieldKey", "gameVersion"]);
const CLAIM_FILTER_FIELDS = new Set(["entityId", "claimKey", "gameVersion"]);

const CREATE_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS structured_store_metadata (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
    schema_version INTEGER NOT NULL,
    dataset_version TEXT
  ) STRICT;

  INSERT INTO structured_store_metadata (singleton, schema_version)
  VALUES (1, ${STRUCTURED_STORE_SCHEMA_VERSION})
  ON CONFLICT (singleton) DO NOTHING;

  CREATE TABLE IF NOT EXISTS source_documents (
    source_id TEXT PRIMARY KEY,
    source_kind TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT NOT NULL,
    published_at TEXT,
    retrieved_at TEXT NOT NULL,
    game_version TEXT,
    locale TEXT NOT NULL,
    rights_note TEXT NOT NULL,
    content_hash TEXT NOT NULL UNIQUE
  ) STRICT;

  CREATE TABLE IF NOT EXISTS canonical_entities (
    entity_id TEXT PRIMARY KEY,
    entity_type TEXT NOT NULL,
    canonical_name TEXT NOT NULL,
    aliases_json TEXT NOT NULL CHECK (json_valid(aliases_json)),
    locale TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conflict_groups (
    conflict_group_id TEXT PRIMARY KEY
  ) STRICT;

  CREATE TABLE IF NOT EXISTS structured_facts (
    fact_id TEXT PRIMARY KEY,
    entity_id TEXT NOT NULL REFERENCES canonical_entities(entity_id),
    field_key TEXT NOT NULL,
    value_json TEXT NOT NULL CHECK (json_valid(value_json)),
    unit TEXT,
    game_version TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES source_documents(source_id),
    validity TEXT NOT NULL
  ) STRICT;

  CREATE TABLE IF NOT EXISTS claims (
    claim_id TEXT PRIMARY KEY,
    claim_key TEXT NOT NULL,
    entity_id TEXT NOT NULL REFERENCES canonical_entities(entity_id),
    claim_text TEXT NOT NULL,
    game_version TEXT NOT NULL,
    source_id TEXT NOT NULL REFERENCES source_documents(source_id),
    authority_rank INTEGER NOT NULL,
    conflict_group_id TEXT REFERENCES conflict_groups(conflict_group_id)
  ) STRICT;

  CREATE TABLE IF NOT EXISTS conflict_group_claims (
    conflict_group_id TEXT NOT NULL REFERENCES conflict_groups(conflict_group_id),
    claim_id TEXT NOT NULL REFERENCES claims(claim_id),
    PRIMARY KEY (conflict_group_id, claim_id)
  ) STRICT;

  CREATE INDEX IF NOT EXISTS idx_structured_facts_lookup
    ON structured_facts (entity_id, field_key, game_version);
  CREATE INDEX IF NOT EXISTS idx_claims_lookup
    ON claims (entity_id, claim_key, game_version);
  CREATE INDEX IF NOT EXISTS idx_claims_conflict_group
    ON claims (conflict_group_id);
`;

const CLEAR_DATA_SQL = `
  DELETE FROM conflict_group_claims;
  DELETE FROM structured_facts;
  DELETE FROM claims;
  DELETE FROM conflict_groups;
  DELETE FROM canonical_entities;
  DELETE FROM source_documents;
`;

/**
 * Create the synchronous SQLite-backed access layer for StructuredFact and Claim.
 * Version filters are exact string matches; range/current policy belongs to the
 * retrieval and policy tasks that consume this store.
 *
 * @param {{ databasePath?: string }} [options]
 * @returns {{
 *   replaceData: (data: Record<string, unknown>) => object,
 *   findStructuredFacts: (filters: object) => object[],
 *   findClaims: (filters: object) => object[],
 *   getSourceDocument: (sourceId: string) => object | undefined,
 *   getConflictGroup: (conflictGroupId: string) => object | undefined,
 *   getStatus: () => object,
 *   close: () => void,
 * }}
 */
export function createStructuredStore(options = {}) {
  const databasePath = validateStoreOptions(options);
  const database = new DatabaseSync(databasePath);
  let isOpen = true;
  let lastKnownCounts;
  let lastKnownDatasetVersion = null;

  try {
    database.exec("PRAGMA foreign_keys = ON;");
    assertExistingSchemaCompatible(database);
    database.exec(CREATE_SCHEMA_SQL);
    assertCompatibleSchema(database);
    lastKnownCounts = readCounts(database);
    lastKnownDatasetVersion = readDatasetVersion(database);
  } catch (error) {
    database.close();
    throw error;
  }

  const insertStatements = prepareInsertStatements(database);

  /**
   * @param {object} data
   * @param {{ datasetVersion?: string }} [options] the version of the batch this
   *   data came from, recorded so a reader can tell whether the document index
   *   beside it was built from the same one
   */
  function replaceData(data, options = {}) {
    assertStoreIsOpen(isOpen);
    const validatedData = validateStoreData(data);
    const serializedData = serializeStoreData(validatedData);
    const datasetVersion = validateDatasetVersion(options);
    let transactionStarted = false;

    try {
      database.exec("BEGIN IMMEDIATE;");
      transactionStarted = true;
      database.exec(CLEAR_DATA_SQL);
      insertSerializedData(insertStatements, serializedData);
      database
        .prepare("UPDATE structured_store_metadata SET dataset_version = ? WHERE singleton = 1")
        .run(datasetVersion ?? null);
      database.exec("COMMIT;");
      transactionStarted = false;
    } catch (error) {
      if (transactionStarted) {
        rollbackAfterFailure(database, error);
      }
      throw error;
    }

    lastKnownCounts = readCounts(database);
    lastKnownDatasetVersion = datasetVersion ?? null;
    return createStatusSnapshot(isOpen, lastKnownCounts, lastKnownDatasetVersion);
  }

  function findStructuredFacts(filters) {
    assertStoreIsOpen(isOpen);
    const validatedFilters = validateQueryFilters(
      filters,
      FACT_FILTER_FIELDS,
      "fieldKey",
      "StructuredFact",
    );
    const { sql, parameters } = buildFactQuery(validatedFilters);
    return database.prepare(sql).all(...parameters).map(toStructuredFact);
  }

  function findClaims(filters) {
    assertStoreIsOpen(isOpen);
    const validatedFilters = validateQueryFilters(
      filters,
      CLAIM_FILTER_FIELDS,
      "claimKey",
      "Claim",
    );
    const { sql, parameters } = buildClaimQuery(validatedFilters);
    const rows = database.prepare(sql).all(...parameters);
    const sourceDocuments = new Map(
      rows.map((row) => [row.source_id, toClaimSourceDocument(row)]),
    );
    return sortClaims(rows.map(toClaim), sourceDocuments);
  }

  /**
   * Read one StructuredFact by its ID.
   *
   * The retrievers find facts by entity and field; a caller holding an
   * EvidenceItem has only the ID it cited, and needs the value back to say
   * anything about it. Returns undefined when the dataset does not hold it,
   * because a missing record is an answer, not a failure.
   *
   * @param {string} factId
   * @returns {object | undefined}
   */
  function getStructuredFact(factId) {
    assertStoreIsOpen(isOpen);
    assertDomainId(factId, "fact", "factId");
    const row = database
      .prepare(
        `SELECT fact_id, entity_id, field_key, value_json, unit, game_version, source_id, validity
         FROM structured_facts WHERE fact_id = ?`,
      )
      .get(factId);
    return row === undefined ? undefined : toStructuredFact(row);
  }

  /**
   * Read one CanonicalEntity by its ID.
   *
   * @param {string} entityId
   * @returns {object | undefined}
   */
  function getCanonicalEntity(entityId) {
    assertStoreIsOpen(isOpen);
    assertDomainId(entityId, "entity", "entityId");
    const row = database
      .prepare(
        "SELECT entity_id, entity_type, canonical_name, aliases_json, locale FROM canonical_entities WHERE entity_id = ?",
      )
      .get(entityId);
    return row === undefined ? undefined : toCanonicalEntity(row);
  }

  /**
   * Read one Claim by its ID, with the source dates its ordering depends on.
   *
   * @param {string} claimId
   * @returns {object | undefined}
   */
  function getClaim(claimId) {
    assertStoreIsOpen(isOpen);
    assertDomainId(claimId, "claim", "claimId");
    const row = database
      .prepare(
        `SELECT
           c.claim_id, c.claim_key, c.entity_id, c.claim_text, c.game_version,
           c.source_id, c.authority_rank, c.conflict_group_id,
           s.published_at AS source_published_at,
           s.retrieved_at AS source_retrieved_at
         FROM claims AS c
         INNER JOIN source_documents AS s ON s.source_id = c.source_id
         WHERE c.claim_id = ?`,
      )
      .get(claimId);
    return row === undefined ? undefined : toClaim(row);
  }

  /**
   * Read back every CanonicalEntity, ordered by ID so the result is stable.
   *
   * The query classifier needs the entity dictionary at runtime, and after an
   * ingest run this store is the only place it exists.
   */
  function listCanonicalEntities() {
    assertStoreIsOpen(isOpen);
    return database
      .prepare("SELECT * FROM canonical_entities ORDER BY entity_id")
      .all()
      .map(toCanonicalEntity);
  }

  function getSourceDocument(sourceId) {
    assertStoreIsOpen(isOpen);
    assertDomainId(sourceId, "source", "sourceId");
    const row = database
      .prepare("SELECT * FROM source_documents WHERE source_id = ?")
      .get(sourceId);
    return row === undefined ? undefined : toSourceDocument(row);
  }

  function getConflictGroup(conflictGroupId) {
    assertStoreIsOpen(isOpen);
    if (!isConflictGroupId(conflictGroupId)) {
      throw new TypeError("conflictGroupId must be a conflict:<stable-key> ID.");
    }

    const group = database
      .prepare("SELECT conflict_group_id FROM conflict_groups WHERE conflict_group_id = ?")
      .get(conflictGroupId);
    if (group === undefined) {
      return undefined;
    }

    const claimIds = database
      .prepare(`
        SELECT claim_id
        FROM conflict_group_claims
        WHERE conflict_group_id = ?
        ORDER BY claim_id ASC
      `)
      .all(conflictGroupId)
      .map((row) => row.claim_id);

    return {
      conflict_group_id: group.conflict_group_id,
      claim_ids: claimIds,
    };
  }

  function getStatus() {
    if (isOpen) {
      lastKnownCounts = readCounts(database);
      lastKnownDatasetVersion = readDatasetVersion(database);
    }
    return createStatusSnapshot(isOpen, lastKnownCounts, lastKnownDatasetVersion);
  }

  function close() {
    if (!isOpen) {
      return;
    }

    lastKnownCounts = readCounts(database);
    database.close();
    isOpen = false;
  }

  return Object.freeze({
    replaceData,
    findStructuredFacts,
    findClaims,
    getStructuredFact,
    getClaim,
    getCanonicalEntity,
    listCanonicalEntities,
    getSourceDocument,
    getConflictGroup,
    getStatus,
    close,
  });
}

function validateStoreOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Structured store options must be a plain object.");
  }

  for (const field of Object.keys(options)) {
    if (!STORE_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown structured store option: ${field}.`);
    }
  }

  const databasePath = options.databasePath ?? DEFAULT_STRUCTURED_STORE_DATABASE_PATH;
  if (!isStableString(databasePath)) {
    throw new TypeError("databasePath must be a non-empty string without surrounding whitespace.");
  }
  return databasePath;
}

function assertExistingSchemaCompatible(database) {
  const metadataTable = database
    .prepare(`
      SELECT name
      FROM sqlite_master
      WHERE type = 'table' AND name = 'structured_store_metadata'
    `)
    .get();
  if (metadataTable === undefined) {
    return;
  }
  assertCompatibleSchema(database);
}

function assertCompatibleSchema(database) {
  const row = database
    .prepare("SELECT schema_version FROM structured_store_metadata WHERE singleton = 1")
    .get();
  if (row?.schema_version !== STRUCTURED_STORE_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported structured store schema version: ${String(row?.schema_version)}.`,
    );
  }
}

function prepareInsertStatements(database) {
  return Object.freeze({
    sourceDocument: database.prepare(`
      INSERT INTO source_documents (
        source_id, source_kind, source_url, title, published_at, retrieved_at,
        game_version, locale, rights_note, content_hash
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `),
    canonicalEntity: database.prepare(`
      INSERT INTO canonical_entities (
        entity_id, entity_type, canonical_name, aliases_json, locale
      ) VALUES (?, ?, ?, ?, ?)
    `),
    conflictGroup: database.prepare(`
      INSERT INTO conflict_groups (conflict_group_id) VALUES (?)
    `),
    structuredFact: database.prepare(`
      INSERT INTO structured_facts (
        fact_id, entity_id, field_key, value_json, unit, game_version, source_id, validity
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    claim: database.prepare(`
      INSERT INTO claims (
        claim_id, claim_key, entity_id, claim_text, game_version, source_id,
        authority_rank, conflict_group_id
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `),
    conflictGroupClaim: database.prepare(`
      INSERT INTO conflict_group_claims (conflict_group_id, claim_id) VALUES (?, ?)
    `),
  });
}

function validateStoreData(data) {
  if (!isRecord(data)) {
    throw new TypeError("Structured store data must be a plain object.");
  }

  for (const field of Object.keys(data)) {
    if (!STORE_DATA_FIELDS.has(field)) {
      throw new TypeError(`Unknown structured store data field: ${field}.`);
    }
  }

  for (const field of STORE_DATA_REQUIRED_FIELDS) {
    if (!Array.isArray(data[field])) {
      throw new TypeError(`${field} must be an array.`);
    }
  }

  const sourceDocuments = validateRecords(
    data.source_documents,
    assertSourceDocument,
    "source_documents",
  );
  const canonicalEntities = validateRecords(
    data.canonical_entities,
    assertCanonicalEntity,
    "canonical_entities",
  );
  const structuredFacts = validateRecords(
    data.structured_facts,
    assertStructuredFact,
    "structured_facts",
  );
  const claims = validateRecords(data.claims, assertClaim, "claims");
  const conflictGroups = validateRecords(
    data.conflict_groups,
    assertConflictGroup,
    "conflict_groups",
  );

  validateCrossRecordInvariants({
    sourceDocuments,
    canonicalEntities,
    structuredFacts,
    claims,
    conflictGroups,
  });

  return {
    sourceDocuments,
    canonicalEntities,
    structuredFacts,
    claims,
    conflictGroups,
  };
}

function validateRecords(records, assertRecord, fieldName) {
  return records.map((record, index) => {
    try {
      return assertRecord(record);
    } catch (error) {
      throw new TypeError(`${fieldName}[${index}] is invalid: ${error.message}`, {
        cause: error,
      });
    }
  });
}

function validateCrossRecordInvariants(data) {
  const sourcesById = new Map(
    data.sourceDocuments.map((document) => [document.source_id, document]),
  );
  const entityIds = new Set(data.canonicalEntities.map((entity) => entity.entity_id));
  const claimsById = new Map(data.claims.map((claim) => [claim.claim_id, claim]));
  const groupsById = new Map(
    data.conflictGroups.map((group) => [group.conflict_group_id, group]),
  );

  for (const fact of data.structuredFacts) {
    assertReferencedRecord(sourcesById, fact.source_id, `Fact ${fact.fact_id} source_id`);
    assertReferencedRecord(entityIds, fact.entity_id, `Fact ${fact.fact_id} entity_id`);
  }

  for (const claim of data.claims) {
    const source = assertReferencedRecord(
      sourcesById,
      claim.source_id,
      `Claim ${claim.claim_id} source_id`,
    );
    assertReferencedRecord(entityIds, claim.entity_id, `Claim ${claim.claim_id} entity_id`);

    if (AUTHORITY_RANKS[source.source_kind] !== claim.authority_rank) {
      throw new TypeError(
        `Claim ${claim.claim_id} authority_rank does not match source ${claim.source_id}.`,
      );
    }

    if (claim.conflict_group_id !== null) {
      const group = assertReferencedRecord(
        groupsById,
        claim.conflict_group_id,
        `Claim ${claim.claim_id} conflict_group_id`,
      );
      if (!group.claim_ids.includes(claim.claim_id)) {
        throw new TypeError(
          `Conflict group ${group.conflict_group_id} must include claim ${claim.claim_id}.`,
        );
      }
    }
  }

  for (const group of data.conflictGroups) {
    for (const claimId of group.claim_ids) {
      const claim = assertReferencedRecord(
        claimsById,
        claimId,
        `Conflict group ${group.conflict_group_id} claim_id`,
      );
      if (claim.conflict_group_id !== group.conflict_group_id) {
        throw new TypeError(
          `Claim ${claimId} must reference conflict group ${group.conflict_group_id}.`,
        );
      }
    }
  }

  assertConflictGroupsMatchClaims(data.claims, data.conflictGroups);
}

function assertConflictGroupsMatchClaims(claims, conflictGroups) {
  const derivedGroups = buildConflictGroups(claims);
  const suppliedGroupsById = new Map(
    conflictGroups.map((group) => [group.conflict_group_id, group]),
  );

  if (
    derivedGroups.length !== conflictGroups.length ||
    suppliedGroupsById.size !== conflictGroups.length
  ) {
    throw new TypeError(
      "conflict_groups must exactly represent differing same-scope claims.",
    );
  }

  for (const derivedGroup of derivedGroups) {
    const suppliedGroup = suppliedGroupsById.get(derivedGroup.conflict_group_id);
    if (
      suppliedGroup === undefined ||
      !haveSameIds(derivedGroup.claim_ids, suppliedGroup.claim_ids)
    ) {
      throw new TypeError(
        `Conflict group ${derivedGroup.conflict_group_id} does not match its claims.`,
      );
    }
  }
}

function haveSameIds(left, right) {
  if (left.length !== right.length) {
    return false;
  }
  const rightIds = new Set(right);
  return left.every((id) => rightIds.has(id));
}

function assertReferencedRecord(collection, id, label) {
  const record = collection instanceof Map ? collection.get(id) : collection.has(id) ? id : undefined;
  if (record === undefined) {
    throw new TypeError(`${label} references missing ID ${id}.`);
  }
  return record;
}

function serializeStoreData(data) {
  return {
    sourceDocuments: data.sourceDocuments,
    canonicalEntities: data.canonicalEntities.map((entity) => ({
      ...entity,
      aliases_json: JSON.stringify(entity.aliases),
    })),
    structuredFacts: data.structuredFacts.map((fact) => ({
      ...fact,
      value_json: JSON.stringify(fact.value),
    })),
    claims: data.claims,
    conflictGroups: data.conflictGroups,
  };
}

function insertSerializedData(statements, data) {
  for (const document of data.sourceDocuments) {
    statements.sourceDocument.run(
      document.source_id,
      document.source_kind,
      document.source_url,
      document.title,
      document.published_at ?? null,
      document.retrieved_at,
      document.game_version ?? null,
      document.locale,
      document.rights_note,
      document.content_hash,
    );
  }

  for (const entity of data.canonicalEntities) {
    statements.canonicalEntity.run(
      entity.entity_id,
      entity.entity_type,
      entity.canonical_name,
      entity.aliases_json,
      entity.locale,
    );
  }

  for (const group of data.conflictGroups) {
    statements.conflictGroup.run(group.conflict_group_id);
  }

  for (const fact of data.structuredFacts) {
    statements.structuredFact.run(
      fact.fact_id,
      fact.entity_id,
      fact.field_key,
      fact.value_json,
      fact.unit,
      fact.game_version,
      fact.source_id,
      fact.validity,
    );
  }

  for (const claim of data.claims) {
    statements.claim.run(
      claim.claim_id,
      claim.claim_key,
      claim.entity_id,
      claim.claim_text,
      claim.game_version,
      claim.source_id,
      claim.authority_rank,
      claim.conflict_group_id,
    );
  }

  for (const group of data.conflictGroups) {
    for (const claimId of group.claim_ids) {
      statements.conflictGroupClaim.run(group.conflict_group_id, claimId);
    }
  }
}

function rollbackAfterFailure(database, originalError) {
  try {
    database.exec("ROLLBACK;");
  } catch (rollbackError) {
    throw new AggregateError(
      [originalError, rollbackError],
      "Structured store replacement and rollback both failed.",
    );
  }
}

function validateQueryFilters(filters, allowedFields, keyField, recordName) {
  if (!isRecord(filters)) {
    throw new TypeError(`${recordName} query filters must be a plain object.`);
  }

  for (const field of Object.keys(filters)) {
    if (!allowedFields.has(field)) {
      throw new TypeError(`Unknown ${recordName} query filter: ${field}.`);
    }
  }

  assertDomainId(filters.entityId, "entity", "entityId");

  if (filters[keyField] !== undefined && !isStableKey(filters[keyField])) {
    throw new TypeError(`${keyField} must be a non-empty stable key without whitespace.`);
  }
  if (filters.gameVersion !== undefined && !isStableString(filters.gameVersion)) {
    throw new TypeError(
      "gameVersion must be a non-empty string without surrounding whitespace.",
    );
  }

  return filters;
}

function buildFactQuery(filters) {
  const clauses = ["entity_id = ?"];
  const parameters = [filters.entityId];

  if (filters.fieldKey !== undefined) {
    clauses.push("field_key = ?");
    parameters.push(filters.fieldKey);
  }
  if (filters.gameVersion !== undefined) {
    clauses.push("game_version = ?");
    parameters.push(filters.gameVersion);
  }

  return {
    sql: `
      SELECT fact_id, entity_id, field_key, value_json, unit, game_version, source_id, validity
      FROM structured_facts
      WHERE ${clauses.join(" AND ")}
      ORDER BY field_key ASC, game_version ASC, fact_id ASC
    `,
    parameters,
  };
}

function buildClaimQuery(filters) {
  const clauses = ["c.entity_id = ?"];
  const parameters = [filters.entityId];

  if (filters.claimKey !== undefined) {
    clauses.push("c.claim_key = ?");
    parameters.push(filters.claimKey);
  }
  if (filters.gameVersion !== undefined) {
    clauses.push("c.game_version = ?");
    parameters.push(filters.gameVersion);
  }

  return {
    sql: `
      SELECT
        c.claim_id, c.claim_key, c.entity_id, c.claim_text, c.game_version,
        c.source_id, c.authority_rank, c.conflict_group_id,
        s.published_at AS source_published_at,
        s.retrieved_at AS source_retrieved_at
      FROM claims AS c
      INNER JOIN source_documents AS s ON s.source_id = c.source_id
      WHERE ${clauses.join(" AND ")}
      ORDER BY c.claim_id ASC
    `,
    parameters,
  };
}

function toStructuredFact(row) {
  return {
    fact_id: row.fact_id,
    entity_id: row.entity_id,
    field_key: row.field_key,
    value: JSON.parse(row.value_json),
    unit: row.unit,
    game_version: row.game_version,
    source_id: row.source_id,
    validity: row.validity,
  };
}

function toClaim(row) {
  return {
    claim_id: row.claim_id,
    claim_key: row.claim_key,
    entity_id: row.entity_id,
    claim_text: row.claim_text,
    game_version: row.game_version,
    source_id: row.source_id,
    authority_rank: row.authority_rank,
    conflict_group_id: row.conflict_group_id,
  };
}

function toClaimSourceDocument(row) {
  const document = {
    source_id: row.source_id,
    retrieved_at: row.source_retrieved_at,
  };
  if (row.source_published_at !== null) {
    document.published_at = row.source_published_at;
  }
  return document;
}

function toCanonicalEntity(row) {
  return {
    entity_id: row.entity_id,
    entity_type: row.entity_type,
    canonical_name: row.canonical_name,
    aliases: JSON.parse(row.aliases_json),
    locale: row.locale,
  };
}

function toSourceDocument(row) {
  const document = {
    source_id: row.source_id,
    source_kind: row.source_kind,
    source_url: row.source_url,
    title: row.title,
    retrieved_at: row.retrieved_at,
    locale: row.locale,
    rights_note: row.rights_note,
    content_hash: row.content_hash,
  };

  if (row.published_at !== null) {
    document.published_at = row.published_at;
  }
  if (row.game_version !== null) {
    document.game_version = row.game_version;
  }
  return document;
}

function readCounts(database) {
  return Object.freeze({
    sourceDocuments: readTableCount(database, "source_documents"),
    canonicalEntities: readTableCount(database, "canonical_entities"),
    structuredFacts: readTableCount(database, "structured_facts"),
    claims: readTableCount(database, "claims"),
    conflictGroups: readTableCount(database, "conflict_groups"),
  });
}

function readTableCount(database, tableName) {
  return database.prepare(`SELECT COUNT(*) AS count FROM ${tableName}`).get().count;
}

function createStatusSnapshot(isOpen, counts, datasetVersion = null) {
  return Object.freeze({
    isOpen,
    schemaVersion: STRUCTURED_STORE_SCHEMA_VERSION,
    counts: Object.freeze({ ...counts }),
    datasetVersion,
  });
}

function readDatasetVersion(database) {
  const row = database
    .prepare("SELECT dataset_version FROM structured_store_metadata WHERE singleton = 1")
    .get();
  return row?.dataset_version ?? null;
}

function validateDatasetVersion(options) {
  if (!isRecord(options)) {
    throw new TypeError("replaceData options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (field !== "datasetVersion") {
      throw new TypeError(`Unknown replaceData option: ${field}.`);
    }
  }
  if (options.datasetVersion !== undefined && !isStableString(options.datasetVersion)) {
    throw new TypeError("datasetVersion must be a non-empty string when provided.");
  }
  return options.datasetVersion;
}

function assertStoreIsOpen(isOpen) {
  if (!isOpen) {
    throw new Error("Structured store is closed.");
  }
}

function assertDomainId(value, kind, label) {
  if (!isDomainId(value, kind)) {
    throw new TypeError(`${label} must be a typed ${kind} domain ID.`);
  }
}

function isStableKey(value) {
  return isStableString(value) && !/\s/u.test(value);
}
