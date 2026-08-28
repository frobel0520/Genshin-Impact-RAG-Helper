import {
  ANSWER_STATUSES,
  AUTHORITY_RANKS,
  GAME_VERSION_UNKNOWN,
  UNCERTAINTY_REASONS,
  VERSION_CONSTRAINTS,
  VERSION_STATUSES,
  parseGameVersion,
} from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";
import { assertEvidenceBundle } from "./evidence-answer-contract.js";

export const CONFLICT_VERSION_POLICY_RULESET_VERSION = 3;

export const EXCLUSION_REASONS = Object.freeze({
  VERSION_MISMATCH: "version_mismatch",
  VERSION_UNKNOWN: "version_unknown",
  LOST_CONFLICT: "lost_conflict",
});

export const CONFLICT_RESOLUTIONS = Object.freeze({
  DOMINATED: "dominated",
  RESOLVED_BY_VERSION: "resolved_by_version",
  UNRESOLVED: "unresolved",
});

export const CONFLICT_VERSION_POLICY_RULES = Object.freeze({
  version: CONFLICT_VERSION_POLICY_RULESET_VERSION,
  order: "version-filter-then-authority-then-recency",
  authorityRanks: AUTHORITY_RANKS,
  unknownVersionIsNeverCurrent: true,
  unresolvedConflictRefuses: true,
});

const POLICY_REQUEST_FIELDS = new Set(["bundle", "versionConstraint", "gameVersion"]);
const VERSION_SPAN_SEPARATOR = "-";
const VERSION_CONSTRAINT_VALUES = new Set(Object.values(VERSION_CONSTRAINTS));

/**
 * Apply the ADR-003 version, authority, and conflict rules to an EvidenceBundle.
 *
 * The policy never invents evidence and never resolves a conflict it cannot
 * justify: an unresolved conflict group refuses instead of picking a claim, and
 * `unknown` versions are never treated as the current version.
 *
 * @param {{ bundle: object, versionConstraint: string, gameVersion?: string }} request
 * @returns {object} policy decision consumed by the Answer Formatter (T20)
 */
export function applyConflictVersionPolicy(request) {
  const { bundle, versionConstraint, gameVersion } = validateRequest(request);
  const targetVersion = resolveTargetVersion(versionConstraint, gameVersion);

  const applicableItems = [];
  const excludedItems = [];
  for (const item of bundle.items) {
    const exclusionReason = excludeReasonFor(item, targetVersion);
    if (exclusionReason === undefined) {
      applicableItems.push(item);
    } else {
      excludedItems.push({ evidence_id: item.evidence_id, reason: exclusionReason });
    }
  }
  applicableItems.sort(compareByAuthorityThenRecency);

  const conflictResolutions = bundle.conflict_groups.map((group) =>
    resolveConflictGroup(group, applicableItems, targetVersion),
  );

  // A claim that lost its conflict must not stay applicable: citing the source
  // the policy just rejected would put a discredited statement behind the
  // answer. Losers are excluded here rather than in the formatter, so the
  // reason stays with the decision that produced it.
  const losingClaimIds = collectLosingClaimIds(conflictResolutions);
  const survivingItems = [];
  for (const item of applicableItems) {
    if (item.claim_id !== undefined && losingClaimIds.has(item.claim_id)) {
      excludedItems.push({
        evidence_id: item.evidence_id,
        reason: EXCLUSION_REASONS.LOST_CONFLICT,
      });
    } else {
      // Rank follows this decision's order: the items were re-sorted by
      // authority, so the retrieval rank they arrived with no longer describes
      // their position and must not be handed on as if it did.
      survivingItems.push({ ...item, rank: survivingItems.length + 1 });
    }
  }

  const versionScope = resolveVersionScope(targetVersion, survivingItems);
  const { answerStatus, uncertaintyReason } = decideOutcome({
    applicableItems: survivingItems,
    conflictResolutions,
    versionScope,
  });

  return {
    query_id: bundle.query_id,
    ruleset_version: CONFLICT_VERSION_POLICY_RULESET_VERSION,
    answer_status: answerStatus,
    ...(uncertaintyReason === undefined ? {} : { uncertainty_reason: uncertaintyReason }),
    version_scope: versionScope,
    applicable_items: survivingItems,
    excluded_items: excludedItems,
    conflict_resolutions: conflictResolutions,
  };
}

/**
 * Create a reusable policy with the same behaviour as the direct call.
 *
 * @returns {{ rulesetVersion: number, apply: (request: object) => object }}
 */
export function createConflictVersionPolicy() {
  return Object.freeze({
    rulesetVersion: CONFLICT_VERSION_POLICY_RULESET_VERSION,
    apply: applyConflictVersionPolicy,
  });
}

function validateRequest(request) {
  if (!isRecord(request)) {
    throw new TypeError("Conflict/version policy request must be a plain object.");
  }
  for (const field of Object.keys(request)) {
    if (!POLICY_REQUEST_FIELDS.has(field)) {
      throw new TypeError(`Unknown conflict/version policy request field: ${field}.`);
    }
  }
  const bundle = assertEvidenceBundle(request.bundle);
  if (
    typeof request.versionConstraint !== "string" ||
    !VERSION_CONSTRAINT_VALUES.has(request.versionConstraint)
  ) {
    throw new TypeError(
      `versionConstraint must be one of: ${[...VERSION_CONSTRAINT_VALUES].join(", ")}.`,
    );
  }
  if (request.gameVersion !== undefined && !isStableString(request.gameVersion)) {
    throw new TypeError(
      "gameVersion must be a non-empty string without surrounding whitespace.",
    );
  }
  return {
    bundle,
    versionConstraint: request.versionConstraint,
    gameVersion: request.gameVersion,
  };
}

function resolveTargetVersion(versionConstraint, gameVersion) {
  if (versionConstraint !== VERSION_CONSTRAINTS.EXACT) {
    return undefined;
  }
  if (gameVersion === undefined) {
    throw new TypeError(
      "gameVersion is required for an exact version constraint because QueryPlan stores only the constraint type.",
    );
  }
  if (parseGameVersion(gameVersion).status !== VERSION_STATUSES.EXPLICIT) {
    throw new TypeError("gameVersion must be an explicit version for an exact constraint.");
  }
  return gameVersion;
}

function excludeReasonFor(item, targetVersion) {
  if (targetVersion === undefined) {
    return undefined;
  }
  const parsed = parseGameVersion(item.game_version);
  if (parsed.status === VERSION_STATUSES.UNKNOWN) {
    return EXCLUSION_REASONS.VERSION_UNKNOWN;
  }
  const target = parseGameVersion(targetVersion);
  const withinRange =
    compareSegments(parsed.min, target.min) <= 0 && compareSegments(parsed.max, target.min) >= 0;
  return withinRange ? undefined : EXCLUSION_REASONS.VERSION_MISMATCH;
}

function compareSegments(left, right) {
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = (left[index] ?? 0) - (right[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

function compareByAuthorityThenRecency(left, right) {
  const authorityDifference = authorityRankOf(left) - authorityRankOf(right);
  if (authorityDifference !== 0) {
    return authorityDifference;
  }
  const publishedDifference = compareTimestampsDescending(
    left.source_published_at,
    right.source_published_at,
  );
  if (publishedDifference !== 0) {
    return publishedDifference;
  }
  const retrievedDifference = compareTimestampsDescending(
    left.source_retrieved_at,
    right.source_retrieved_at,
  );
  if (retrievedDifference !== 0) {
    return retrievedDifference;
  }
  return left.evidence_id.localeCompare(right.evidence_id);
}

function authorityRankOf(item) {
  return AUTHORITY_RANKS[item.source_kind] ?? Number.MAX_SAFE_INTEGER;
}

function compareTimestampsDescending(left, right) {
  const leftTime = toTimestamp(left);
  const rightTime = toTimestamp(right);
  if (leftTime === rightTime) {
    return 0;
  }
  if (leftTime === undefined) {
    return 1;
  }
  if (rightTime === undefined) {
    return -1;
  }
  return rightTime - leftTime;
}

function toTimestamp(value) {
  if (typeof value !== "string") {
    return undefined;
  }
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? undefined : timestamp;
}

function resolveConflictGroup(group, applicableItems, targetVersion) {
  const members = applicableItems.filter(
    (item) => item.claim_id !== undefined && group.claim_ids.includes(item.claim_id),
  );

  if (members.length === 0) {
    return {
      conflict_group_id: group.conflict_group_id,
      resolution: CONFLICT_RESOLUTIONS.UNRESOLVED,
      claim_ids: [...group.claim_ids],
      reason: "every claim in the group was excluded by the version filter",
    };
  }

  // Without a version filter, a missing member was never retrieved rather than
  // ruled out. Declaring a winner then would resolve the conflict by absence:
  // the claim that is not here could be the authoritative one.
  if (members.length < group.claim_ids.length && targetVersion === undefined) {
    return {
      conflict_group_id: group.conflict_group_id,
      resolution: CONFLICT_RESOLUTIONS.UNRESOLVED,
      claim_ids: members.map((item) => item.claim_id),
      reason: "at least one claim in the group was never retrieved, so nothing can be compared",
    };
  }

  if (members.length === 1) {
    return members.length === group.claim_ids.length
      ? {
          conflict_group_id: group.conflict_group_id,
          resolution: CONFLICT_RESOLUTIONS.DOMINATED,
          claim_ids: members.map((item) => item.claim_id),
          winning_claim_id: members[0].claim_id,
          reason: "the group holds a single claim, so nothing contradicts it",
        }
      : {
          conflict_group_id: group.conflict_group_id,
          resolution: CONFLICT_RESOLUTIONS.RESOLVED_BY_VERSION,
          claim_ids: members.map((item) => item.claim_id),
          winning_claim_id: members[0].claim_id,
          reason: "only one claim in the group applies to the requested version",
        };
  }

  const [best, runnerUp] = members;
  if (authorityRankOf(best) < authorityRankOf(runnerUp)) {
    return {
      conflict_group_id: group.conflict_group_id,
      resolution: CONFLICT_RESOLUTIONS.DOMINATED,
      claim_ids: members.map((item) => item.claim_id),
      winning_claim_id: best.claim_id,
      reason: "one claim has a strictly higher source authority than every other claim",
    };
  }

  return {
    conflict_group_id: group.conflict_group_id,
    resolution: CONFLICT_RESOLUTIONS.UNRESOLVED,
    claim_ids: members.map((item) => item.claim_id),
    reason: "no claim dominates: equal source authority within the same version scope",
  };
}

function collectLosingClaimIds(conflictResolutions) {
  const losing = new Set();
  for (const resolution of conflictResolutions) {
    if (resolution.winning_claim_id === undefined) {
      continue;
    }
    for (const claimId of resolution.claim_ids) {
      if (claimId !== resolution.winning_claim_id) {
        losing.add(claimId);
      }
    }
  }
  return losing;
}

/**
 * `unknown` means the applicable evidence cannot be pinned to a version, not
 * that it covers several. Evidence spanning known versions reports the span, so
 * a well-sourced multi-version answer is not downgraded to uncertain. Any item
 * whose own version is unknown still makes the whole scope unknown: the scope
 * has to hold for every citation behind the answer.
 */
function resolveVersionScope(targetVersion, applicableItems) {
  if (targetVersion !== undefined) {
    return targetVersion;
  }

  const known = [];
  for (const item of applicableItems) {
    const parsed = parseGameVersion(item.game_version);
    if (parsed.status === VERSION_STATUSES.UNKNOWN) {
      return GAME_VERSION_UNKNOWN;
    }
    known.push({ version: item.game_version, min: parsed.min, max: parsed.max });
  }
  if (known.length === 0) {
    return GAME_VERSION_UNKNOWN;
  }

  const distinct = new Set(known.map((entry) => entry.version));
  if (distinct.size === 1) {
    return [...distinct][0];
  }

  const lowest = known.reduce((best, entry) =>
    compareSegments(entry.min, best.min) < 0 ? entry : best,
  );
  const highest = known.reduce((best, entry) =>
    compareSegments(entry.max, best.max) > 0 ? entry : best,
  );
  return `${formatSegments(lowest.min)}${VERSION_SPAN_SEPARATOR}${formatSegments(highest.max)}`;
}

function formatSegments(segments) {
  return segments.join(".");
}

function decideOutcome({ applicableItems, conflictResolutions, versionScope }) {
  if (
    conflictResolutions.some(
      (resolution) => resolution.resolution === CONFLICT_RESOLUTIONS.UNRESOLVED,
    )
  ) {
    return {
      answerStatus: ANSWER_STATUSES.REFUSED,
      uncertaintyReason: UNCERTAINTY_REASONS.SOURCE_CONFLICT,
    };
  }
  if (applicableItems.length === 0) {
    return {
      answerStatus: ANSWER_STATUSES.REFUSED,
      uncertaintyReason: UNCERTAINTY_REASONS.INSUFFICIENT_EVIDENCE,
    };
  }
  if (versionScope === GAME_VERSION_UNKNOWN) {
    return {
      answerStatus: ANSWER_STATUSES.UNCERTAIN,
      uncertaintyReason: UNCERTAINTY_REASONS.VERSION_UNKNOWN,
    };
  }
  return { answerStatus: ANSWER_STATUSES.ANSWERED, uncertaintyReason: undefined };
}
