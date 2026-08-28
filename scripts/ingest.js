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
  node scripts/ingest.js build <dataset.json> --structured-db <path> --index-db <path>

The build command embeds every chunk with the fixed bge-m3 baseline through the
Ollama host from the environment, so it needs Ollama running.`;

/**
 * Maintainer entry point. It prints one RunResponse as JSON and exits non-zero
 * unless the run passed, so a failed ingest can never look like a success to a
 * shell script or to CI.
 */
export async function main(argv) {
  const [command, datasetPath, ...rest] = argv;

  if (command !== "validate" && command !== "build") {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  if (datasetPath === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }

  const dataset = JSON.parse(readFileSync(resolve(datasetPath), "utf8"));
  const response =
    command === "validate"
      ? runIngestValidate({ dataset })
      : await build(dataset, parseFlags(rest));

  process.stdout.write(`${JSON.stringify(response, null, 2)}\n`);
  return response.status === "passed" ? 0 : 1;
}

async function build(dataset, flags) {
  const config = loadRuntimeConfig(process.env);
  const structuredStorePath = flags["structured-db"] ?? ":memory:";
  const documentStorePath = flags["index-db"] ?? ":memory:";
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
