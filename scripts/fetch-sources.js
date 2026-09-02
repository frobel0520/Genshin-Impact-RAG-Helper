#!/usr/bin/env node
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { extractSections, htmlToPlainText } from "../src/ingest/source-locator.js";

const USAGE = `Usage:
  node scripts/fetch-sources.js <sources-dir> [--out <dir>]

Fetches the articles the source files point at and writes them, section by
section, to <dir> (default artifacts/sources) for make:pack to read.

The repository stores pointers, not source text: see docs/05-source-licensing.md.
The output directory is git-ignored, so the text lives only on the machine that
fetched it.

Exits non-zero when an article cannot be fetched, a locator no longer matches,
or a section's text no longer hashes to what the source file recorded.`;

const DEFAULT_OUT_DIR = "artifacts/sources";
const USER_AGENT =
  "Genshin-Impact-RAG-Helper/1.0 (personal non-commercial project; contact via repository)";

/**
 * Maintainer entry point for turning source pointers into local text.
 *
 * `fetchArticle` is injected so the whole pipeline can be tested without a
 * network: the offline guard in CI would refuse a live request, and a fetcher
 * that only works against the real site is one nobody can test a change to.
 */
export async function main(argv, streams = {}, dependencies = {}) {
  const out = streams.stdout ?? ((text) => process.stdout.write(text));
  const err = streams.stderr ?? ((text) => process.stderr.write(text));
  const fetchArticle = dependencies.fetchArticle ?? fetchBySourceKind;

  const [sourcesDir, ...rest] = argv;
  if (sourcesDir === undefined) {
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
  const outDir = flags.out ?? DEFAULT_OUT_DIR;

  let files;
  try {
    files = listSourceFiles(sourcesDir);
  } catch (error) {
    err(`${error.message}\n`);
    return 1;
  }
  if (files.length === 0) {
    err(`No source files in ${sourcesDir}.\n`);
    return 1;
  }

  mkdirSync(resolve(outDir), { recursive: true });

  const failures = [];
  let written = 0;
  for (const file of files) {
    try {
      const article = readJson(file);
      // A file that still carries its own text predates the pointer format.
      // Rewriting it silently would hide which text the index was built from.
      if (Array.isArray(article.sections) && article.sections.some((s) => s.text !== undefined)) {
        throw new Error(
          "carries section text. The repository stores pointers now: replace each " +
            "section's text with a locator (see sources/README.md).",
        );
      }
      const fetched = await fetchArticle(article);
      const plain = htmlToPlainText(fetched.html);
      const sections = extractSections(plain, article.sections);
      verifyHashes(article, sections);

      const output = {
        ...stripFetchFields(article),
        ...(article.title === undefined && fetched.title !== undefined
          ? { title: fetched.title }
          : {}),
        sections: article.sections.map((section, index) => ({
          id: section.id,
          text: sections[index].text,
          ...(section.entity_ids === undefined ? {} : { entity_ids: section.entity_ids }),
        })),
      };
      writeFileSync(
        join(resolve(outDir), basenameOf(file)),
        `${JSON.stringify(output, null, 2)}\n`,
        "utf8",
      );
      written += 1;
      out(
        `${basenameOf(file)}: ${sections.length} sections, ` +
          `${sections.reduce((total, section) => total + section.text.length, 0)} characters\n`,
      );
    } catch (error) {
      // An earlier run's output for this source must not survive a failed one.
      // Left in place it is text the current pointer no longer describes, and
      // make:pack would happily build a dataset from it — the exact outcome the
      // hash check exists to prevent, reached by ignoring one exit code.
      rmSync(join(resolve(outDir), basenameOf(file)), { force: true });
      failures.push(`${basenameOf(file)}: ${error.message}`);
    }
  }

  if (failures.length > 0) {
    err(`\n${failures.length} source(s) could not be fetched:\n`);
    for (const failure of failures) {
      err(`  ${failure}\n`);
    }
    // The sources that succeeded are on disk and named above; the ones that
    // failed have no output at all, so a partial run cannot be packed as if it
    // were a whole one.
    err(`${written} of ${files.length} written to ${outDir}. `);
    err("The failed sources have no output: fix the pointers and run again.\n");
    return 1;
  }

  out(`\n${written} source(s) written to ${outDir}\n`);
  return 0;
}

const FETCHERS = Object.freeze({
  hoyolab: fetchHoyolabArticle,
  fandom: fetchFandomPage,
});

/**
 * Pick the fetcher a source file's kind needs.
 *
 * Each source is a different site with a different way of handing over its
 * text; `source_kind` already decides authority and rights elsewhere, so it
 * decides this too rather than a second field that could disagree with it.
 */
function fetchBySourceKind(article) {
  const fetcher = FETCHERS[article.source_kind];
  if (fetcher === undefined) {
    throw new Error(
      `source_kind ${JSON.stringify(article.source_kind)} has no fetcher. ` +
        `Known kinds: ${Object.keys(FETCHERS).join(", ")}.`,
    );
  }
  return fetcher(article);
}

/**
 * Fetch one Fandom wiki page.
 *
 * `prop=extracts` returns nothing here — Fandom does not install TextExtracts —
 * so the text comes from the rendered HTML, which `htmlToPlainText` reduces to
 * the same shape a HoYoLAB announcement arrives in. The revision ID is pinned
 * alongside the content hash: a wiki page changes whenever anyone edits it, and
 * the revision says *the page changed* where the hash only says the text this
 * pointer extracts came out different.
 */
async function fetchFandomPage(article) {
  const { origin, title } = fandomPage(article.source_url);
  const url =
    `${origin}/api.php?action=parse&page=${encodeURIComponent(title)}` +
    "&prop=text%7Crevid&format=json";
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Fandom returned HTTP ${response.status} for ${title}.`);
  }
  const payload = await response.json();
  if (payload.error !== undefined) {
    throw new Error(`Fandom returned ${payload.error.code} for ${title}.`);
  }
  const html = payload.parse?.text?.["*"];
  if (typeof html !== "string" || html.trim() === "") {
    throw new Error(`Fandom page ${title} carries no rendered text.`);
  }
  // A page that exists is not the same as a page worth citing: a disambiguation
  // page fetches cleanly, hashes stably, and would reach the index as evidence
  // for the entity whose name it carries. 雷電將軍 on the zh wiki is one.
  if (isDisambiguation(htmlToPlainText(html))) {
    throw new Error(
      `Fandom page ${title} is a disambiguation page, not an article. ` +
        "Point at the article it lists instead.",
    );
  }
  if (article.revision_id !== undefined && payload.parse.revid !== article.revision_id) {
    throw new Error(
      `Fandom page ${title} is at revision ${payload.parse.revid}, not the recorded ` +
        `${article.revision_id}. Someone edited it. Review the difference, then update ` +
        "the revision and the hashes deliberately.",
    );
  }
  return { html, revisionId: payload.parse.revid };
}

export function isDisambiguation(plainText) {
  return /這是一個消歧義頁|消歧義頁面|disambiguation page/.test(plainText);
}

function fandomPage(sourceUrl) {
  const match = /^(https:\/\/[^/]+(?:\/[a-z-]{2,5})?)\/wiki\/(.+)$/.exec(String(sourceUrl ?? ""));
  if (match === null) {
    throw new Error(`source_url ${sourceUrl} is not a Fandom wiki page URL.`);
  }
  return { origin: match[1], title: decodeURIComponent(match[2]) };
}

/**
 * Fetch one HoYoLAB announcement.
 *
 * The article page is a shell that renders its content with JavaScript, so the
 * text comes from the public post API the page itself calls. The language
 * header is what makes it the zh-TW article rather than the English one.
 */
async function fetchHoyolabArticle(article) {
  const postId = hoyolabPostId(article.source_url);
  const url = `https://bbs-api-os.hoyolab.com/community/post/wapi/getPostFull?post_id=${postId}`;
  const response = await fetch(url, {
    headers: {
      "user-agent": USER_AGENT,
      "x-rpc-language": article.locale === undefined ? "zh-tw" : article.locale.toLowerCase(),
    },
  });
  if (!response.ok) {
    throw new Error(`HoYoLAB returned HTTP ${response.status} for post ${postId}.`);
  }
  const payload = await response.json();
  if (payload.retcode !== 0) {
    throw new Error(`HoYoLAB returned retcode ${payload.retcode}: ${payload.message}.`);
  }
  const post = payload.data?.post?.post;
  if (typeof post?.content !== "string" || post.content.trim() === "") {
    throw new Error(`HoYoLAB post ${postId} carries no content.`);
  }
  return { html: post.content, title: post.subject };
}

function hoyolabPostId(sourceUrl) {
  const match = /\/article\/(\d+)/.exec(String(sourceUrl ?? ""));
  if (match === null) {
    throw new Error(`source_url ${sourceUrl} is not a HoYoLAB article URL.`);
  }
  return match[1];
}

/**
 * A section's recorded hash is what makes a fetch reproducible: the same
 * pointer must produce the same text, or the article changed and the dataset
 * built from it is no longer the dataset the release gate measured.
 */
function verifyHashes(article, sections) {
  const mismatched = [];
  for (const [index, section] of article.sections.entries()) {
    if (section.content_hash === undefined) {
      continue;
    }
    const actual = hashText(sections[index].text);
    if (actual !== section.content_hash) {
      mismatched.push(`${section.id} (recorded ${section.content_hash.slice(0, 12)}, got ${actual.slice(0, 12)})`);
    }
  }
  if (mismatched.length > 0) {
    throw new Error(
      `section text no longer matches its recorded hash: ${mismatched.join("; ")}. ` +
        "The article changed upstream. Review the difference, then update the hash deliberately.",
    );
  }
}

export function hashText(text) {
  return createHash("sha-256").update(text, "utf8").digest("hex");
}

function stripFetchFields(article) {
  // `sections` is replaced with extracted text, and `revision_id` is a pointer's
  // own bookkeeping — make:pack rejects article fields it does not know, and it
  // has no reason to know this one.
  const { sections, revision_id: revisionId, ...rest } = article;
  return rest;
}

function listSourceFiles(directory) {
  const resolved = resolve(directory);
  if (!existsSync(resolved)) {
    throw new Error(`No directory at ${directory}.`);
  }
  return readdirSync(resolved)
    .filter((name) => extname(name) === ".json" && !name.startsWith("_"))
    .sort()
    .map((name) => join(resolved, name));
}

function basenameOf(file) {
  return file.slice(Math.max(file.lastIndexOf("/"), file.lastIndexOf("\\")) + 1);
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function parseFlags(argv) {
  const flags = {};
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== "--out") {
      throw new Error(`Unknown option ${argv[index]}\n\n${USAGE}`);
    }
    const value = argv[index + 1];
    if (value === undefined) {
      throw new Error(`--out needs a path\n\n${USAGE}`);
    }
    flags.out = value;
    index += 1;
  }
  return flags;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = await main(process.argv.slice(2));
}
