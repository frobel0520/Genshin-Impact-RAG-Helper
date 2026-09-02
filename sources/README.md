# Source pointers

One JSON file per article. **A file names an article and the markers that bound
each section; it does not contain the article's text.** The text is fetched onto
your machine, into a git-ignored directory, and the pack is built from there —
see [`../docs/05-source-licensing.md`](../docs/05-source-licensing.md) for why.

Files whose name starts with `_` are skipped, so `_template.json` and
`_facts.json` can sit next to the real articles.

```powershell
Copy-Item sources\_template.json sources\hoyolab-5-0.json
npm run fetch:sources -- sources
npm run make:pack -- artifacts\sources --merge sources\_facts.json --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
```

`fetch:sources` writes to `artifacts/sources/` by default. That directory is
git-ignored: the source text lives only on the machine that fetched it.

Pin `retrieved_at` in every article you keep. Without it the converter stamps
the current time, so the same sources produce a different `dataset_version` on
every run and a release gate can never be reproduced.

## Locators

Each section carries a `locator` instead of text:

```json
{
  "id": "new-region-natlan",
  "locator": { "start": "一、全新地區", "end": "二、全新敵人" },
  "content_hash": "…",
  "entity_ids": ["ent:natlan"]
}
```

- `start` is included in the section and must appear **exactly once** in the
  article. An ambiguous marker is refused rather than resolved by guessing.
- `end` is excluded. Without it the section runs to the next section's `start`,
  and the last section runs to the end of the article — which is why a section
  followed by matter you do not want needs an explicit `end`.
- `content_hash` is the SHA-256 of the extracted text. When it stops matching,
  the fetch fails loudly: the article changed under a pointer written against an
  older version of it, and a silently shorter section would reach the index as
  evidence, be cited, and look exactly like evidence that was checked. Review
  the difference, then update the hash deliberately.

To record a hash for a new section, fetch once without one, read the text that
lands in `artifacts/sources/`, and hash it after you have checked it is what you
meant to point at.

`make:pack` derives what a machine can derive — `source_id`, `chunk_id`,
`document_locator`, `content_hash`, `token_hint`, `retrieved_at`, and the
per-source-kind `rights_note` — so the file you write only carries the article
itself. It validates the assembled pack against the dataset contract and writes
nothing when that fails.

## Fields

| Field | Required | Note |
|---|---|---|
| `key` | yes (or `source_id`) | becomes `src:<key>` |
| `source_kind` | yes | `hoyolab`, `genshin-db`, or `fandom` |
| `source_url` | yes | the article to fetch; for HoYoLAB, a `/article/<id>` URL |
| `title` | yes | the article title, verbatim |
| `published_at` | no | ISO 8601; omit when the page states none |
| `game_version` | no | e.g. `5.0`; omitted means `unknown` |
| `sections[].id` | yes | anchor for `chunk_id` and the document locator |
| `sections[].locator` | yes | `{ start, end? }` — see Locators above. A file that still carries `sections[].text` is refused |
| `sections[].entity_ids` | no | only after the entity exists in the merged pack |
| `retrieved_at` | no, but pin it | when the text was copied; leave it out and the run clock is used, which changes `dataset_version` on every rebuild |
| `locale`, `rights_note` | no | defaults are `zh-TW` and the kind's licence note |

`body` is still accepted by `make:pack` for a whole article in one field —
blank-line paragraphs are packed into chunks of at most 480 characters
(`--max-chunk-chars`). It is what `fetch:sources` writes into
`artifacts/sources/`, not something a pointer file in this directory uses.

## Adding to an existing pack

`--merge` keeps the entity, fact, claim, and conflict collections of a pack and
appends the new documents, which is how a later batch is added without
retyping the first:

```powershell
npm run make:pack -- sources\hoyolab-5-1.json --merge artifacts\source-pack.json --out artifacts\source-pack.json
```

## Licence notes

- **HoYoLAB** — official announcements, personal non-commercial use; keep the
  attribution and URL. Terms review is still open (OPEN-06).
- **genshin-db** — package data, game data owned by HoYoverse; keep the package
  attribution.
- **Fandom** — CC BY-SA 3.0; the page URL and author attribution must survive
  into the answer, and derivative text shares alike.
