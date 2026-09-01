import { FIELD_KEY_LABELS_ZH_TW, labelForFieldValue } from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";

export const EVIDENCE_CONTENT_RULESET_VERSION = 1;

const RESOLVER_OPTION_FIELDS = new Set(["structuredStore", "documentStore"]);

/**
 * Resolve the text behind an EvidenceBundle.
 *
 * T08 deliberately keeps values out of an EvidenceItem: it carries record IDs
 * and source metadata so nothing downstream can quote a fact the policy stage
 * never approved. Anything that wants to say what the evidence *says* — a
 * generator, a report — has to come back to the stores for it, and this is the
 * one place that does, so the lookup rules stay in a single implementation.
 *
 * The resolver reads. It applies no policy: pass it the items the policy stage
 * already approved, never the raw bundle, or a claim that lost a conflict will
 * reappear as content.
 *
 * @param {{ structuredStore: object, documentStore: object }} options
 */
export function createEvidenceContentResolver(options) {
  const { structuredStore, documentStore } = validateOptions(options);

  /**
   * @param {object[]} evidenceItems
   * @returns {object[]} one entry per item whose record still exists
   */
  function resolve(evidenceItems) {
    if (!Array.isArray(evidenceItems)) {
      throw new TypeError("evidenceItems must be an array.");
    }

    const contents = [];
    for (const item of evidenceItems) {
      if (!isRecord(item)) {
        throw new TypeError("Every evidence item must be a plain object.");
      }
      const text = resolveText(item);
      // A record the dataset no longer holds is skipped rather than reported as
      // empty content: a rebuild between retrieval and this lookup must not put
      // a blank line in front of a reader as though the source said nothing.
      if (text === undefined) {
        continue;
      }
      contents.push({
        evidence_id: item.evidence_id,
        source_kind: item.source_kind,
        source_title: item.source_title,
        source_url: item.source_url,
        ...(item.game_version === undefined ? {} : { game_version: item.game_version }),
        support_type: item.support_type,
        text,
      });
    }
    return contents;
  }

  function resolveText(item) {
    if (typeof item.fact_id === "string") {
      const fact = structuredStore.getStructuredFact(item.fact_id);
      if (fact === undefined) {
        return undefined;
      }
      // The entity's name travels with its fact. "武器類型：法器" on its own
      // says whose weapon type it is only by luck of there being one entity in
      // the bundle, and a reader of the answer has no way to check which.
      const entity = structuredStore.getCanonicalEntity(fact.entity_id);
      return formatFact(fact, entity?.canonical_name);
    }
    if (typeof item.claim_id === "string") {
      const claim = structuredStore.getClaim(item.claim_id);
      return claim === undefined ? undefined : claim.claim_text;
    }
    if (typeof item.chunk_id === "string") {
      const chunk = documentStore.getDocumentChunk(item.chunk_id);
      return chunk === undefined ? undefined : chunk.text;
    }
    return undefined;
  }

  return Object.freeze({
    rulesetVersion: EVIDENCE_CONTENT_RULESET_VERSION,
    resolve,
  });
}

/**
 * Render a fact as one readable zh-TW line.
 *
 * The field key is kept alongside the value because "水" on its own does not say
 * what it is the answer to, and both are translated here: a reader asked to
 * make sense of `weapon_type: Claymore` gets 雙手劍, where a model left to
 * translate it itself answers 長劍 — a different weapon, stated with the
 * confidence of a cited fact. Anything without a defined label is passed
 * through unchanged rather than guessed at.
 *
 * @param {object} fact
 * @param {string} [entityName] the entity the fact belongs to
 * @returns {string}
 */
export function formatFact(fact, entityName) {
  const subject = typeof entityName === "string" && entityName !== "" ? `${entityName}的` : "";
  const key = FIELD_KEY_LABELS_ZH_TW[fact.field_key] ?? fact.field_key;
  const value =
    labelForFieldValue(fact.field_key, fact.value) ??
    (typeof fact.value === "string" ? fact.value : JSON.stringify(fact.value));
  const unit = fact.unit === "stars" ? " 星" : formatUnit(fact.unit);
  return `${subject}${key}：${value}${unit}`;
}

function formatUnit(unit) {
  return typeof unit === "string" && unit !== "" ? ` ${unit}` : "";
}

function validateOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Evidence content resolver options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!RESOLVER_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown evidence content resolver option: ${field}.`);
    }
  }
  if (
    typeof options.structuredStore?.getStructuredFact !== "function" ||
    typeof options.structuredStore?.getClaim !== "function" ||
    typeof options.structuredStore?.getCanonicalEntity !== "function"
  ) {
    throw new TypeError(
      "structuredStore must expose getStructuredFact, getClaim and getCanonicalEntity.",
    );
  }
  if (typeof options.documentStore?.getDocumentChunk !== "function") {
    throw new TypeError("documentStore must expose getDocumentChunk.");
  }
  return { structuredStore: options.structuredStore, documentStore: options.documentStore };
}
