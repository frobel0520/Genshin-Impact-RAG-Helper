# Genshin Impact RAG Helper

A local-first Traditional Chinese knowledge assistant for Genshin Impact. It
answers questions about characters, weapons, materials, quests and version
updates from three real sources, and **refuses rather than guessing** when the
evidence does not support an answer.

Every non-refused answer carries citations. Nothing costs money to run: the
embedding model, the generation model and both stores are local.

- **Status:** v1.2.0 plus an unreleased corpus change. The three machine gate
  criteria pass; the two human-judged ones are unscored on the current corpus —
  [Release gate](#release-gate) below.
- **Docs:** the full SDLC record lives in [`docs/`](docs/); see
  [Documents](#documents).

## What it does that a chatbot does not

| Behaviour | Where it lives |
|---|---|
| Refuses when no chunk clears the similarity floor | [`src/query/document-retrieval.js`](src/query/document-retrieval.js) |
| Refuses when the model itself says the evidence does not answer | [`src/generation/answer-grounding.js`](src/generation/answer-grounding.js) |
| Falls back to a citation-only template when a name in the answer appears in no evidence | [`src/generation/answer-grounding.js`](src/generation/answer-grounding.js) |
| Reports `uncertain` when the evidence carries no game version | [`src/policy/conflict-version-policy.js`](src/policy/conflict-version-policy.js) |
| Ranks sources by authority and records the losing claim rather than dropping it | [`src/policy/conflict-version-policy.js`](src/policy/conflict-version-policy.js) |
| Never lets the model see a policy decision, a URL, or a rejected claim | [`src/generation/answer-generation.js`](src/generation/answer-generation.js) |

The generation stage is built so a model failure costs prose and never
correctness: a refusal is never written by the model, the model is handed only
the approved evidence, and any failure, timeout or ungrounded name falls back to
a deterministic template **with the citations intact**.

## Requirements

- Node.js >= 24
- [Ollama](https://ollama.com/) with `bge-m3:latest` (embeddings) and
  `qwen2.5-coder:14b` (generation)
- Windows PowerShell examples below; the commands are the same elsewhere

Generation runs at temperature 0 with a fixed seed, so the same question over
the same dataset produces the same answer — an evaluation report describes the
system rather than one sampling of it.

## Build the dataset and run

The repository stores **pointers, not source text** (see
[`docs/05-source-licensing.md`](docs/05-source-licensing.md)). The text is
fetched onto your machine into a git-ignored directory, so nothing here
redistributes third-party content.

```powershell
npm ci
Copy-Item .env.example .env

npm run fetch:sources -- sources
npm run fetch:genshin-db -- sources\_genshin-db.json --base sources\_facts.json --out artifacts\sources\_facts-merged.json
npm run make:pack -- artifacts\sources --merge artifacts\sources\_facts-merged.json --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
npm run ingest:build -- artifacts\source-pack.json

npm start
```

The UI is at `http://127.0.0.1:3000`, the API at `POST /api/v1/query`, and
`GET /health` reports dataset state, index verification and record counts.
Without an `.env` file, use `npm run start:local`.

Running the pipeline twice from a cleared `artifacts/` produces an identical
pack hash, so `dataset_version` is stable and two evaluation runs can be
compared.

## Sources

| Source | Used for | Authority | How it is imported |
|---|---|---:|---|
| HoYoLAB official announcements | version updates, fixes, known issues | 1 | public post API, section locators + `content_hash` |
| Fandom zh wiki | character profiles, lore | 2 | MediaWiki `action=parse`, pinned `revision_id` |
| genshin-db | structured facts (element, weapon type, rarity) | 3 | pinned commit SHA, enums mapped through a table |

An unmapped enum value **stops the import** rather than passing through: a
guessed value would arrive as a fact with a source behind it. See
[`sources/README.md`](sources/README.md) for the pointer format.

## Release gate

68 evaluation cases (58 answerable, 10 must-refuse), re-run 2026-09-06 on
dataset `f49336564cad6162` (14 documents, 89 chunks):

| Criterion | Target | Result | Signed off by |
|---|---:|---:|---|
| Retrieval Recall@5 | >= 90% | 100% (58/58) | machine |
| Correct refusal rate | >= 90% | 100% (10/10) | machine |
| Citation rate on non-refused answers | 100% | 100% (58/58) | machine |
| Answer correctness | >= 90% | **not scored** | — |
| Groundedness | >= 95% | **not scored** | — |

The last two criteria are human-judged by design, and the runner reports them
`not_scored` rather than guessing. The previous corpus was graded by Claude
(claude-opus-5) at the project owner's instruction — not by a person, and the
model that wrote the answers was the model that graded them. That corpus no
longer exists, so those numbers describe a system this repository no longer
builds and have not been carried forward. Full record:
[`docs/04-mvp-release-gate.md`](docs/04-mvp-release-gate.md) §8.

```powershell
npm run evaluate -- evaluation\eval-cases.json --report artifacts\eval-report.json
npm run review:apply -- artifacts\review-export.json
```

`review:apply` is the human half. It recomputes both rates from the per-case
verdicts rather than trusting the totals an export carried, and refuses to write
while any case is still unreviewed.

## Checks

```powershell
npm run check
```

437 tests, syntax check and module-boundary check, all under an offline guard —
CI needs neither a model nor a live source, because both fetchers and the
generation stage are tested with their network calls replaced by fakes.

Module dependencies are one-directional and enforced by
[`scripts/check-boundaries.js`](scripts/check-boundaries.js); the layout is in
[`src/README.md`](src/README.md).

## Known limitations

1. **A long version overview often answers in the template.** Section selection
   fixed the trivia openings (`docs/08-version-section-shapes.md` §8), but on 10
   to 15 sections the model tends to invent a name — or drift into Simplified
   Chinese — and the verbatim-name guard then falls the answer back to the
   citation-only template. The citations are intact and nothing fabricated
   ships, but the reader gets less than the evidence supports.
2. **The similarity floor has topped out.** At 89 chunks the question the corpus
   cannot answer scores inside the band of questions it can, so no threshold
   separates them. What refuses it now is the model reporting the gap itself —
   correct behaviour that depends entirely on the model noticing.
   [`docs/07-scale-test.md`](docs/07-scale-test.md) §3.1.
3. **The evidence-coverage check is recorded, not enforced.** It catches the
   question the floor misses and misjudges roughly one answerable question in
   fifty, systematically. `ENFORCE_COVERAGE=true` turns it into a gate for
   anyone measuring the trade. [`docs/07-scale-test.md`](docs/07-scale-test.md) §5.
4. **The corpus is small** — 14 documents, 89 chunks, 22 entities, 91 facts:
   seven HoYoLAB announcements, six Fandom profiles and one genshin-db tree. It
   is a demonstrable pipeline, not a complete Genshin knowledge base.

## Documents

| Document | What it records |
|---|---|
| [`01-project-plan.md`](docs/01-project-plan.md) | scope, KPIs, risks, 8-week plan |
| [`02-system-analysis.md`](docs/02-system-analysis.md) | use cases, functional and non-functional requirements |
| [`03-system-design.md`](docs/03-system-design.md) | architecture, data model, API, ADRs |
| [`04-mvp-release-gate.md`](docs/04-mvp-release-gate.md) | the gate evidence record |
| [`05-source-licensing.md`](docs/05-source-licensing.md) | the licence review behind storing pointers |
| [`06-source-import-selection.md`](docs/06-source-import-selection.md) | how the import interfaces were chosen |
| [`07-scale-test.md`](docs/07-scale-test.md) | what a 5x corpus did to retrieval |
| [`08-version-section-shapes.md`](docs/08-version-section-shapes.md) | section-shape statistics behind #83 |
| [`09-demo-script.md`](docs/09-demo-script.md) | a 10-minute walkthrough |

## Configuration

| Variable | Default | Note |
|---|---|---|
| `PORT` | `3000` | |
| `OLLAMA_HOST` | `http://127.0.0.1:11434` | http or https only |
| `STRUCTURED_DB_PATH` | `artifacts/structured.db` | |
| `DOCUMENT_DB_PATH` | `artifacts/index.db` | |
| `DOCUMENT_MIN_SCORE` | `0.42` | similarity floor; measured, not guessed |
| `ENFORCE_COVERAGE` | `false` | see limitation 3 |

## Licence and rights

Personal, non-commercial side project. Game data and announcement text belong to
HoYoverse; Fandom text is CC BY-SA 3.0 Unported; the genshin-db package code is
MIT (theBowja) while the game data it carries is not. This repository
redistributes none of it — it stores URLs, section markers and hashes, and each
citation leads back to the source.
