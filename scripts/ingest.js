#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadRuntimeConfig } from "../src/config/runtime-config.js";
import { createDocumentStore } from "../src/data/document-store.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { runIngestBuild, runIngestValidate } from "../src/ingest/ingest-pipeline.js";
import { createOllamaEmbedder } from "../src/ingest/ollama-embedder.js";

const USAGE = `Usage:
  node scripts/ingest.js validate <dataset.json>
  node scripts/ingest.js build <dataset.json> [--structured-db <path>] [--index-db <path>]

Through npm, pass arguments after a double dash so npm does not consume the
flags itself:
  npm run ingest:build -- <dataset.json> --structured-db <path>

Without flags the build writes to STRUCTURED_DB_PATH and DOCUMENT_DB_PATH, the
same databases the server reads. It embeds every chunk with the fixed bge-m3
baseline through the configured Ollama host, so it needs Ollama running.`;

/**
 * Maintainer entry point. It prints one RunResponse as JSON and exits non-zero
 * unless the run passed, so a failed ingest can never look like a success to a
 * shell script or to CI.
 */
export async function main(argv, streams = {}) {
  // The streams are injected so a test can read what the command printed
  // without patching the process's own stdout, which the test runner also uses.
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));
  const [command, datasetPath, ...rest] = argv;

  if (command !== "validate" && command !== "build") {
    err(`${USAGE}\n`);
    return 2;
  }
  if (datasetPath === undefined) {
    err(`${USAGE}\n`);
    return 2;
  }

  const dataset = JSON.parse(readFileSync(resolve(datasetPath), "utf8"));
  const response =
    command === "validate"
      ? runIngestValidate({ dataset })
      : await build(dataset, parseFlags(rest));

  out(`${JSON.stringify(response, null, 2)}\n`);
  return response.status === "passed" ? 0 : 1;
}

async function build(dataset, flags) {
  const config = loadRuntimeConfig(process.env);
  // Defaulting to an in-memory database would let a build report success while
  // persisting nothing, so the default is the dataset the server actually reads.
  const structuredStorePath = flags["structured-db"] ?? config.structuredDatabasePath;
  const documentStorePath = flags["index-db"] ?? config.documentDatabasePath;
  const structuredStore = createStructuredStore({ databasePath: structuredStorePath });
  const documentStore = createDocumentStore({ databasePath: documentStorePath });

  try {
    const embedder = createOllamaEmbedder({
      host: config.ollamaHost,
      model: config.embeddingModel,
    });
    return await runIngestBuild({
      dataset,
      structuredStore,
      documentStore,
      embedDocuments: embedder.embedDocuments,
      structuredStorePath,
      documentStorePath,
    });
  } finally {
    structuredStore.close();
    documentStore.close();
  }
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new TypeError(`Unexpected argument: ${token}.`);
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`${token} needs a value.`);
    }
    flags[token.slice(2)] = value;
    index += 1;
  }
  return flags;
}

const entryPath = process.argv[1];
const isEntrypoint =
  entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href;

if (isEntrypoint) {
  main(process.argv.slice(2)).then(
    (code) => {
      process.exitCode = code;
    },
    (error) => {
      process.stderr.write(`${error.message}\n`);
      process.exitCode = 1;
    },
  );
}
