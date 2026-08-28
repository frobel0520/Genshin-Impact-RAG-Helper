import assert from "node:assert/strict";
import test from "node:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadFixtureSourcePack } from "../src/data/fixture-source-pack.js";
import { main } from "../scripts/ingest.js";

const fixturePack = loadFixtureSourcePack();

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
    runResponse: () => JSON.parse(stdout.join("")),
  };
}

function restoreEnvironment(name, value) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function datasetFile(context, dataset) {
  const directory = mkdtempSync(join(tmpdir(), "ingest-cli-"));
  context.after(() => rmSync(directory, { recursive: true, force: true }));
  const path = join(directory, "dataset.json");
  writeFileSync(path, JSON.stringify(dataset), "utf8");
  return path;
}

test("validate prints a passed RunResponse and exits zero", async (context) => {
  const output = capture();
  const path = datasetFile(context, fixturePack);

  const code = await main(["validate", path], output.streams);

  assert.equal(code, 0);
  const response = output.runResponse();
  assert.equal(response.status, "passed");
  assert.deepEqual(response.errors, []);
});

test("a rejected batch exits non-zero, so a failed ingest cannot look like a success", async (context) => {
  const output = capture();
  const broken = structuredClone(fixturePack);
  broken.source_documents[0].source_url = "not-a-url";
  const path = datasetFile(context, broken);

  const code = await main(["validate", path], output.streams);

  assert.equal(code, 1);
  const response = output.runResponse();
  assert.equal(response.status, "failed");
  assert.equal(response.errors[0].code, "invalid_request");
});

test("the build command targets the configured databases, never memory", async (context) => {
  const output = capture();
  const directory = mkdtempSync(join(tmpdir(), "ingest-cli-build-"));
  context.after(() => rmSync(directory, { recursive: true, force: true, maxRetries: 5 }));
  const path = datasetFile(context, fixturePack);
  const structuredDatabasePath = join(directory, "structured.db");
  const documentDatabasePath = join(directory, "index.db");

  const previous = {
    structured: process.env.STRUCTURED_DB_PATH,
    document: process.env.DOCUMENT_DB_PATH,
  };
  process.env.STRUCTURED_DB_PATH = structuredDatabasePath;
  process.env.DOCUMENT_DB_PATH = documentDatabasePath;
  context.after(() => {
    restoreEnvironment("STRUCTURED_DB_PATH", previous.structured);
    restoreEnvironment("DOCUMENT_DB_PATH", previous.document);
  });

  // Ollama is not running under the offline guard, so the index step fails —
  // but the structured store must still have been written to the configured
  // file rather than to an in-memory database that vanishes.
  const code = await main(["build", path], output.streams);
  const response = output.runResponse();

  assert.equal(code, 1);
  assert.equal(response.status, "partial");
  assert.deepEqual(
    response.artifacts.map((artifact) => artifact.path),
    [structuredDatabasePath],
  );
  assert.ok(existsSync(structuredDatabasePath));
  assert.equal(response.errors[0].code, "dependency_unavailable");
});

test("an unknown command prints the usage and exits with a distinct code", async () => {
  const output = capture();

  assert.equal(await main(["rebuild", "dataset.json"], output.streams), 2);
  assert.equal(await main(["validate"], output.streams), 2);
  assert.match(output.stderr.join(""), /Usage:/);
});
