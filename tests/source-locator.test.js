import assert from "node:assert/strict";
import test from "node:test";

import { extractSections, htmlToPlainText } from "../src/ingest/source-locator.js";

const ARTICLE = [
  "親愛的旅行者：",
  "",
  "〓更新時間〓",
  "2024/08/28 06:00 (UTC+8)開始，預計5個小時完成。",
  "",
  "一、全新地區",
  "開放全新區域——「納塔」",
  "",
  "二、全新角色",
  "「嘩啦啦逐浪客·瑪拉妮」",
  "",
  "〓補償內容〓",
  "原石x300",
].join("\n");

test("plain text keeps block boundaries so markers stay on their own lines", () => {
  const html = "<p>〓更新時間〓</p><p>2024/08/28 06:00 (UTC+8)開始</p><div>一、全新地區</div>";

  const text = htmlToPlainText(html);

  assert.equal(text, "〓更新時間〓\n2024/08/28 06:00 (UTC+8)開始\n一、全新地區");
  // A heading run together with its body is a marker nobody can match.
  assert.ok(!text.includes("〓更新時間〓2024"));
});

test("entities and stray whitespace are resolved before matching", () => {
  const text = htmlToPlainText("<p>  A&nbsp;&amp;&nbsp;B  </p><br><p>C&#39;s</p>");

  // The blank line survives: a paragraph break is content, and make:pack packs
  // blank-line paragraphs into chunks.
  assert.equal(text, "A & B\n\nC's");
});

test("a section runs from its start marker to the next section's", () => {
  const sections = extractSections(ARTICLE, [
    { id: "update-time", locator: { start: "〓更新時間〓" } },
    { id: "new-region", locator: { start: "一、全新地區" } },
  ]);

  assert.deepEqual(sections.map((section) => section.id), ["update-time", "new-region"]);
  assert.equal(
    sections[0].text,
    "〓更新時間〓\n2024/08/28 06:00 (UTC+8)開始，預計5個小時完成。",
  );
  assert.ok(sections[1].text.startsWith("一、全新地區"));
});

test("an explicit end marker stops a section short of the rest of the article", () => {
  const [section] = extractSections(ARTICLE, [
    { id: "characters", locator: { start: "二、全新角色", end: "〓補償內容〓" } },
  ]);

  // Without the end marker this section would swallow the compensation notice,
  // which is the failure the last section of a real announcement runs into.
  assert.equal(section.text, "二、全新角色\n「嘩啦啦逐浪客·瑪拉妮」");
});

test("sections are cut in article order but returned in the file's order", () => {
  const sections = extractSections(ARTICLE, [
    { id: "region", locator: { start: "一、全新地區" } },
    { id: "time", locator: { start: "〓更新時間〓" } },
  ]);

  assert.deepEqual(sections.map((section) => section.id), ["region", "time"]);
  // Order in the file did not make 〓更新時間〓 run to the end of the article.
  assert.ok(sections[1].text.endsWith("預計5個小時完成。"));
  assert.ok(!sections[1].text.includes("一、全新地區"));
});

test("a marker the article no longer contains fails loudly", () => {
  assert.throws(
    () => extractSections(ARTICLE, [{ id: "gone", locator: { start: "六、全新系統" } }]),
    /start marker .* is not in the article/,
  );
  assert.throws(
    () =>
      extractSections(ARTICLE, [
        { id: "bad-end", locator: { start: "一、全新地區", end: "〓更新時間〓" } },
      ]),
    /end marker .* does not appear after/,
  );
});

test("an ambiguous marker is refused rather than resolved by guessing", () => {
  const repeated = "標題\n內容\n標題\n其他";

  assert.throws(
    () => extractSections(repeated, [{ id: "which", locator: { start: "標題" } }]),
    /appears more than once/,
  );
});

test("malformed sections and locators fail closed", () => {
  assert.throws(() => extractSections("", [{ id: "a", locator: { start: "x" } }]), /non-empty string/);
  assert.throws(() => extractSections(ARTICLE, []), /non-empty array/);
  assert.throws(() => extractSections(ARTICLE, [{ locator: { start: "一" } }]), /non-empty id/);
  assert.throws(() => extractSections(ARTICLE, [{ id: "a" }]), /locator must be a plain object/);
  assert.throws(
    () => extractSections(ARTICLE, [{ id: "a", locator: { start: "" } }]),
    /locator.start must be a non-empty string/,
  );
  assert.throws(
    () => extractSections(ARTICLE, [{ id: "a", locator: { start: "一、全新地區", from: "x" } }]),
    /unknown locator field from/,
  );
  assert.throws(() => htmlToPlainText(null), /html must be a string/);
});
