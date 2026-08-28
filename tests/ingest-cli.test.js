import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { main } from "../scripts/ingest.js";

const fixturePack = loadFixtureSourcePack();

function capture(context) {
  const stdout = [];
  const stderr = [];
  const originalOut = process.stdout.write.bind(process.stdout);
  const originalErr = process.stderr.write.bind(process.stderr);
  process.stdout.write = (chunk) => stdout.push(String(chunk));
  process.stderr.write = (chunk) => stderr.push(String(chunk));
  context.after(() => {
    process.stdout.write = originalOut;
    process.stderr.write = originalErr;
  });
  return { stdout, stderr };
}

function datasetFile(context, dataset) {
  const directory = mkdtempSync(join(tmpdir(), "ingest-cli-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "dataset.json");
  writeFileSync(path, JSON.stringify(dataset), "utf8");
  return path;
}

test("validate prints a passed RunResponse and exits zero", async (context) => {
  const { stdout } = capture(context);
  const path = datasetFile(context, fixturePack);

  const code = await main(["validate", path]);

  assert.equal(code, 0);
  const response = JSON.parse(stdout.join(""));
  assert.equal(response.status, "passed");
  assert.deepEqual(response.errors, []);
});

test("a rejected batch exits non-zero, so a failed ingest cannot look like a success", async (context) => {
  const { stdout } = capture(context);
  const broken = structuredClone(fixturePack);
  broken.source_documents[0].source_url = "not-a-url";
  const path = datasetFile(context, broken);

  const code = await main(["validate", path]);

  assert.equal(code, 1);
  const response = JSON.parse(stdout.join(""));
  assert.equal(response.status, "failed");
  assert.equal(response.errors[0].code, "invalid_request");
});

test("an unknown command prints the usage and exits with a distinct code", async (context) => {
  const { stderr } = capture(context);

  assert.equal(await main(["rebuild", "dataset.json"]), 2);
  assert.equal(await main(["validate"]), 2);
  assert.match(stderr.join(""), /Usage:/);
});
