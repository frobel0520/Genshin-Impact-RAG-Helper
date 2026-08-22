import {
  ENTITY_RESOLUTION_STATUSES,
  assertCanonicalEntity,
  assertEntityResolution,
} from "../data/canonical-entity-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";

export const NAME_NORMALIZATION_SCHEMA_VERSION = 1;
export const NAME_NORMALIZATION_RULESET_VERSION = 1;
export const DEFAULT_NAME_LOCALE = "zh-TW";

export const NAME_NORMALIZATION_RULES = Object.freeze({
  version: NAME_NORMALIZATION_RULESET_VERSION,
  unicodeForm: "NFKC",
  whitespace: "trim-and-collapse",
  comparison: "lowercase",
  aliasMatching: "explicit-only",
  fuzzyMatching: false,
});

/**
 * Normalize display text without changing the caller's source value.
 *
 * The rule set deliberately handles only deterministic Unicode and whitespace
 * normalization. Traditional/Simplified mappings and spelling variants must
 * be supplied as explicit CanonicalEntity aliases.
 *
 * @param {unknown} value
 * @returns {string}
 * @throws {TypeError} when value is not a non-whitespace string
 */
export function normalizeNameText(value) {
  if (typeof value !== "string") {
    throw new TypeError("Name text must be a string.");
  }

  const normalized = value.normalize("NFKC").replace(/\s+/gu, " ").trim();
  if (normalized.length === 0) {
    throw new TypeError("Name text must contain non-whitespace text.");
  }

  return normalized;
}

/**
 * Build the stable lookup key used by the explicit canonical-name/alias index.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function createComparableNameKey(value) {
  return normalizeNameText(value).toLowerCase();
}

/**
 * Build a read-only-by-convention lookup index from validated CanonicalEntity
 * records. Every canonical name and alias must resolve to exactly one entity.
 *
 * @param {unknown} canonicalEntities
 * @returns {Map<string, { entityId: string, entityType: string, canonicalName: string, matchedAlias: string | null }>}
 * @throws {TypeError} when an entity is invalid or a normalized name is ambiguous
 */
export function buildEntityNameIndex(canonicalEntities) {
  if (!Array.isArray(canonicalEntities)) {
    throw new TypeError("canonicalEntities must be an array.");
  }

  const index = new Map();

  canonicalEntities.forEach((entity, entityIndex) => {
    let validatedEntity;
    try {
      validatedEntity = assertCanonicalEntity(entity);
    } catch (error) {
      throw new TypeError(
        `canonicalEntities[${entityIndex}] is invalid. ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    registerName(index, validatedEntity, validatedEntity.canonical_name, null);
    for (const alias of validatedEntity.aliases) {
      registerName(index, validatedEntity, alias, alias);
    }
  });

  return index;
}

/**
 * Normalize and resolve one source/query name against explicit aliases.
 *
 * `source_text` is kept byte-for-byte as received. The nested `resolution`
 * follows the T04 EntityResolution contract and uses the stable normalized
 * text, so noisy whitespace never enters downstream contract validation.
 *
 * @param {unknown} sourceText
 * @param {{ locale?: string, canonicalEntities?: unknown[], entityIndex?: Map } | undefined} options
 * @returns {{ schema_version: number, ruleset_version: number, source_text: string, normalized_text: string, normalized_key: string, locale: string, resolution: object }}
 */
export function normalizeEntityName(sourceText, options = {}) {
  const normalizedOptions = validateOptions(options);
  const normalizedSourceText = normalizeNameText(sourceText);
  const sourceKey = createComparableNameKey(normalizedSourceText);
  const entityIndex =
    normalizedOptions.entityIndex ?? buildEntityNameIndex(normalizedOptions.canonicalEntities);
  const match = entityIndex.get(sourceKey);

  const normalizedText = match
    ? normalizeNameText(match.canonicalName)
    : normalizedSourceText;
  const normalizedKey = match
    ? createComparableNameKey(match.canonicalName)
    : sourceKey;
  const resolution = {
    text: normalizedSourceText,
    locale: normalizedOptions.locale,
    aliases_used:
      match?.matchedAlias === null || match === undefined ? [] : [normalizedSourceText],
    resolution_status: match
      ? ENTITY_RESOLUTION_STATUSES.RESOLVED
      : ENTITY_RESOLUTION_STATUSES.UNRECOGNIZED,
    entity_id: match?.entityId ?? null,
    entity_type: match?.entityType ?? null,
  };

  assertEntityResolution(resolution);

  return {
    schema_version: NAME_NORMALIZATION_SCHEMA_VERSION,
    ruleset_version: NAME_NORMALIZATION_RULESET_VERSION,
    source_text: sourceText,
    normalized_text: normalizedText,
    normalized_key: normalizedKey,
    locale: normalizedOptions.locale,
    resolution,
  };
}

/**
 * Normalize a batch of names using one index build, preserving input order.
 *
 * @param {unknown} sourceTexts
 * @param {{ locale?: string, canonicalEntities?: unknown[], entityIndex?: Map } | undefined} options
 * @returns {Array<object>}
 */
export function normalizeEntityNames(sourceTexts, options = {}) {
  if (!Array.isArray(sourceTexts)) {
    throw new TypeError("sourceTexts must be an array.");
  }

  const normalizedOptions = validateOptions(options);
  const entityIndex =
    normalizedOptions.entityIndex ?? buildEntityNameIndex(normalizedOptions.canonicalEntities);

  return sourceTexts.map((sourceText) =>
    normalizeEntityName(sourceText, {
      locale: normalizedOptions.locale,
      entityIndex,
    }),
  );
}

function validateOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Normalizer options must be a plain object.");
  }

  const locale = options.locale ?? DEFAULT_NAME_LOCALE;
  if (!isStableString(locale)) {
    throw new TypeError("locale must be a non-empty string without surrounding whitespace.");
  }

  if (options.canonicalEntities !== undefined && !Array.isArray(options.canonicalEntities)) {
    throw new TypeError("canonicalEntities must be an array when provided.");
  }

  if (options.entityIndex !== undefined && !(options.entityIndex instanceof Map)) {
    throw new TypeError("entityIndex must be a Map when provided.");
  }

  return {
    locale,
    canonicalEntities: options.canonicalEntities ?? [],
    entityIndex: options.entityIndex,
  };
}

function registerName(index, entity, name, matchedAlias) {
  const key = createComparableNameKey(name);
  const existing = index.get(key);
  if (existing !== undefined) {
    if (existing.entityId === entity.entity_id && existing.matchedAlias === null) {
      return;
    }

    throw new TypeError(
      `Duplicate normalized entity name "${name}" for ${existing.entityId} and ${entity.entity_id}.`,
    );
  }

  index.set(
    key,
    Object.freeze({
      entityId: entity.entity_id,
      entityType: entity.entity_type,
      canonicalName: entity.canonical_name,
      matchedAlias,
    }),
  );
}
