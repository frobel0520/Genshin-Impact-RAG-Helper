# Hand-copied sources

One JSON file per article, copied by hand from the source page. Files whose
name starts with `_` are templates and are skipped, so `_template.json` can sit
next to the real articles.

```powershell
Copy-Item sources\_template.json sources\hoyolab-5-0.json
npm run make:pack -- sources --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
```

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
| `source_url` | yes | the page the text was copied from |
| `title` | yes | the article title, verbatim |
| `published_at` | no | ISO 8601; omit when the page states none |
| `game_version` | no | e.g. `5.0`; omitted means `unknown` |
| `sections[].id` | no | anchor for `chunk_id` and the locator; defaults to `p1`, `p2`, … |
| `sections[].text` | yes | source text, verbatim |
| `sections[].entity_ids` | no | only after the entity exists in the merged pack |
| `locale`, `rights_note`, `retrieved_at` | no | defaults are `zh-TW`, the kind's licence note, and the run time |

Use `body` instead of `sections` to paste one long article: blank-line
paragraphs are packed into chunks of at most 480 characters
(`--max-chunk-chars`).

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
