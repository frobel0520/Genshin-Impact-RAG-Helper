/**
 * Which part of a version announcement a chunk came from.
 *
 * A 「這個版本更新了什麼」 question takes the whole announcement (see
 * `document-retrieval.js`), and that is the right evidence — but handing it over
 * unordered is not. `docs/08-version-section-shapes.md` counted the shape of
 * seven announcements: every one of them is an administrative preamble, then a
 * numbered main line, then a tail of per-line UI tweaks and bug fixes. The main
 * line is 11%–49% of the text.
 *
 * Two answers measured in `docs/07-scale-test.md` §3.3 opened with a tail line —
 * 5.3 with a voice-over fix, 5.5 with a search box in the letter collection —
 * because the chunks arrived in `chunk_id` order, which is neither importance
 * nor document order. Ordering them by which part of the notice they came from
 * is what this module is for.
 *
 * Nothing is dropped. A reader who asks about a bug fix must still be able to
 * reach one, so the tail is evidence too — it is simply not what the answer
 * should open with.
 */

/**
 * Lower sorts first.
 *
 * `MAIN` is the numbered body minus its catch-all section; `OTHER` is that
 * catch-all, which is numbered like the main line but reads like the tail;
 * `TAIL` is the per-line adjustments and fixes; `ADMIN` is the preamble about
 * compensation and download times, which answers no question about content.
 */
export const SECTION_TIERS = Object.freeze({
  MAIN: 0,
  OTHER: 1,
  TAIL: 2,
  ADMIN: 3,
});

/**
 * The preamble, verbatim as the announcements write it. 5.0 says 用戶端更新方式
 * where the others say 遊戲更新方式, and 5.0–5.5 write 内容 with the simplified
 * 内; both spellings are listed rather than normalised, because a heading this
 * module fails to recognise must fall back to "treat it as content" instead of
 * being silently demoted.
 */
const ADMIN_HEADINGS = new Set([
  "補償內容",
  "補償範圍",
  "更新時間",
  "遊戲更新方式",
  "用戶端更新方式",
  "本次更新內容",
  "本次更新内容",
]);

/** The numbered section that carries miscellany rather than the release's subject. */
const CATCH_ALL_HEADING = /^其他(?:更新|新增)內容$|^調整與改良$/;

const BRACKETED_HEADING = /^〓(.+)〓$/;
const NUMBERED_HEADING = /^([一二三四五六七八九十]+)、(.+)$/;

const NUMERALS = Object.freeze({
  一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10,
});

/**
 * Classify one chunk by the heading it starts with.
 *
 * A section's locator starts at its heading, so the heading is the chunk's first
 * line. Anything this module does not recognise is `MAIN`: a chunk that is not
 * shaped like an announcement section — a Fandom profile, a hand-written
 * section, a future notice with a heading style nobody has seen yet — must keep
 * the position it already had rather than be pushed behind the bug fixes.
 *
 * @param {string} text the chunk's text
 * @returns {{ tier: number, ordinal: number }}
 */
export function classifySection(text) {
  const heading = typeof text === "string" ? text.split("\n", 1)[0].trim() : "";

  const bracketed = BRACKETED_HEADING.exec(heading);
  if (bracketed !== null) {
    return ADMIN_HEADINGS.has(bracketed[1].trim())
      ? { tier: SECTION_TIERS.ADMIN, ordinal: 0 }
      : { tier: SECTION_TIERS.TAIL, ordinal: 0 };
  }

  const numbered = NUMBERED_HEADING.exec(heading);
  if (numbered !== null) {
    const label = numbered[2].trim();
    const ordinal = readNumeral(numbered[1]);
    return CATCH_ALL_HEADING.test(label)
      ? { tier: SECTION_TIERS.OTHER, ordinal }
      : { tier: SECTION_TIERS.MAIN, ordinal };
  }

  return { tier: SECTION_TIERS.MAIN, ordinal: 0 };
}

/**
 * Order chunks so the answer opens with what the reader asked about.
 *
 * Within a tier the numbered sections keep the announcement's own order, and
 * anything without a number keeps the order it arrived in — the sort is stable,
 * so this never invents an ordering it cannot justify.
 *
 * @param {object[]} chunks
 * @returns {object[]} a new array; the input is not mutated
 */
export function orderByImportance(chunks) {
  return [...chunks]
    .map((chunk, index) => ({ chunk, index, ...classifySection(chunk?.text) }))
    .sort(
      (left, right) =>
        left.tier - right.tier || left.ordinal - right.ordinal || left.index - right.index,
    )
    .map((entry) => entry.chunk);
}

function readNumeral(value) {
  if (NUMERALS[value] !== undefined) {
    return NUMERALS[value];
  }
  // 十一、十二… — the only compound the announcements reach, and only just.
  const compound = /^十([一二三四五六七八九])$/.exec(value);
  return compound === null ? 0 : 10 + NUMERALS[compound[1]];
}
