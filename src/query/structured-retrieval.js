import {
  RETRIEVAL_MODES,
  SUPPORT_TYPES,
  VALIDITY_STATUSES,
  VERSION_CONSTRAINTS,
  createDomainId,
  isDomainId,
} from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";
import { assertQueryPlan } from "./query-contract.js";

const RETRIEVER_OPTION_FIELDS = new Set(["store"]);
const RETRIEVAL_REQUEST_FIELDS = new Set(["queryId", "queryPlan", "gameVersion"]);
const DIRECT_RETRIEVAL_MODES = new Set([
  RETRIEVAL_MODES.STRUCTURED,
  RETRIEVAL_MODES.HYBRID,
]);
const REQUIRED_STORE_METHODS = Object.freeze([
  "findStructuredFacts",
  "findClaims",
  "getSourceDocument",
  "getConflictGroup",
]);

/**
 * Create a synchronous StructuredFact/Claim retriever over the T13 store.
 * QueryPlan does not carry field keys, so this stage retrieves every structured
 * record for each resolved entity and leaves narrowing/policy to later stages.
 *
 * @param {{ store: object }} options
 * @returns {{ retrieve: (request: object) => object }}
 */
export function createStructuredRetriever(options) {
  const store = validateRetrieverOptions(options);

  function retrieve(request) {
    const validatedRequest = validateRetrievalRequest(request);
    const { queryId, queryPlan, gameVersion } = validatedRequest;

    if (!DIRECT_RETRIEVAL_MODES.has(queryPlan.retrieval_mode)) {
      return createEmptyBundle(queryId);
    }

    const exactGameVersion = resolveExactGameVersion(queryPlan, gameVersion);
    const entityIds = collectResolvedEntityIds(queryPlan);
    const sourceDocuments = new Map();
    const evidenceItems = [];
    const conflictGroups = new Map();

    for (const entityId of entityIds) {
      const filters = {
        entityId,
        ...(exactGameVersion === undefined ? {} : { gameVersion: exactGameVersion }),
      };
      const facts = store.findStructuredFacts(filters);
      const claims = store.findClaims(filters);

      for (const fact of facts) {
        evidenceItems.push(createFactEvidenceItem({
          queryId,
          fact,
          source: getRequiredSource(store, sourceDocuments, fact.source_id),
        }));
      }

      for (const claim of claims) {
        evidenceItems.push(createClaimEvidenceItem({
          queryId,
          claim,
          source: getRequiredSource(store, sourceDocuments, claim.source_id),
        }));
        if (claim.conflict_group_id !== null) {
          const group = store.getConflictGroup(claim.conflict_group_id);
          if (group === undefined) {
            throw new Error(
              `Claim ${claim.claim_id} references missing conflict group ${claim.conflict_group_id}.`,
            );
          }
          conflictGroups.set(group.conflict_group_id, group);
        }
      }
    }

    const rankedItems = evidenceItems.map((item, index) => ({
      ...item,
      rank: index + 1,
    }));
    return {
      query_id: queryId,
      items: rankedItems,
      conflict_groups: [...conflictGroups.values()].sort((left, right) =>
        left.conflict_group_id.localeCompare(right.conflict_group_id),
      ),
    };
  }

  return Object.freeze({ retrieve });
}

/**
 * Retrieve structured evidence without retaining a retriever instance.
 *
 * @param {{ store: object, queryId: string, queryPlan: object, gameVersion?: string }} options
 * @returns {object}
 */
export function retrieveStructuredEvidence(options) {
  if (!isRecord(options)) {
    throw new TypeError("Structured retrieval options must be a plain object.");
  }
  const { store, ...request } = options;
  return createStructuredRetriever({ store }).retrieve(request);
}

function validateRetrieverOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Structured retriever options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!RETRIEVER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown structured retriever option: ${field}.`);
    }
  }
  if (!isRecord(options.store)) {
    throw new TypeError("store must be a structured store.");
  }
  for (const method of REQUIRED_STORE_METHODS) {
    if (typeof options.store[method] !== "function") {
      throw new TypeError(`store must be a structured store with ${method}().`);
    }
  }
  return options.store;
}

function validateRetrievalRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Structured retrieval request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!RETRIEVAL_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown structured retrieval request field: ${field}.`);
    }
  }
  if (!isDomainId(request.queryId, "query")) {
    throw new TypeError("queryId must be a typed query domain ID (qry:<key>).");
  }
  const queryPlan = assertQueryPlan(request.queryPlan);
  if (request.gameVersion !== undefined && !isStableString(request.gameVersion)) {
    throw new TypeError(
      "gameVersion must be a non-empty string without surrounding whitespace.",
    );
  }
  return {
    queryId: request.queryId,
    queryPlan,
    gameVersion: request.gameVersion,
  };
}

function resolveExactGameVersion(queryPlan, gameVersion) {
  if (queryPlan.version_constraint !== VERSION_CONSTRAINTS.EXACT) {
    return undefined;
  }
  if (gameVersion === undefined) {
    throw new TypeError(
      "gameVersion is required for exact structured retrieval because QueryPlan stores only the constraint type.",
    );
  }
  if (gameVersion === "unknown") {
    throw new TypeError("gameVersion cannot be unknown for an exact version constraint.");
  }
  return gameVersion;
}

function collectResolvedEntityIds(queryPlan) {
  const entityIds = [];
  const seen = new Set();
  for (const entity of queryPlan.normalized_entities) {
    if (entity.resolution_status !== "resolved" || seen.has(entity.entity_id)) {
      continue;
    }
    seen.add(entity.entity_id);
    entityIds.push(entity.entity_id);
  }
  return entityIds;
}

function createFactEvidenceItem({ queryId, fact, source }) {
  return {
    evidence_id: createEvidenceId(queryId, "fact", fact.fact_id),
    ...sourceProjection(source),
    game_version: fact.game_version,
    fact_id: fact.fact_id,
    rank: 0,
    support_type:
      fact.validity === VALIDITY_STATUSES.CONFLICT
        ? SUPPORT_TYPES.CONFLICTING
        : SUPPORT_TYPES.DIRECT,
  };
}

function createClaimEvidenceItem({ queryId, claim, source }) {
  return {
    evidence_id: createEvidenceId(queryId, "claim", claim.claim_id),
    ...sourceProjection(source),
    game_version: claim.game_version,
    claim_id: claim.claim_id,
    rank: 0,
    support_type:
      claim.conflict_group_id === null
        ? SUPPORT_TYPES.DIRECT
        : SUPPORT_TYPES.CONFLICTING,
  };
}

function createEvidenceId(queryId, recordKind, recordId) {
  const queryKey = queryId.slice(queryId.indexOf(":") + 1);
  const recordKey = recordId.slice(recordId.indexOf(":") + 1);
  return createDomainId("evidence", `${queryKey}-${recordKind}-${recordKey}`);
}

function sourceProjection(source) {
  return {
    source_id: source.source_id,
    source_kind: source.source_kind,
    source_url: source.source_url,
    source_title: source.title,
    ...(source.published_at === undefined
      ? {}
      : { source_published_at: source.published_at }),
    source_retrieved_at: source.retrieved_at,
  };
}

function getRequiredSource(store, sourceDocuments, sourceId) {
  if (sourceDocuments.has(sourceId)) {
    return sourceDocuments.get(sourceId);
  }
  const source = store.getSourceDocument(sourceId);
  if (source === undefined) {
    throw new Error(`Structured record references missing source metadata ${sourceId}.`);
  }
  sourceDocuments.set(sourceId, source);
  return source;
}

function createEmptyBundle(queryId) {
  return {
    query_id: queryId,
    items: [],
    conflict_groups: [],
  };
}
