#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createQueryServiceForStores } from "../src/api/query-api.js";
import { loadRuntimeConfig } from "../src/config/runtime-config.js";
import { createDocumentStore } from "../src/data/document-store.js";
import { createStructuredStore } from "../src/data/structured-store.js";
import { meetsAllTargets, runEvaluation } from "../src/evaluation/evaluation-runner.js";
import { summarizeLatency } from "../src/evaluation/latency-summary.js";
import { summarizeRepeatedRuns } from "../src/evaluation/repeated-run-summary.js";
import { createJsonLineLogger } from "../src/observability/run-log-adapter.js";

const USAGE = `Usage:
  node scripts/evaluate.js <eval-cases.json> [--report <path>] [--repeats 2..10]

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
export async function main(argv, streams = {}) {
  // Injected so a caller can read what the command printed without patching the
  // process's own streams, which the test runner also writes to.
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));
  const [casesPath, ...rest] = argv;
  if (casesPath === undefined) {
    err(`${USAGE}\n`);
    return 2;
  }
  const flags = parseFlags(rest);

  const config = loadRuntimeConfig(process.env);
  for (const path of [config.structuredDatabasePath, config.documentDatabasePath]) {
    if (!existsSync(resolve(path))) {
      err(`No dataset at ${path}. Run the ingest build first.\n`);
      return 1;
    }
  }

  const structuredStore = createStructuredStore({ databasePath: config.structuredDatabasePath });
  const documentStore = createDocumentStore({ databasePath: config.documentDatabasePath });

  try {
    const dataset = JSON.parse(readFileSync(resolve(casesPath), "utf8"));
    const cases = Array.isArray(dataset) ? dataset : dataset.cases;
    // Records go to stderr so stdout stays the run summary a caller can pipe.
    const logger = createJsonLineLogger({ write: (line) => err(line) });
    const service = createQueryServiceForStores({
      config,
      structuredStore,
      documentStore,
      logger,
    });
    const repeats = flags.repeats === undefined ? 3 : Number(flags.repeats);
    if (!Number.isInteger(repeats) || repeats < 2 || repeats > 10) {
      throw new TypeError("--repeats must be an integer from 2 to 10.");
    }
    const runs = [];
    for (let index = 0; index < repeats; index += 1) {
      const timings = [];
      let caseIndex = 0;
      const evaluation = await runEvaluation({
        cases,
        answer: async (request) => {
          const caseId = cases[caseIndex].case_id;
          caseIndex += 1;
          const started = performance.now();
          try {
            return await service.answer(request);
          } finally {
            timings.push({ case_id: caseId, duration_ms: Math.ceil(performance.now() - started) });
          }
        },
        logger,
        ...(flags.report === undefined ? {} : { reportPath: flags.report }),
      });
      runs.push({ ...evaluation, timings, latency: summarizeLatency(timings) });
    }
    const variability = summarizeRepeatedRuns(runs);

    if (flags.report !== undefined) {
      writeFileSync(
        resolve(flags.report),
        `${JSON.stringify({ variability, runs }, null, 2)}\n`,
        "utf8",
      );
    }
    out(`${JSON.stringify({
      variability,
      runs: runs.map(({ run, metrics, cases: caseSummary, latency }) => ({
        run, metrics, cases: caseSummary, latency,
      })),
    }, null, 2)}\n`);

    return runs.every(({ run, metrics, latency }) =>
      run.status === "passed" && meetsAllTargets(metrics) && latency.meets_target) ? 0 : 1;
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
