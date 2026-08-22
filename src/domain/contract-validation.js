/**
 * Shared validation primitives for the repository's boundary contracts.
 *
 * These helpers are intentionally dependency-free so every runtime layer can
 * validate untrusted data without importing another feature module.
 */

/**
 * @typedef {{ code: string, path: string, message: string }} ValidationError
 * @typedef {{
 *   ok: true,
 *   value: unknown,
 * } | {
 *   ok: false,
 *   errors: ValidationError[],
 * }} ValidationResult
 */

const ISO_DATETIME_PATTERN =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:0\d|1\d):[0-5]\d)$/;

/**
 * @param {string} code
 * @param {string} path
 * @param {string} message
 * @returns {ValidationError}
 */
export function createError(code, path, message) {
  return { code, path, message };
}

/**
 * @param {ValidationError[]} errors
 * @returns {string}
 */
export function formatValidationErrors(errors) {
  return errors.map(({ path, message }) => `${path}: ${message}`).join(" ");
}

/**
 * @param {string} code
 * @param {string} message
 * @returns {{ ok: false, errors: ValidationError[] }}
 */
export function invalidDocumentResult(code, message) {
  return {
    ok: false,
    errors: [createError(code, "$", message)],
  };
}

/**
 * @param {ValidationResult} result
 * @param {string} label
 * @returns {unknown}
 * @throws {TypeError} when validation fails
 */
export function assertValid(result, label) {
  if (!result.ok) {
    throw new TypeError(`Invalid ${label}. ${formatValidationErrors(result.errors)}`);
  }

  return result.value;
}

/**
 * @param {ValidationError[]} errors
 * @param {string} prefix
 * @returns {ValidationError[]}
 */
export function prefixErrors(errors, prefix) {
  return errors.map((error) => ({ ...error, path: `${prefix}.${error.path}` }));
}

/**
 * Return true only for plain objects, because contract records must not accept
 * class instances such as Date or Map as silently compatible data objects.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
export function isRecord(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isStableString(value) {
  return isNonEmptyString(value) && value.trim() === value;
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isHttpUrl(value) {
  if (typeof value !== "string" || value.trim() !== value || value.length === 0) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
export function isIsoDateTime(value) {
  if (typeof value !== "string" || !ISO_DATETIME_PATTERN.test(value)) {
    return false;
  }

  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    return false;
  }

  const [year, month, day] = value.slice(0, 10).split("-").map(Number);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  return (
    calendarDate.getUTCFullYear() === year &&
    calendarDate.getUTCMonth() === month - 1 &&
    calendarDate.getUTCDate() === day
  );
}

/**
 * @param {unknown} value
 * @param {Set<object>} ancestors
 * @returns {boolean}
 */
export function isJsonValue(value, ancestors = new Set()) {
  if (value === null) {
    return true;
  }

  if (typeof value === "string" || typeof value === "boolean") {
    return true;
  }

  if (typeof value === "number") {
    return Number.isFinite(value);
  }

  if (typeof value !== "object" || ancestors.has(value)) {
    return false;
  }

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every((item) => isJsonValue(item, ancestors))
    : isRecord(value) && Object.values(value).every((item) => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}
