import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hashText, main } from "../scripts/fetch-sources.js";

const ARTICLE_HTML = [
  "<p>親愛的旅行者：</p>",
  "<p>〓更新時間〓</p>",
  "<p>2024/08/28 06:00 (UTC+8)開始。</p>",
  "<p>一、全新地區</p>",
  "<p>開放全新區域——「納塔」</p>",
  "<p>二、全新敵人</p>",
  "<p>不該被收進來的段落。</p>",
].join("");

const REGION_TEXT = "一、全新地區\n開放全新區域——「納塔」";

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) },
  };
}

function workspace(context) {
  const directory = mkdtempSync(join(tmpdir(), "fetch-sources-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return directory;
}

function pointerFile(overrides = {}) {
  return {
    key: "hoyolab-version-5-0",
    source_kind: "hoyolab",
    source_url: "https://www.hoyolab.com/article/32547672",
    title: "「榮花與炎日之途」5.0版本更新說明",
    retrieved_at: "2026-08-29T00:00:00Z",
    game_version: "5.0",
    sections: [
      { id: "update-time", locator: { start: "〓更新時間〓" } },
      {
        id: "new-region-natlan",
        locator: { start: "一、全新地區", end: "二、全新敵人" },
        entity_ids: ["ent:natlan"],
      },
    ],
    ...overrides,
  };
}

function fixture(context, article = pointerFile()) {
  const directory = workspace(context);
  const sourcesDir = join(directory, "sources");
  const outDir = join(directory, "out");
  mkdirSync(sourcesDir, { recursive: true });
  writeFileSync(join(sourcesDir, "hoyolab-5-0.json"), JSON.stringify(article), "utf8");
  return { sourcesDir, outDir };
}

const fakeFetch = async () => ({ html: ARTICLE_HTML, title: "fetched title" });

test("a pointer file becomes local text the pack step can read", async (context) => {
  const { sourcesDir, outDir } = fixture(context);
  const { stdout, streams } = capture();

  const code = await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch });

  assert.equal(code, 0);
  assert.deepEqual(readdirSync(outDir), ["hoyolab-5-0.json"]);

  const written = JSON.parse(readFileSync(join(outDir, "hoyolab-5-0.json"), "utf8"));
  assert.equal(written.key, "hoyolab-version-5-0");
  assert.equal(written.retrieved_at, "2026-08-29T00:00:00Z");
  assert.deepEqual(written.sections.map((s) => s.id), ["update-time", "new-region-natlan"]);
  assert.equal(written.sections[1].text, REGION_TEXT);
  assert.deepEqual(written.sections[1].entity_ids, ["ent:natlan"]);
  // The locator stays in the repository file; what the pack reads is text.
  assert.equal(written.sections[1].locator, undefined);
  assert.match(stdout.join(""), /2 sections/);
});

test("the end marker keeps the next section out", async (context) => {
  const { sourcesDir, outDir } = fixture(context);
  const { streams } = capture();

  await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch });

  const written = JSON.parse(readFileSync(join(outDir, "hoyolab-5-0.json"), "utf8"));
  assert.ok(!written.sections[1].text.includes("不該被收進來的段落"));
});

test("text that no longer hashes to its record stops the run", async (context) => {
  const article = pointerFile();
  article.sections[1].content_hash = hashText("something the article no longer says");
  const { sourcesDir, outDir } = fixture(context, article);
  const { stderr, streams } = capture();

  const code = await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch });

  assert.equal(code, 1);
  assert.match(stderr.join(""), /no longer matches its recorded hash/);
  assert.match(stderr.join(""), /new-region-natlan/);
  assert.deepEqual(readdirSync(outDir), [], "nothing is written for a source that failed");
});

test("a matching hash passes silently", async (context) => {
  const article = pointerFile();
  article.sections[1].content_hash = hashText(REGION_TEXT);
  const { sourcesDir, outDir } = fixture(context, article);
  const { streams } = capture();

  assert.equal(
    await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch }),
    0,
  );
});

test("a file that still carries section text is refused, not rewritten", async (context) => {
  const legacy = pointerFile({
    sections: [{ id: "update-time", text: "〓更新時間〓\n2024/08/28" }],
  });
  const { sourcesDir, outDir } = fixture(context, legacy);
  const { stderr, streams } = capture();

  const code = await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch });

  assert.equal(code, 1);
  assert.match(stderr.join(""), /carries section text/);
});

test("a failing fetch names the source and leaves the rest alone", async (context) => {
  const { sourcesDir, outDir } = fixture(context);
  const { stderr, streams } = capture();

  const code = await main([sourcesDir, "--out", outDir], streams, {
    fetchArticle: async () => {
      throw new Error("HoYoLAB returned HTTP 503 for post 32547672.");
    },
  });

  assert.equal(code, 1);
  assert.match(stderr.join(""), /hoyolab-5-0\.json: HoYoLAB returned HTTP 503/);
  assert.match(stderr.join(""), /0 of 1 written/);
});

test("the command explains itself instead of guessing", async (context) => {
  const directory = workspace(context);
  const { stderr, streams } = capture();

  assert.equal(await main([], streams, { fetchArticle: fakeFetch }), 2);
  assert.match(stderr.join(""), /Usage:/);

  assert.equal(
    await main([join(directory, "missing")], streams, { fetchArticle: fakeFetch }),
    1,
  );
  assert.match(stderr.join(""), /No directory at/);
});

test("a failed source leaves no output behind from an earlier run", async (context) => {
  const { sourcesDir, outDir } = fixture(context);
  const { streams } = capture();

  // First run succeeds and writes the text.
  assert.equal(await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch }), 0);
  assert.deepEqual(readdirSync(outDir), ["hoyolab-5-0.json"]);

  // The article then changes upstream, so the pointer's hash no longer matches.
  const article = pointerFile();
  article.sections[1].content_hash = hashText("what the article used to say");
  writeFileSync(join(sourcesDir, "hoyolab-5-0.json"), JSON.stringify(article), "utf8");

  assert.equal(await main([sourcesDir, "--out", outDir], streams, { fetchArticle: fakeFetch }), 1);

  // Left in place, the stale file is text the current pointer no longer
  // describes, and make:pack would build a dataset from it — which is the
  // outcome the hash check exists to prevent.
  assert.deepEqual(readdirSync(outDir), []);
});
