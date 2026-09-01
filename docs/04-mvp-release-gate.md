# MVP E2E Release Gate (T31)

> First run: 2026-08-29 · Second run (with generation): 2026-08-29 · Branch:
> `dev` · Dataset version:
> `4e87e7d5d3f251188cb94550eeb4d3afe588d2725a600802c14d13920b6d987b`

This is the evidence record for the gate defined in
[`01-project-plan.md` §8.1](01-project-plan.md) and
[`03-system-design.md` §9.2](03-system-design.md). It reports what the gate
measured, not what the project hoped to measure.

The first run found three of the five criteria passing and two unscorable: the
MVP had no generation stage, so there was no answer for 回答正確率 or
Groundedness to be about. T32 added one, and this record covers both runs. The
three machine-scored criteria still pass; the two human-judged ones now have 40
real answers to judge, and that review is the one step this record cannot
perform for itself.

## 1. How to reproduce

```powershell
npm run make:pack -- sources --merge sources\_facts.json --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
npm run ingest:build -- artifacts\source-pack.json
npm start
npm run evaluate -- evaluation\eval-cases.json --report artifacts\eval-report.json
npm run review:apply -- artifactseview-export.json
```

The last step is the human half and only runs once a reviewer has produced
`artifacts/review-export.json`; every step above it is machine-reproducible on
its own.

Every step above was run from a cleared `artifacts/` for this record. The pack is
byte-identical across runs, so `dataset_version` is stable and the gate can be
re-run and compared. That was not true before this gate: the converter stamped
`retrieved_at` from the clock, so the same sources produced a new dataset
version every rebuild. `retrieved_at` is now pinned in each article file.

## 2. Environment

| Component | Value |
|---|---|
| Node | v24.14.1 |
| Ollama | 0.33.0 |
| Embedding model | `bge-m3:latest`, 1024 dimensions |
| Generation model | `qwen2.5-coder:14b`, temperature 0, fixed seed |

## 3. Artifacts

| Stage | Output | Hash (first 16) |
|---|---|---|
| `make:pack` | `artifacts/source-pack.json` — 2 documents, 13 chunks | input `4e87e7d5d3f25118` |
| `ingest:validate` | RunResponse `passed`, 0 errors | — |
| `ingest:build` | `artifacts/structured.db` | `83004f25eb7904e2` |
| `ingest:build` | `artifacts/index.db` | `39f4afd60914974d` |
| `evaluate` | `artifacts/eval-report.json` | run `passed`, exit 0 |

Dataset contents: 2 source documents, 16 canonical entities, 38 structured
facts, 4 claims, 13 verbatim chunks, 13 vectors. `GET /health` reports
`status: ok`, `dataset.state: ready`, `index.verified: true`, and the same
dataset version in both stores.

## 4. Gate criteria

| Criterion | Target | Result | Verdict |
|---|---:|---:|---|
| Retrieval Recall@5 | ≥ 90% | 100% (40/40) | **pass** |
| 無資料正確拒答率 | ≥ 90% | 100% (10/10) | **pass** |
| 非拒答答案附來源率 | 100% | 100% (40/40) | **pass** |
| 回答正確率 | ≥ 90% | awaiting human review of 40 answers | **pending** |
| 引用支持答案率 / Groundedness | ≥ 95% | awaiting human review of 40 answers | **pending** |

50 cases ran: 40 answered, 10 refused — matching the bank's declared split
exactly, with no case landing in the wrong bucket.

## 5. End-to-end evidence

Verified in the browser against the running server at `http://127.0.0.1:3000`:

| Path | Observed |
|---|---|
| Dataset banner | 「資料已就緒・索引 39f4afd60914・13 個切塊・bge-m3:latest」 |
| Answered (structured) | 「瑪拉妮是什麼元素？」 → 已回答, 版本範圍 5.0, 1 citation to the 5.0 announcement with its source kind, version and retrieval date |
| Answered (version) | 「5.0版本更新了哪些內容？」 → 已回答, 6 pieces of evidence, 版本範圍 5.0 |
| Refused (out of scope) | 「雷電將軍該配什麼隊伍？」 → 拒答, 原因「超出本助手範疇」, 引用來源（0）, and an explicit 「這個回答沒有附上來源」 |
| Traceability | every response carries a 追蹤碼 that matches the run log |

The 6 T12 acceptance scenarios and the full suite pass: `npm run check`, 348
tests, 0 failures, under the offline guard — the generation stage included, its
model replaced by a fake so CI still needs neither a model nor a live source.

## 6. Generation, and what the first review of it found

`answer_text` is now written by `qwen2.5-coder:14b` from the approved evidence
only. The stage is built so a model failure costs prose and never correctness:

- A **refusal never reaches the model.** Its wording is the policy's.
- The model is given the **approved** evidence — never the raw bundle — so a
  claim that lost a conflict cannot come back as content.
- It is given no URLs. Citations are attached by the formatter afterwards.
- Any failure, timeout, empty reply, or runaway reply falls back to the
  deterministic template, with the citations intact.
- Temperature 0 and a fixed seed, so an evaluation report describes the system
  rather than one sampling of it.

Two defects surfaced the moment real answers existed, both invisible while the
answer was a template:

1. **English enum values were being translated by the model.** Facts store
   `Claymore` so sources stay comparable; asked to answer in Chinese the model
   wrote 長劍 — a different weapon — and `Catalyst` became 催化器. Fixed: the
   evidence resolver now renders zh-TW labels from a table in the domain layer,
   so nothing downstream has to translate. 基尼奇 went from 長劍 to 雙手劍.
2. **A proper noun was corrupted.** 「納塔在5.0版本開放了哪些區域？」 answered
   「蓋石山」 where every source and chunk says 「踞石山」. The prompt already
   tells the model to copy the wording; a 14B model does not always obey, and it
   makes the same mistake on every run. Now **guarded**: a name the answer
   presents as copied — quoted, or standing alone as a list item — must appear
   verbatim in the evidence, or the answer falls back to the citation-only
   template and the rejection is logged under the query's trace. Across the 50
   cases this fires once, on exactly that answer.
3. **A fact was handed to the model without saying whose it was.** The evidence
   line for a weapon read 「武器類型：法器」 with no subject; the model could
   only infer the weapon from the question, and the grounding check flagged 13
   answers because the name they used was nowhere in their evidence. The
   resolver now renders 「衝浪時光的武器類型：法器」. The false positives were the
   check reporting a real weakness in the prompt, not noise in the check.

### The decision this needs

回答正確率 and Groundedness are human-judged by design — the runner reports them
`not_scored` rather than guessing, because a metric nobody measured must not
read as green. To close the gate, review the 40 answered cases in
`artifacts/eval-report.json` and record a verdict per case. 39 carry generated
prose; `case:natlan-sub-regions` is the one the grounding check rejected, so it
answers in the template's words with its citation intact.

The verdict has somewhere to land: `npm run review:apply` takes the reviewer's
export, writes `artifacts/human-review.json`, and stamps the two labels back
onto every answered case in the report. It recomputes both rates from the
per-case verdicts rather than trusting the totals the export carried, and it
refuses to write anything while a case is still unreviewed — a gate closed on a
partial review is worse than one left open. 待議 is a recorded verdict and does
not count as a pass. Until that command has run against a real review, the two
rows in §4 stay **pending**; this record will not report a number nobody
judged.

## 7. Known gaps carried forward

1. **No similarity threshold on document retrieval.** 「納塔的火神是誰？」 is
   answered with one citation although no chunk mentions a Natlan archon: the
   entity resolves, document retrieval returns its nearest chunks, and nothing
   checks that they address the question. This was harmless while the answer was
   a template. It is not harmless now that a model writes the answer.
2. **The grounding check reads names, not claims.** It verifies the terms an
   answer presents as copied; a fabrication stated in running prose still passes.
   It is narrow on purpose — a check that fires only on real problems is one
   people act on — but it is not a substitute for the human review above.
3. **`entity_unknown` is unreachable.** The classifier matches explicit names
   only (`fuzzyMatching: false`), so an unknown proper noun yields
   `insufficient_evidence`. The refusal is correct; the reason is coarser than
   the contract allows for.
4. **Source coverage is two announcements.** genshin-db and Fandom are still
   unimported, so the bank cannot yet grow toward the 100-question target in the
   plan, and OPEN-06 (terms review) remains open.
