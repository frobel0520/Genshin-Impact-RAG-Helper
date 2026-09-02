import assert from "node:assert/strict";
import test from "node:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { main } from "../scripts/fetch-genshin-db.js";

const COMMIT = "8b15995fa220c88a4d0d7ffe1e21b041d0b32588";

function capture() {
  const stdout = [];
  const stderr = [];
  return { stdout, stderr, streams: { stdout: (t) => stdout.push(t), stderr: (t) => stderr.push(t) } };
}

function workspace(context) {
  const directory = mkdtempSync(join(tmpdir(), "fetch-genshin-db-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(directory, { recursive: true });
  return directory;
}

function fixture(context, pointerOverrides = {}, base = { schema_version: 1, structured_facts: [], source_documents: [] }) {
  const directory = workspace(context);
  const pointerPath = join(directory, "pointer.json");
  const basePath = join(directory, "base.json");
  const outPath = join(directory, "out.json");
  writeFileSync(
    pointerPath,
    JSON.stringify({
      source_id: "src:genshin-db",
      commit: COMMIT,
      retrieved_at: "2026-09-02T00:00:00Z",
      entries: [
        { entity_id: "ent:mualani", entity_type: "character", collection: "characters", file: "mualani" },
      ],
      ...pointerOverrides,
    }),
    "utf8",
  );
  writeFileSync(basePath, JSON.stringify(base), "utf8");
  return { pointerPath, basePath, outPath };
}

const fakeRecord = async () => ({
  elementType: "ELEMENT_HYDRO",
  weaponType: "WEAPON_CATALYST",
  rarity: 5,
});

function run(paths, streams, dependencies = { fetchRecord: fakeRecord }) {
  return main([paths.pointerPath, "--base", paths.basePath, "--out", paths.outPath], streams, dependencies);
}

test("genshin-db records become facts appended to the base pack", async (context) => {
  const paths = fixture(context, {}, {
    schema_version: 1,
    source_documents: [],
    structured_facts: [{ fact_id: "fact:existing", entity_id: "ent:x", field_key: "element", value: "Pyro" }],
  });
  const { stdout, streams } = capture();

  assert.equal(await run(paths, streams), 0);

  const merged = JSON.parse(readFileSync(paths.outPath, "utf8"));
  // The hand-maintained facts survive: this appends a second source, it does
  // not replace the first.
  assert.equal(merged.structured_facts[0].fact_id, "fact:existing");
  assert.equal(merged.structured_facts.length, 4);
  assert.deepEqual(
    merged.structured_facts.slice(1).map((fact) => fact.value),
    ["Hydro", "Catalyst", 5],
  );

  const document = merged.source_documents.at(-1);
  assert.equal(document.source_kind, "genshin-db");
  assert.equal(document.source_url, `https://github.com/theBowja/genshin-db/tree/${COMMIT}`);
  assert.match(document.content_hash, /^[0-9a-f]{64}$/);
  assert.match(document.rights_note, /HoYoverse retains it/);
  assert.match(stdout.join(""), /3 facts from 1 genshin-db records/);
});

test("the content hash covers the mapping, not just the commit", async (context) => {
  const first = fixture(context);
  const second = fixture(context);
  const { streams } = capture();

  await run(first, streams);
  await run(second, streams, {
    fetchRecord: async () => ({ elementType: "ELEMENT_CRYO", weaponType: "WEAPON_CATALYST", rarity: 5 }),
  });

  const a = JSON.parse(readFileSync(first.outPath, "utf8")).source_documents.at(-1).content_hash;
  const b = JSON.parse(readFileSync(second.outPath, "utf8")).source_documents.at(-1).content_hash;
  // Same commit, different values — re-pinning to a revision whose values are
  // identical is not a change, and a changed value is.
  assert.notEqual(a, b);
});

test("an unmapped value stops the run and writes nothing", async (context) => {
  const paths = fixture(context);
  const { stderr, streams } = capture();

  const code = await run(paths, streams, {
    fetchRecord: async () => ({ elementType: "ELEMENT_MOON", weaponType: "WEAPON_BOW", rarity: 5 }),
  });

  assert.equal(code, 1);
  assert.match(stderr.join(""), /has no mapping/);
  assert.throws(() => readFileSync(paths.outPath, "utf8"), /ENOENT/);
});

test("an import that does not pin a commit is refused", async (context) => {
  const paths = fixture(context, { commit: "" });
  const { stderr, streams } = capture();

  assert.equal(await run(paths, streams), 1);
  assert.match(stderr.join(""), /must pin a commit/);
});

test("the command explains itself instead of guessing", async (context) => {
  const directory = workspace(context);
  const { stderr, streams } = capture();

  assert.equal(await main([], streams, { fetchRecord: fakeRecord }), 2);
  assert.match(stderr.join(""), /Usage:/);

  assert.equal(await main([join(directory, "p.json")], streams, { fetchRecord: fakeRecord }), 2);
  assert.match(stderr.join(""), /--base and --out are both required/);
});
