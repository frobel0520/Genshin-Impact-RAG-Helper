/**
 * Locating source text inside a fetched article.
 *
 * The project stores pointers, not source text (see
 * `docs/05-source-licensing.md`): a source file names an article and the
 * markers that bound each section, and the text itself is fetched locally. This
 * module is the half of that which never touches the network, so the rule that
 * decides what a section contains is testable without one.
 *
 * Every failure here is loud. A marker that no longer appears, or two markers
 * that appear in the wrong order, means the upstream article changed under a
 * pointer that was written against an older version of it — and a silently
 * shorter section would reach the index as evidence, be cited, and look exactly
 * like evidence that was checked.
 */

const BLOCK_TAG_PATTERN = /<\/p\s*>|<br\s*\/?>|<\/div\s*>|<\/li\s*>|<\/h[1-6]\s*>/gi;
const TAG_PATTERN = /<[^>]*>/g;
const ENTITIES = Object.freeze({
  "&nbsp;": " ",
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
});

/**
 * Convert an article's HTML body to the plain text a locator is written
 * against.
 *
 * Block boundaries become newlines before tags are dropped, because a heading
 * and the line under it must not run together into one word that no marker can
 * match.
 *
 * @param {string} html
 * @returns {string}
 */
export function htmlToPlainText(html) {
  if (typeof html !== "string") {
    throw new TypeError("html must be a string.");
  }
  const withBreaks = html.replace(BLOCK_TAG_PATTERN, "\n");
  const withoutTags = withBreaks.replace(TAG_PATTERN, "");
  const decoded = withoutTags.replace(
    /&nbsp;|&amp;|&lt;|&gt;|&quot;|&#39;/g,
    (entity) => ENTITIES[entity],
  );
  return decoded
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Cut the sections a source file points at out of an article.
 *
 * `start` is included in the section; `end` is not. A section without `end`
 * runs to the next section's `start`, and the last one to the end of the
 * article — which is why an article that carries unrelated matter after the
 * last section of interest needs an explicit `end`.
 *
 * @param {string} text plain text, as produced by `htmlToPlainText`
 * @param {{ id: string, locator: { start: string, end?: string } }[]} sections
 * @returns {{ id: string, text: string }[]}
 */
export function extractSections(text, sections) {
  if (typeof text !== "string" || text.trim() === "") {
    throw new TypeError("text must be a non-empty string.");
  }
  if (!Array.isArray(sections) || sections.length === 0) {
    throw new TypeError("sections must be a non-empty array.");
  }

  const located = sections.map((section) => {
    const { id, locator } = validateSection(section);
    const start = text.indexOf(locator.start);
    if (start === -1) {
      throw new Error(
        `Section ${id}: start marker ${JSON.stringify(locator.start)} is not in the article. ` +
          "The article changed, or the marker was mistyped.",
      );
    }
    if (text.indexOf(locator.start, start + 1) !== -1) {
      throw new Error(
        `Section ${id}: start marker ${JSON.stringify(locator.start)} appears more than once, ` +
          "so which text it points at is not decided. Use a longer marker.",
      );
    }
    return { id, locator, start };
  });

  // Sections are cut in the order they appear in the article, not the order
  // they were written in, so a source file may list them however it reads best.
  const ordered = [...located].sort((left, right) => left.start - right.start);

  const byId = new Map();
  for (const [index, entry] of ordered.entries()) {
    const nextStart = index + 1 < ordered.length ? ordered[index + 1].start : text.length;
    const end = resolveEnd(text, entry, nextStart);
    const body = text.slice(entry.start, end).trim();
    if (body === "") {
      throw new Error(
        `Section ${entry.id}: the markers bound an empty span. ` +
          "The end marker probably sits before the start marker.",
      );
    }
    byId.set(entry.id, body);
  }

  // Returned in the source file's own order: the file decides how the document
  // reads, and this module only decides where each piece begins and ends.
  return sections.map((section) => ({ id: section.id, text: byId.get(section.id) }));
}

function resolveEnd(text, entry, nextStart) {
  if (entry.locator.end === undefined) {
    return nextStart;
  }
  const end = text.indexOf(entry.locator.end, entry.start + entry.locator.start.length);
  if (end === -1) {
    throw new Error(
      `Section ${entry.id}: end marker ${JSON.stringify(entry.locator.end)} does not appear after ` +
        "the start marker. The article changed, or the marker was mistyped.",
    );
  }
  return end;
}

function validateSection(section) {
  if (section === null || typeof section !== "object" || Array.isArray(section)) {
    throw new TypeError("Each section must be a plain object.");
  }
  if (typeof section.id !== "string" || section.id.trim() === "") {
    throw new TypeError("Each section needs a non-empty id.");
  }
  const { locator } = section;
  if (locator === null || typeof locator !== "object" || Array.isArray(locator)) {
    throw new TypeError(`Section ${section.id}: locator must be a plain object.`);
  }
  if (typeof locator.start !== "string" || locator.start.trim() === "") {
    throw new TypeError(`Section ${section.id}: locator.start must be a non-empty string.`);
  }
  if (
    locator.end !== undefined &&
    (typeof locator.end !== "string" || locator.end.trim() === "")
  ) {
    throw new TypeError(`Section ${section.id}: locator.end must be a non-empty string.`);
  }
  for (const field of Object.keys(locator)) {
    if (field !== "start" && field !== "end") {
      throw new TypeError(`Section ${section.id}: unknown locator field ${field}.`);
    }
  }
  return { id: section.id, locator };
}
