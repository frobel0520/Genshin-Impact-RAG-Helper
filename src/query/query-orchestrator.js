import { VERSION_CONSTRAINTS, isDomainId } from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";

export const QUERY_ORCHESTRATOR_RULESET_VERSION = 1;

const ORCHESTRATOR_OPTION_FIELDS = new Set([
  "classifier",
  "structuredRetriever",
  "documentRetriever",
]);
const RUN_REQUEST_FIELDS = new Set(["queryId", "request"]);

/**
 * Merge order. Structured evidence comes first because a StructuredFact or a
 * Claim is a record-level statement with a known source and version, while a
 * DocumentChunk only supports an answer contextually. Within each side the
 * retriever's own deterministic order is preserved, so the merge never
 * re-scores anything it does not own.
 */
export const EVIDENCE_MERGE_RULES = Object.freeze({
  version: QUERY_ORCHESTRATOR_RULESET_VERSION,
  order: "structured-before-document",
  preservesRetrieverOrder: true,
  deduplicatesByRecordId: true,
  ranksAreContiguousFromOne: true,
  reScoresEvidence: false,
});

/**
 * Wire the classifier and both retrievers into one query pass.
 *
 * The orchestrator owns routing and merging only. It applies no version,
 * authority, or conflict rules: that is T18's job, and the merged bundle is
 * built so T18 can re-sort it by authority without losing traceability.
 *
 * @param {{
 *   classifier: { classify: (request: object) => object },
 *   structuredRetriever: { retrieve: (request: object) => object },
 *   documentRetriever: { retrieve: (request: object) => Promise<object> },
 * }} options
 * @returns {{ rulesetVersion: number, run: (request: object) => Promise<object> }}
 */
export function createQueryOrchestrator(options) {
  const { classifier, structuredRetriever, documentRetriever } =
    validateOrchestratorOptions(options);

  async function run(runRequest) {
    const { queryId, request } = validateRunRequest(runRequest);

    const queryPlan = classifier.classify(request);
    const gameVersion =
      queryPlan.version_constraint === VERSION_CONSTRAINTS.EXACT
        ? request.game_version
        : undefined;
    const retrievalArguments = {
      queryId,
      queryPlan,
      ...(gameVersion === undefined ? {} : { gameVersion }),
    };

    const structured = structuredRetriever.retrieve(retrievalArguments);
    const document = await documentRetriever.retrieve({
      ...retrievalArguments,
      question: request.question,
    });

    return {
      query_id: queryId,
      ruleset_version: QUERY_ORCHESTRATOR_RULESET_VERSION,
      query_plan: queryPlan,
      retrieval_mode: queryPlan.retrieval_mode,
      bundle: mergeEvidenceBundles(queryId, [structured, document]),
      retrieved: Object.freeze({
        structured_count: structured.items.length,
        document_count: document.items.length,
      }),
    };
  }

  return Object.freeze({
    rulesetVersion: QUERY_ORCHESTRATOR_RULESET_VERSION,
    run,
  });
}

/**
 * Merge EvidenceBundles for one query into a single bundle.
 *
 * The same underlying record can be reached through more than one route in a
 * hybrid plan, so items are deduplicated by the record they cite — keeping the
 * first occurrence, which is the higher-precedence route. Ranks are rewritten
 * to stay contiguous, because a rank with holes in it is not a rank.
 *
 * @param {string} queryId
 * @param {object[]} bundles in precedence order
 * @returns {object} an EvidenceBundle
 */
export function mergeEvidenceBundles(queryId, bundles) {
  if (!isDomainId(queryId, "query")) {
    throw new TypeError("queryId must be a typed query domain ID (qry:<key>).");
  }
  if (!Array.isArray(bundles)) {
    throw new TypeError("bundles must be an array of EvidenceBundles.");
  }

  const items = [];
  const seenEvidenceIds = new Set();
  const seenRecordKeys = new Set();
  const conflictGroups = new Map();

  for (const bundle of bundles) {
    if (!isRecord(bundle) || !Array.isArray(bundle.items) || !Array.isArray(bundle.conflict_groups)) {
      throw new TypeError("Each merged bundle must be an EvidenceBundle.");
    }
    if (bundle.query_id !== queryId) {
      throw new TypeError(
        `Cannot merge evidence from another query: expected ${queryId}, got ${bundle.query_id}.`,
      );
    }

    for (const item of bundle.items) {
      const recordKey = recordKeyFor(item);
      if (seenRecordKeys.has(recordKey) || seenEvidenceIds.has(item.evidence_id)) {
        continue;
      }
      seenRecordKeys.add(recordKey);
      seenEvidenceIds.add(item.evidence_id);
      items.push({ ...item, rank: items.length + 1 });
    }

    for (const group of bundle.conflict_groups) {
      if (!conflictGroups.has(group.conflict_group_id)) {
        conflictGroups.set(group.conflict_group_id, group);
      }
    }
  }

  return {
    query_id: queryId,
    items,
    conflict_groups: [...conflictGroups.values()].sort((left, right) =>
      left.conflict_group_id.localeCompare(right.conflict_group_id),
    ),
  };
}

function recordKeyFor(item) {
  if (!isRecord(item)) {
    throw new TypeError("Evidence items must be plain objects.");
  }
  const recordId = item.fact_id ?? item.claim_id ?? item.chunk_id;
  if (recordId === undefined) {
    // T08 allows an item without a record reference; fall back to its own ID so
    // such an item is still carried through instead of collapsing with others.
    return `evidence:${item.evidence_id}`;
  }
  return recordId;
}

function validateOrchestratorOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Query orchestrator options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!ORCHESTRATOR_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown query orchestrator option: ${field}.`);
    }
  }
  if (!isRecord(options.classifier) || typeof options.classifier.classify !== "function") {
    throw new TypeError("classifier must expose classify().");
  }
  for (const field of ["structuredRetriever", "documentRetriever"]) {
    if (!isRecord(options[field]) || typeof options[field].retrieve !== "function") {
      throw new TypeError(`${field} must expose retrieve().`);
    }
  }
  return {
    classifier: options.classifier,
    structuredRetriever: options.structuredRetriever,
    documentRetriever: options.documentRetriever,
  };
}

function validateRunRequest(runRequest) {
  if (!isRecord(runRequest)) {
    throw new TypeError("Query orchestrator run request must be a plain object.");
  }
  for (const field of Object.keys(runRequest)) {
    if (!RUN_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown query orchestrator run request field: ${field}.`);
    }
  }
  if (!isDomainId(runRequest.queryId, "query")) {
    throw new TypeError("queryId must be a typed query domain ID (qry:<key>).");
  }
  if (!isRecord(runRequest.request)) {
    throw new TypeError("request must be a QueryRequest object.");
  }
  return { queryId: runRequest.queryId, request: runRequest.request };
}
