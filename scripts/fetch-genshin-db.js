#!/usr/bin/env node
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { factsFromGenshinDb } from "../src/ingest/genshin-db-mapping.js";

const USAGE = `Usage:
  node scripts/fetch-genshin-db.js <pointer.json> --base <facts.json> --out <path>

Reads the genshin-db records the pointer names, at the commit it pins, and
writes <base> with their facts and their source document appended.

The result is what make:pack takes as --merge. The repository stores the
pointer, never the records: see docs/05-source-licensing.md.

Exits non-zero when a record cannot be fetched or carries a value this project
has no mapping for.`;

const RAW_BASE = "https://raw.githubusercontent.com/theBowja/genshin-db";
const USER_AGENT =
  "Genshin-Impact-RAG-Helper/1.0 (personal non-commercial project; contact via repository)";

/**
 * Maintainer entry point for importing genshin-db facts.
 *
 * genshin-db is structured data, so it does not go through the chunk pipeline:
 * its fields become StructuredFacts beside the ones read out of announcements,
 * and the conflict policy decides between them when they disagree. That is the
 * point of importing it — a second source for the same field is what makes the
 * authority order in the plan's §5.2 mean anything.
 */
export async function main(argv, streams = {}, dependencies = {}) {
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));
  const fetchRecord = dependencies.fetchRecord ?? fetchFromGitHub;

  const [pointerPath, ...rest] = argv;
  if (pointerPath === undefined) {
    err(`${USAGE}\n`);
    return 2;
  }
  let flags;
  try {
    flags = parseFlags(rest);
  } catch (error) {
    err(`${error.message}\n`);
    return 2;
  }
  if (flags.base === undefined || flags.out === undefined) {
    err(`--base and --out are both required.\n\n${USAGE}\n`);
    return 2;
  }

  const pointer = readJson(pointerPath, err);
  const base = readJson(flags.base, err);
  if (pointer === undefined || base === undefined) {
    return 1;
  }
  if (!isStableString(pointer.commit)) {
    err(`${pointerPath} must pin a commit: genshin-db moves, and an import that ` +
      `does not say which revision it read cannot be reproduced.\n`);
    return 1;
  }
  if (!Array.isArray(pointer.entries) || pointer.entries.length === 0) {
    err(`${pointerPath} lists no entries.\n`);
    return 1;
  }

  const sourceId = pointer.source_id ?? "src:genshin-db";
  const facts = [];
  const failures = [];
  for (const entry of pointer.entries) {
    try {
      const record = await fetchRecord({ commit: pointer.commit, ...entry });
      const result = factsFromGenshinDb({
        entityId: entry.entity_id,
        entityType: entry.entity_type,
        record,
        sourceId,
      });
      facts.push(...result.facts);
    } catch (error) {
      failures.push(`${entry.entity_id ?? entry.file}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    err(`${failures.length} entr(ies) could not be imported, so nothing was written:\n`);
    for (const failure of failures) {
      err(`  ${failure}\n`);
    }
    return 1;
  }

  const merged = {
    ...base,
    source_documents: [
      ...(base.source_documents ?? []),
      sourceDocument(pointer, sourceId, facts),
    ],
    structured_facts: [...(base.structured_facts ?? []), ...facts],
  };
  writeJson(flags.out, merged);

  out(`${facts.length} facts from ${pointer.entries.length} genshin-db records -> ${flags.out}\n`);
  out(`  commit ${pointer.commit.slice(0, 12)}\n`);
  return 0;
}

/**
 * The source document a genshin-db fact cites.
 *
 * It points at the pinned tree rather than the project's front page, because a
 * citation has to lead a reader to the data the answer was built from, and
 * genshin-db's main branch will not be showing that data for long.
 */
function sourceDocument(pointer, sourceId, facts) {
  return {
    source_id: sourceId,
    source_kind: "genshin-db",
    source_url: `https://github.com/theBowja/genshin-db/tree/${pointer.commit}`,
    title: `genshin-db @ ${pointer.commit.slice(0, 12)}`,
    retrieved_at: pointer.retrieved_at,
    locale: pointer.locale ?? "zh-TW",
    rights_note:
      "genshin-db package code is MIT (theBowja); the game data it carries is not — " +
      "HoYoverse retains it. Cite by URL, do not redistribute the data.",
    // The commit is a SHA-1 and the contract wants a SHA-256, but the point of
    // the field is the same either way: a fingerprint of what this document
    // actually carried. Hashing the facts covers the commit *and* the mapping —
    // re-pinning to a revision whose values are identical is not a change, and
    // a mapping fix that alters a value is.
    content_hash: createHash("sha-256")
      .update(
        [pointer.commit, ...facts.map((entry) => `${entry.fact_id}=${entry.value}`)].join("\n"),
        "utf8",
      )
      .digest("hex"),
  };
}

async function fetchFromGitHub({ commit, collection, file }) {
  if (!isStableString(collection) || !isStableString(file)) {
    throw new Error("entry needs a collection and a file.");
  }
  const url = `${RAW_BASE}/${commit}/src/data/ChineseTraditional/${collection}/${file}.json`;
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`genshin-db returned HTTP ${response.status} for ${collection}/${file}.`);
  }
  return response.json();
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag !== "--base" && flag !== "--out") {
      throw new Error(`Unknown option ${flag}\n\n${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`${flag} needs a path\n\n${USAGE}`);
    }
    flags[flag.slice(2)] = value;
    index += 1;
  }
  return flags;
}

function readJson(path, err) {
  const resolved = resolve(path);
  if (!existsSync(resolved)) {
    err(`No file at ${path}.\n`);
    return undefined;
  }
  try {
    return JSON.parse(readFileSync(resolved, "utf8"));
  } catch (error) {
    err(`${path} is not valid JSON: ${error.message}\n`);
    return undefined;
  }
}

function writeJson(path, value) {
  writeFileSync(resolve(path), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function isStableString(value) {
  return typeof value === "string" && value.trim() !== "";
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
