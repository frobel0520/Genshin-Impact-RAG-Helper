import assert from "node:assert/strict";
import test from "node:test";

import {
  SECTION_TIERS,
  classifySection,
  orderByImportance,
} from "../src/query/section-importance.js";

function chunk(text) {
  return { chunk_id: `chunk:${text.slice(0, 8)}`, text };
}

test("the numbered body is the main line", () => {
  assert.deepEqual(classifySection("一、全新地區\n納塔的…"), {
    tier: SECTION_TIERS.MAIN,
    ordinal: 1,
  });
  assert.deepEqual(classifySection("六、全新敵人\n…"), {
    tier: SECTION_TIERS.MAIN,
    ordinal: 6,
  });
});

test("the catch-all section is numbered but is not the main line", () => {
  // 「其他更新內容」 sits inside the numbered body and reads like the tail: 5.3
  // files the TCG opening characters there. It sorts after the main line and
  // before the tail rather than being treated as either.
  assert.deepEqual(classifySection("七、其他更新內容\n…"), {
    tier: SECTION_TIERS.OTHER,
    ordinal: 7,
  });
  // 2.1 words it differently.
  assert.equal(classifySection("八、其他新增內容\n…").tier, SECTION_TIERS.OTHER);
  assert.equal(classifySection("九、調整與改良\n…").tier, SECTION_TIERS.OTHER);
});

test("adjustments and fixes are the tail", () => {
  assert.equal(classifySection("〓調整及改善〓\n…").tier, SECTION_TIERS.TAIL);
  assert.equal(classifySection("〓問題修正〓\n…").tier, SECTION_TIERS.TAIL);
  assert.equal(classifySection("〓「七聖召喚」平衡性調整〓\n…").tier, SECTION_TIERS.TAIL);
});

test("compensation and download times are the preamble", () => {
  for (const heading of [
    "〓補償內容〓",
    "〓補償範圍〓",
    "〓更新時間〓",
    "〓遊戲更新方式〓",
    // 5.0 words this one differently.
    "〓用戶端更新方式〓",
    "〓本次更新內容〓",
    // 5.0–5.5 write it with the simplified 内.
    "〓本次更新内容〓",
  ]) {
    assert.equal(
      classifySection(`${heading}\n…`).tier,
      SECTION_TIERS.ADMIN,
      `${heading} is preamble`,
    );
  }
});

test("an unrecognised heading is treated as content, never demoted", () => {
  // A Fandom profile, a hand-written section, a notice with a heading style
  // nobody has seen yet: the failure mode of a classifier that guesses is that
  // real content sorts behind the bug fixes, so it does not guess.
  assert.deepEqual(classifySection("瑪拉妮是納塔的…"), {
    tier: SECTION_TIERS.MAIN,
    ordinal: 0,
  });
  assert.deepEqual(classifySection("〓開發者的話〓\n…").tier, SECTION_TIERS.TAIL);
  for (const value of [undefined, null, 42, ""]) {
    assert.deepEqual(classifySection(value), { tier: SECTION_TIERS.MAIN, ordinal: 0 });
  }
});

test("compound numerals past ten keep their order", () => {
  assert.deepEqual(classifySection("十、其他更新內容\n…"), {
    tier: SECTION_TIERS.OTHER,
    ordinal: 10,
  });
  assert.equal(classifySection("十一、全新活動\n…").ordinal, 11);
  assert.equal(classifySection("十二、全新活動\n…").ordinal, 12);
});

test("a 5.5-shaped announcement opens with the new region, not the letter box", () => {
  // The real 5.5 shape, in the chunk_id order the store returns it in: the
  // section slugs sort alphabetically, so 〓調整及改善〓 arrives second and the
  // model wrote its answer from there (docs/07-scale-test.md §3.3).
  const stored = [
    chunk("〓調整及改善〓\n「信件」介面，「信件珍藏盒」增加了搜尋功能。"),
    chunk("〓補償內容〓\n原石×600"),
    chunk("〓問題修正〓\n修正了…"),
    chunk("十、其他更新內容\n…"),
    chunk("一、全新地區\n…"),
    chunk("二、全新角色\n…"),
    chunk("三、全新秘境\n…"),
  ];

  const ordered = orderByImportance(stored).map((entry) => entry.text.split("\n", 1)[0]);

  assert.deepEqual(ordered, [
    "一、全新地區",
    "二、全新角色",
    "三、全新秘境",
    "十、其他更新內容",
    "〓調整及改善〓",
    "〓問題修正〓",
    "〓補償內容〓",
  ]);
});

test("nothing is dropped, so a question about a bug fix still has evidence", () => {
  const stored = [chunk("〓問題修正〓\n…"), chunk("一、全新角色\n…"), chunk("〓補償內容〓\n…")];
  assert.equal(orderByImportance(stored).length, stored.length);
});

test("ordering does not mutate the array it was given", () => {
  const stored = [chunk("〓問題修正〓\n…"), chunk("一、全新角色\n…")];
  const before = stored.map((entry) => entry.chunk_id);
  orderByImportance(stored);
  assert.deepEqual(
    stored.map((entry) => entry.chunk_id),
    before,
  );
});

test("chunks the classifier cannot place keep the order they arrived in", () => {
  // Stable sort: two unrecognised chunks are equal under every key, so the
  // result is the input order rather than an arbitrary one.
  const stored = [chunk("第一段沒有標題"), chunk("第二段也沒有"), chunk("第三段還是沒有")];
  assert.deepEqual(
    orderByImportance(stored).map((entry) => entry.text),
    ["第一段沒有標題", "第二段也沒有", "第三段還是沒有"],
  );
});
