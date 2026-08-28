import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { validateFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import {
  buildSourcePack,
  estimateTokens,
  main,
  packParagraphs,
} from "../scripts/make-source-pack.js";

const RETRIEVED_AT = "2026-08-29T00:00:00Z";

function article(overrides = {}) {
  return {
    key: "hoyolab-version-5-0",
    source_kind: "hoyolab",
    source_url: "https://www.hoyolab.com/article/32456789",
    title: "《原神》5.0版本更新說明",
    published_at: "2024-08-28T07:00:00+08:00",
    game_version: "5.0",
    sections: [{ id: "new-characters", text: "5.0版本新角色瑪拉妮登場。" }],
    ...overrides,
  };
}

function capture() {
  const stdout = [];
  const stderr = [];
  return {
    stdout,
    stderr,
    streams: {
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
    },
  };
}

function workspace(context) {
  const directory = mkdtempSync(join(tmpdir(), "make-source-pack-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    write(name, value) {
      const path = join(directory, name);
      writeFileSync(path, JSON.stringify(value), "utf8");
      return path;
    },
  };
}

test("an article becomes a dataset the ingest contract accepts", () => {
  const pack = buildSourcePack({ articles: [article()], retrievedAt: RETRIEVED_AT });

  assert.equal(validateFixtureSourcePack(pack).ok, true);
  assert.deepEqual(pack.source_documents, [
    {
      source_id: "src:hoyolab-version-5-0",
      source_kind: "hoyolab",
      source_url: "https://www.hoyolab.com/article/32456789",
      title: "《原神》5.0版本更新說明",
      retrieved_at: RETRIEVED_AT,
      locale: "zh-TW",
      rights_note:
        "Personal non-commercial use; retain official attribution and URL; terms review pending.",
      content_hash: pack.source_documents[0].content_hash,
      published_at: "2024-08-28T07:00:00+08:00",
      game_version: "5.0",
    },
  ]);
  assert.match(pack.source_documents[0].content_hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(pack.document_chunks, [
    {
      chunk_id: "chunk:hoyolab-version-5-0-new-characters",
      source_id: "src:hoyolab-version-5-0",
      document_locator: "https://www.hoyolab.com/article/32456789#new-characters",
      text: "5.0版本新角色瑪拉妮登場。",
      token_hint: pack.document_chunks[0].token_hint,
      game_version: "5.0",
      entity_ids: [],
    },
  ]);
});

test("the content hash follows the text, not the metadata", () => {
  const [original] = buildSourcePack({
    articles: [article()],
    retrievedAt: RETRIEVED_AT,
  }).source_documents;
  const [restamped] = buildSourcePack({
    articles: [article()],
    retrievedAt: "2027-01-01T00:00:00Z",
  }).source_documents;
  const [edited] = buildSourcePack({
    articles: [article({ sections: [{ id: "new-characters", text: "改過的正文。" }] })],
    retrievedAt: RETRIEVED_AT,
  }).source_documents;

  assert.equal(restamped.content_hash, original.content_hash);
  assert.notEqual(edited.content_hash, original.content_hash);
});

test("an article without a game version records it as unknown on the chunk", () => {
  const pack = buildSourcePack({
    articles: [article({ game_version: undefined, published_at: undefined })],
    retrievedAt: RETRIEVED_AT,
  });

  assert.equal(validateFixtureSourcePack(pack).ok, true);
  assert.equal("game_version" in pack.source_documents[0], false);
  assert.equal("published_at" in pack.source_documents[0], false);
  assert.equal(pack.document_chunks[0].game_version, "unknown");
});

test("a body is packed into numbered chunks within the character budget", () => {
  const pack = buildSourcePack({
    articles: [
      article({
        sections: undefined,
        body: `${"甲".repeat(300)}\n\n${"乙".repeat(300)}\n\n${"丙".repeat(50)}`,
      }),
    ],
    retrievedAt: RETRIEVED_AT,
    maxChunkChars: 480,
  });

  assert.equal(validateFixtureSourcePack(pack).ok, true);
  assert.deepEqual(
    pack.document_chunks.map((chunk) => chunk.chunk_id),
    ["chunk:hoyolab-version-5-0-p1", "chunk:hoyolab-version-5-0-p2"],
  );
  assert.equal(pack.document_chunks[0].text.length, 300);
  assert.equal(pack.document_chunks[1].text.length, 352);
});

test("a paragraph longer than the budget stays whole", () => {
  assert.deepEqual(packParagraphs("甲".repeat(600), 480), ["甲".repeat(600)]);
});

test("the token hint counts CJK characters singly and Latin ones in fours", () => {
  assert.equal(estimateTokens("原神"), 2);
  assert.equal(estimateTokens("abcd"), 1);
  assert.equal(estimateTokens("  原神abcd  "), 3);
});

test("merging keeps the collections of the base pack and appends the new one", () => {
  const base = buildSourcePack({ articles: [article()], retrievedAt: RETRIEVED_AT });
  base.canonical_entities = [{ marker: "kept" }];

  const merged = buildSourcePack({
    articles: [
      article({
        key: "hoyolab-version-5-1",
        source_url: "https://www.hoyolab.com/article/32456790",
        title: "《原神》5.1版本更新說明",
        game_version: "5.1",
      }),
    ],
    basePack: base,
    retrievedAt: RETRIEVED_AT,
  });

  assert.deepEqual(merged.canonical_entities, [{ marker: "kept" }]);
  assert.deepEqual(
    merged.source_documents.map((document) => document.source_id),
    ["src:hoyolab-version-5-0", "src:hoyolab-version-5-1"],
  );
  assert.equal(merged.document_chunks.length, 2);
});

test("two articles claiming one source_id are rejected before anything is written", () => {
  assert.throws(
    () => buildSourcePack({ articles: [article(), article()], retrievedAt: RETRIEVED_AT }),
    /Duplicate source_id/,
  );
});

test("a missing required field names the article it came from", () => {
  assert.throws(
    () => buildSourcePack({ articles: [article({ source_url: "  " })], retrievedAt: RETRIEVED_AT }),
    /《原神》5.0版本更新說明: source_url is required/,
  );
});

test("an unknown source kind is refused", () => {
  assert.throws(
    () => buildSourcePack({ articles: [article({ source_kind: "reddit" })] }),
    /source_kind must be one of/,
  );
});

test("the CLI writes the pack and reports what it wrote", (context) => {
  const files = workspace(context);
  const articlePath = files.write("hoyolab-5-0.json", article());
  files.write("_template.json", { key: "ignored" });
  const outPath = join(files.directory, "pack.json");
  const output = capture();

  const code = main(
    [files.directory, "--out", outPath, "--retrieved-at", RETRIEVED_AT],
    output.streams,
  );

  assert.equal(code, 0);
  assert.equal(output.stderr.join(""), "");
  assert.match(output.stdout.join(""), /1 documents, 1 chunks/);
  const written = JSON.parse(readFileSync(outPath, "utf8"));
  assert.equal(validateFixtureSourcePack(written).ok, true);
  assert.equal(written.source_documents[0].source_id, "src:hoyolab-version-5-0");
  assert.ok(articlePath.endsWith("hoyolab-5-0.json"));
});

test("the CLI writes nothing when an article is unusable", (context) => {
  const files = workspace(context);
  const articlePath = files.write("broken.json", article({ sections: [] }));
  const outPath = join(files.directory, "pack.json");
  const output = capture();

  const code = main([articlePath, "--out", outPath], output.streams);

  assert.equal(code, 1);
  assert.match(output.stderr.join(""), /sections must be a non-empty array/);
  assert.throws(() => readFileSync(outPath, "utf8"), /ENOENT/);
});

test("an entity reference with no entity in the pack fails the contract check", (context) => {
  const files = workspace(context);
  const articlePath = files.write(
    "entity.json",
    article({ sections: [{ id: "a", text: "文字", entity_ids: ["ent:mualani"] }] }),
  );
  const output = capture();

  const code = main([articlePath], output.streams);

  assert.equal(code, 1);
  assert.match(output.stderr.join(""), /dataset contract/);
});

test("no arguments prints the usage and exits with the argument code", () => {
  const output = capture();

  assert.equal(main([], output.streams), 2);
  assert.match(output.stderr.join(""), /Usage:/);
});
