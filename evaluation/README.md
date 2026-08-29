# Evaluation set (T30)

`eval-cases.json` is the 50-question bank the release gate scores against: 40
answerable, 10 refuse. Every answerable case is backed by a fact or a verbatim
chunk that is actually in the dataset, so a failure means the system missed
something it holds — never that the question was unanswerable to begin with.

```powershell
npm run ingest:build -- artifacts\source-pack.json
npm run evaluate -- evaluation\eval-cases.json --report artifacts\eval-report.json
```

The command exits non-zero when the run failed **or** a scored metric missed its
target, so a regression the numbers show cannot pass as a green command.

## What is scored and what is not

| Metric | Scored by | Target |
|---|---|---|
| `retrieval_recall_at_5` | runner | 0.9 |
| `citation_coverage` | runner | 1.0 |
| `correct_refusal` | runner | 0.9 |
| `answer_correctness` | human review | 0.9 |
| `groundedness` | human review | 0.95 |

The two human-judged metrics come back `not_scored` on every case. That is
deliberate: `answer_text` is still the T20 template, so there is no generated
prose to judge yet, and a runner that guessed at correctness would be reporting
a number nobody verified.

## Case composition

- **35 structured** — element, weapon type, and rarity for the 7 characters and
  7 weapons the two announcements introduce.
- **5 version / region / narrative** — what each version changed, which
  sub-regions and islands opened, and one skill-name question whose only
  evidence is a claim plus a verbatim chunk.
- **6 out-of-scope refusals** — team building, pull advice, artifact rolls, beta
  leaks, account trading, farming routes. These declare
  `refusal_reason: out_of_scope`.
- **4 data-gap refusals** — an entity, a region, and two versions the dataset
  does not cover. Each declares the reason this ruleset can honestly produce,
  with a note saying why: the classifier matches explicit names only
  (`fuzzyMatching: false`), so an unknown proper noun yields
  `insufficient_evidence`, never `entity_unknown`.

## Known gap this bank does not yet cover

Document retrieval has no similarity threshold, so a question about a known
entity can be answered with a chunk that does not address it — "納塔的火神是誰？"
comes back answered with one citation, though no chunk mentions a Natlan
archon. A case for this belongs in the bank once the threshold exists; adding it
before then would only park a permanent failure in the gate.

`dataset_version` records the pack the bank was written against. Re-check the
required facts whenever the dataset changes.

## Growing the bank

New questions must be answerable from `sources/`. Add the source first, rebuild
the pack, then write the case — not the other way round.
