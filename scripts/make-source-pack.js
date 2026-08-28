#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SOURCE_KINDS, createDomainId, isDomainId } from "../src/domain/domain-contract.js";
import {
  FIXTURE_SOURCE_PACK_SCHEMA_VERSION,
  validateFixtureSourcePack,
} from "../src/data/fixture-source-pack.js";

const USAGE = `Usage:
  node scripts/make-source-pack.js <article.json|directory> [...] [--out <pack.json>]
                                   [--merge <pack.json>] [--retrieved-at <iso>]
                                   [--max-chunk-chars <n>]

Turns hand-written article files into a dataset the ingest CLI accepts. A
directory contributes every *.json inside it except names starting with "_",
so a template can live beside the real articles.

--merge keeps the entity, fact, claim, and conflict collections of an existing
pack and appends the new documents to it, which is how a second batch is added
without retyping the first. Without --out the pack is printed to stdout.

Article file (only source_kind, source_url, title and the text are required):
  {
    "key": "hoyolab-version-5-0",
    "source_kind": "hoyolab",
    "source_url": "https://www.hoyolab.com/article/32456789",
    "title": "5.0 update notes",
    "published_at": "2024-08-28T07:00:00+08:00",
    "game_version": "5.0",
    "sections": [
      { "id": "character-updates", "text": "..." }
    ]
  }

"body" may replace "sections": blank-line paragraphs are then packed into
chunks of at most --max-chunk-chars characters (default 480).`;

const DEFAULT_LOCALE = "zh-TW";
const DEFAULT_MAX_CHUNK_CHARS = 480;
const GAME_VERSION_UNKNOWN = "unknown";

// A hand-copied article carries no licence metadata, so the rights note is
// stated once per source kind here instead of being retyped — and eventually
// mistyped — in every file. An article may still override it.
const DEFAULT_RIGHTS_NOTES = Object.freeze({
  [SOURCE_KINDS.HOYOLAB]:
    "Personal non-commercial use; retain official attribution and URL; terms review pending.",
  [SOURCE_KINDS.GENSHIN_DB]:
    "genshin-db package data; game data owned by HoYoverse; retain package attribution and URL.",
  [SOURCE_KINDS.FANDOM]:
    "Fandom wiki text under CC BY-SA 3.0; retain page URL and author attribution; derivative text shares alike.",
});

const ARTICLE_FIELDS = new Set([
  "key",
  "source_id",
  "source_kind",
  "source_url",
  "title",
  "published_at",
  "retrieved_at",
  "game_version",
  "locale",
  "rights_note",
  "sections",
  "body",
]);
const SECTION_FIELDS = new Set(["id", "locator", "text", "game_version", "entity_ids"]);

const EMPTY_PACK = Object.freeze({
  source_documents: [],
  canonical_entities: [],
  structured_facts: [],
  claims: [],
  conflict_groups: [],
  document_chunks: [],
});

/**
 * Maintainer entry point. It writes nothing unless the assembled pack passes
 * the same contract the ingest CLI enforces, so a half-typed article is caught
 * here instead of after it reached a dataset file.
 *
 * @param {string[]} argv
 * @param {{ stdout?: Function, stderr?: Function }} streams
 * @returns {number} the process exit code
 */
export function main(argv, streams = {}) {
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));

  let inputs;
  let flags;
  try {
    ({ inputs, flags } = parseArguments(argv));
  } catch (error) {
    err(`${error.message}\n\n${USAGE}\n`);
    return 2;
  }

  if (inputs.length === 0) {
    err(`${USAGE}\n`);
    return 2;
  }

  let pack;
  try {
    pack = buildSourcePack({
      articles: inputs.flatMap(readArticles),
      basePack: flags.merge === undefined ? undefined : readJson(flags.merge),
      retrievedAt: flags["retrieved-at"],
      maxChunkChars:
        flags["max-chunk-chars"] === undefined ? undefined : Number(flags["max-chunk-chars"]),
    });
  } catch (error) {
    err(`${error.message}\n`);
    return 1;
  }

  const result = validateFixtureSourcePack(pack);
  if (!result.ok) {
    err("The assembled pack does not satisfy the dataset contract:\n");
    for (const error of result.errors) {
      err(`  ${error.field}: ${error.message}\n`);
    }
    return 1;
  }

  const serialized = `${JSON.stringify(pack, null, 2)}\n`;
  if (flags.out === undefined) {
    out(serialized);
    return 0;
  }

  writeFileSync(resolve(flags.out), serialized, "utf8");
  out(
    `${pack.source_documents.length} documents, ${pack.document_chunks.length} chunks -> ${flags.out}\n`,
  );
  return 0;
}

/**
 * Assemble a dataset from articles, optionally appending to an existing pack.
 *
 * @param {{
 *   articles: object[],
 *   basePack?: object,
 *   retrievedAt?: string,
 *   maxChunkChars?: number,
 * }} request
 * @returns {object} a fixture source pack
 */
export function buildSourcePack(request) {
  const { articles, basePack, retrievedAt, maxChunkChars = DEFAULT_MAX_CHUNK_CHARS } = request;

  if (!Number.isInteger(maxChunkChars) || maxChunkChars < 1) {
    throw new TypeError("--max-chunk-chars must be a positive integer.");
  }

  const base = basePack ?? EMPTY_PACK;
  const pack = {
    schema_version: FIXTURE_SOURCE_PACK_SCHEMA_VERSION,
    source_documents: [...(base.source_documents ?? [])],
    canonical_entities: [...(base.canonical_entities ?? [])],
    structured_facts: [...(base.structured_facts ?? [])],
    claims: [...(base.claims ?? [])],
    conflict_groups: [...(base.conflict_groups ?? [])],
    document_chunks: [...(base.document_chunks ?? [])],
  };
  if (base.test_scenarios !== undefined) {
    pack.test_scenarios = base.test_scenarios;
  }

  const sourceIds = new Set(pack.source_documents.map((document) => document.source_id));
  const chunkIds = new Set(pack.document_chunks.map((chunk) => chunk.chunk_id));
  const stamp = retrievedAt ?? new Date().toISOString();

  for (const article of articles) {
    const { document, chunks } = convertArticle(article, stamp, maxChunkChars);

    if (sourceIds.has(document.source_id)) {
      throw new TypeError(`Duplicate source_id across articles: ${document.source_id}.`);
    }
    sourceIds.add(document.source_id);

    for (const chunk of chunks) {
      if (chunkIds.has(chunk.chunk_id)) {
        throw new TypeError(`Duplicate chunk_id across articles: ${chunk.chunk_id}.`);
      }
      chunkIds.add(chunk.chunk_id);
    }

    pack.source_documents.push(document);
    pack.document_chunks.push(...chunks);
  }

  return pack;
}

function convertArticle(article, stamp, maxChunkChars) {
  if (article === null || typeof article !== "object" || Array.isArray(article)) {
    throw new TypeError("An article file must contain a JSON object.");
  }

  const label = article.title ?? article.key ?? article.source_id ?? "<untitled article>";
  const reject = (message) => {
    throw new TypeError(`${label}: ${message}`);
  };

  for (const field of Object.keys(article)) {
    if (!ARTICLE_FIELDS.has(field)) {
      reject(`unknown article field: ${field}.`);
    }
  }
  for (const field of ["source_kind", "source_url", "title"]) {
    if (!isFilledString(article[field])) {
      reject(`${field} is required.`);
    }
  }
  if (!Object.values(SOURCE_KINDS).includes(article.source_kind)) {
    reject(`source_kind must be one of ${Object.values(SOURCE_KINDS).join(", ")}.`);
  }
  if (article.sections !== undefined && article.body !== undefined) {
    reject("an article carries either sections or body, not both.");
  }

  const sourceId = resolveSourceId(article, reject);
  const gameVersion = isFilledString(article.game_version)
    ? article.game_version.trim()
    : GAME_VERSION_UNKNOWN;
  const sections = resolveSections(article, maxChunkChars, reject);
  const sourceKey = sourceId.slice(sourceId.indexOf(":") + 1);

  const chunks = sections.map((section, index) => {
    const sectionId = isFilledString(section.id) ? section.id.trim() : `p${index + 1}`;
    return {
      chunk_id: createDomainId("chunk", `${sourceKey}-${sectionId}`),
      source_id: sourceId,
      document_locator: isFilledString(section.locator)
        ? section.locator.trim()
        : `${article.source_url.trim()}#${sectionId}`,
      text: section.text.trim(),
      token_hint: estimateTokens(section.text),
      game_version: isFilledString(section.game_version)
        ? section.game_version.trim()
        : gameVersion,
      entity_ids: section.entity_ids ?? [],
    };
  });

  const document = {
    source_id: sourceId,
    source_kind: article.source_kind,
    source_url: article.source_url.trim(),
    title: article.title.trim(),
    retrieved_at: isFilledString(article.retrieved_at) ? article.retrieved_at.trim() : stamp,
    locale: isFilledString(article.locale) ? article.locale.trim() : DEFAULT_LOCALE,
    rights_note: isFilledString(article.rights_note)
      ? article.rights_note.trim()
      : DEFAULT_RIGHTS_NOTES[article.source_kind],
    // The hash covers the text this pack actually carries, so re-copying an
    // article that changed upstream yields a different document instead of
    // silently reusing the identity of the old one.
    content_hash: hashContent(sourceId, article.title, chunks),
  };
  if (isFilledString(article.published_at)) {
    document.published_at = article.published_at.trim();
  }
  if (gameVersion !== GAME_VERSION_UNKNOWN) {
    document.game_version = gameVersion;
  }

  return { document, chunks };
}

function hashContent(sourceId, title, chunks) {
  const canonical = [sourceId, title.trim(), ...chunks.map((chunk) => chunk.text)].join("\n\n");
  return createHash("sha-256").update(canonical, "utf8").digest("hex");
}

function resolveSourceId(article, reject) {
  if (article.source_id !== undefined) {
    if (!isDomainId(article.source_id, "source")) {
      reject("source_id must be a typed source domain ID (src:<key>).");
    }
    return article.source_id;
  }
  if (!isFilledString(article.key)) {
    reject("either key or source_id is required.");
  }
  return createDomainId("source", article.key);
}

function resolveSections(article, maxChunkChars, reject) {
  if (article.sections !== undefined) {
    if (!Array.isArray(article.sections) || article.sections.length === 0) {
      reject("sections must be a non-empty array.");
    }
    for (const [index, section] of article.sections.entries()) {
      if (section === null || typeof section !== "object" || Array.isArray(section)) {
        reject(`sections[${index}] must be an object.`);
      }
      for (const field of Object.keys(section)) {
        if (!SECTION_FIELDS.has(field)) {
          reject(`unknown sections[${index}] field: ${field}.`);
        }
      }
      if (!isFilledString(section.text)) {
        reject(`sections[${index}].text is required.`);
      }
    }
    return article.sections;
  }

  if (!isFilledString(article.body)) {
    reject("either sections or body is required.");
  }
  return packParagraphs(article.body, maxChunkChars).map((text) => ({ text }));
}

/**
 * Pack blank-line paragraphs into chunks no longer than the budget. A single
 * paragraph over the budget is kept whole: splitting Chinese prose mid-sentence
 * would hand the retriever a fragment no reader could cite.
 *
 * @param {string} body
 * @param {number} maxChunkChars
 * @returns {string[]}
 */
export function packParagraphs(body, maxChunkChars) {
  const paragraphs = body
    .split(/\r?\n\s*\r?\n/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const chunks = [];
  let current = "";
  for (const paragraph of paragraphs) {
    if (current === "") {
      current = paragraph;
    } else if (current.length + paragraph.length + 2 <= maxChunkChars) {
      current = `${current}\n\n${paragraph}`;
    } else {
      chunks.push(current);
      current = paragraph;
    }
  }
  if (current !== "") {
    chunks.push(current);
  }
  return chunks;
}

/**
 * Estimate tokens for mixed Traditional Chinese and Latin text: one CJK
 * character is about one token, four Latin characters about one. The value is
 * a hint for the chunk budget, never an exact count.
 *
 * @param {string} text
 * @returns {number}
 */
export function estimateTokens(text) {
  const trimmed = text.trim();
  const cjk = (
    trimmed.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/gu) ?? []
  ).length;
  return cjk + Math.ceil((trimmed.length - cjk) / 4);
}

function readArticles(inputPath) {
  const path = resolve(inputPath);
  if (!statSync(path).isDirectory()) {
    return [readJson(path)];
  }
  return readdirSync(path)
    .filter((name) => extname(name) === ".json" && !basename(name).startsWith("_"))
    .sort()
    .map((name) => readJson(join(path, name)));
}

function readJson(inputPath) {
  const path = resolve(inputPath);
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new TypeError(`${inputPath}: ${error.message}`);
  }
}

function parseArguments(argv) {
  const inputs = [];
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      inputs.push(token);
      continue;
    }
    const value = argv[index + 1];
    if (value === undefined || value.startsWith("--")) {
      throw new TypeError(`${token} needs a value.`);
    }
    flags[token.slice(2)] = value;
    index += 1;
  }
  return { inputs, flags };
}

function isFilledString(value) {
  return typeof value === "string" && value.trim() !== "";
}

const entryPath = process.argv[1];
const isEntrypoint =
  entryPath !== undefined && import.meta.url === pathToFileURL(resolve(entryPath)).href;

if (isEntrypoint) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  }
}
