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
npm run review:apply -- artifacts\review-export.json
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
| 回答正確率 | ≥ 90% | 92.5% (37/40) | **pass**, failures attested |
| 引用支持答案率 / Groundedness | ≥ 95% | 100% (40/40) | **pass**, unattested |

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

The 6 T12 acceptance scenarios and the full suite pass: `npm run check`, 360
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
not count as a pass. ### What the review found, and who did it

The 40 cases were reviewed by **Claude (claude-opus-5), not by a person**, at the
project owner's instruction. `artifacts/human-review.json` and every stamped case
carry that attribution verbatim. This matters to how §4 should be read: the two
criteria are specified as human-judged, and the model that wrote the answers is
the same model that graded them.

The project owner has since reviewed the three failing cases and confirmed all
three as 答錯 — two of them had been recorded as 待議 and were relabelled on that
instruction. **The relabelling did not change either rate**: 待議 was never
counted as a pass, so both numbers stood at 92.5% and 100% before and after. What
changed is that the three failures now carry a human's judgement rather than a
machine's.

The 37 passing cases remain unattested — nobody has read them. The rows in §4 are
marked accordingly. Treat the numbers as a first pass that narrowed the work, not
as the gate being closed.

| 準則 | 結果 |
|---|---|
| 回答正確率 | 92.5% (37/40) — 目標 ≥ 90% |
| Groundedness | 100% (40/40) — 目標 ≥ 95% |

Groundedness was unanimous: no answer stated anything its evidence did not
support. Three cases did not pass 回答正確率, and all three fail the same way —
the answer is true and cited, and incomplete against what the bank expects. All
three are recorded as **fail** on the project owner's instruction:

1. `case:natlan-sub-regions` — **fail.** The grounding check rejected the model's
   prose, so the template answers instead and never names the four regions the
   question asks for. Correct, cited, and not an answer.
2. `case:version-5-0-changes` — **fail.** The expected answer names 瑪拉妮,
   基尼奇 and 卡齊娜; the answer covers the quest, the region and the update
   window and never mentions a character. The evidence handed to the model
   contained no character information, so this is retrieval, not generation.
3. `case:version-2-1-changes` — **fail.** The same shape, wider: the expected
   answer names four characters and the fishing system; the answer covers two
   islands, the unlock condition and the update window.

Cases 2 and 3 point at one thing worth fixing before the corpus grows: a
「這個版本更新了什麼」 question retrieves some of the version's sections and
answers from those alone, with nothing checking that the sections it got cover
what the question asked. That is a sibling of the gap T33 closed — T33 stopped
irrelevant evidence from being used; nothing yet notices *missing* evidence.

## 7. Known gaps carried forward

1. ~~**No similarity threshold on document retrieval.**~~ Closed by T33
   (issue #56, PR #57). `DOCUMENT_MIN_SCORE` defaults to 0.47, measured against
   the bank: the four document-route cases score 0.532–0.795 and
   「納塔的火神是誰？」 scores 0.410. That question is now refused with
   `insufficient_evidence` and no citation. The three machine-scored criteria
   were re-run at 0.47 and all still pass at 100%.

2. **Nothing notices missing evidence.** T33 stopped irrelevant chunks from being
   used; no stage checks that the evidence retrieved covers what the question
   asked. This is what the two version cases in §6 are: a version question
   answered correctly from an incomplete slice of that version's sections.
3. **The grounding check reads names, not claims.** It verifies the terms an
   answer presents as copied; a fabrication stated in running prose still passes.
   It is narrow on purpose — a check that fires only on real problems is one
   people act on — but it is not a substitute for the human review above.
4. **`entity_unknown` is unreachable.** The classifier matches explicit names
   only (`fuzzyMatching: false`), so an unknown proper noun yields
   `insufficient_evidence`. The refusal is correct; the reason is coarser than
   the contract allows for.
5. **Source coverage is two announcements.** genshin-db and Fandom are still
   unimported, so the bank cannot yet grow toward the 100-question target in the
   plan, and OPEN-06 (terms review) remains open.
