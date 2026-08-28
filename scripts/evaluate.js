#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createQueryServiceForStores } from "../src/api/query-api.js";
import { loadRuntimeConfig } from "../src/config/runtime-config.js";
import { createDocumentStore } from "../src/data/document-store.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { meetsAllTargets, runEvaluation } from "../src/evaluation/evaluation-runner.js";

const USAGE = `Usage:
  node scripts/evaluate.js <eval-cases.json> [--report <path>]

Runs every EvalCase through the same query service the API serves, using the
databases named by STRUCTURED_DB_PATH and DOCUMENT_DB_PATH. Exits non-zero when
the run failed or a scored metric missed its target.`;

/**
 * Maintainer entry point for the evaluation runner.
 *
 * The run result and the metric targets are reported separately: a run that
 * executed cleanly still exits non-zero when a target was missed, because a
 * regression the numbers show must not pass as a green command.
 */
export async function main(argv) {
  const [casesPath, ...rest] = argv;
  if (casesPath === undefined) {
    process.stderr.write(`${USAGE}\n`);
    return 2;
  }
  const flags = parseFlags(rest);

  const config = loadRuntimeConfig(process.env);
  for (const path of [config.structuredDatabasePath, config.documentDatabasePath]) {
    if (!existsSync(resolve(path))) {
      process.stderr.write(`No dataset at ${path}. Run the ingest build first.\n`);
      return 1;
    }
  }

  const structuredStore = createStructuredStore({ databasePath: config.structuredDatabasePath });
  const documentStore = createDocumentStore({ databasePath: config.documentDatabasePath });

  try {
    const dataset = JSON.parse(readFileSync(resolve(casesPath), "utf8"));
    const cases = Array.isArray(dataset) ? dataset : dataset.cases;
    const service = createQueryServiceForStores({ config, structuredStore, documentStore });
    const { run, results, metrics } = await runEvaluation({
      cases,
      answer: service.answer,
      ...(flags.report === undefined ? {} : { reportPath: flags.report }),
    });

    if (flags.report !== undefined) {
      writeFileSync(
        resolve(flags.report),
        `${JSON.stringify({ run, metrics, results }, null, 2)}\n`,
        "utf8",
      );
    }
    process.stdout.write(`${JSON.stringify({ run, metrics }, null, 2)}\n`);

    return run.status === "passed" && meetsAllTargets(metrics) ? 0 : 1;
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
