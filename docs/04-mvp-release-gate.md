# MVP E2E Release Gate (T31)

> Re-run: 2026-09-02 · Branch: `dev` · Dataset version:
> `5c49fb1e6fc577c1780e16987e6fa34688ca9b4bbce7acab03b69076bdbb1a87`
>
> Earlier runs: 2026-08-29 (first, no generation stage) and 2026-08-29 (with
> generation). Both measured a corpus of two hand-copied announcements that the
> project no longer builds; §0 records what changed.

This is the evidence record for the gate defined in
[`01-project-plan.md` §8.1](01-project-plan.md) and
[`03-system-design.md` §9.2](03-system-design.md). It reports what the gate
measured, not what the project hoped to measure.

## 0. What changed since the first run

The corpus was replaced twice and extended once between 2026-08-29 and
2026-09-02, so the three earlier numbers in this record are not comparable to
the current ones:

| Change | Effect on the corpus |
|---|---|
| T36 pointers + fetch | Hand-copied 498-character condensations replaced by the verbatim articles (4,608 and 3,430 characters) |
| T36 Fandom import | 6 zh-wiki character profiles, 2,586 characters |
| T36 genshin-db import | 20 records → 53 structured facts, 6 of the entities appearing in no announcement |

The machine-scored criteria were re-measured on the current corpus and all three
still pass. **The two human-judged criteria have not been re-judged**, and the
attestation recorded in §6 was given for answers three corpus changes ago. §4
marks them accordingly.

## 1. How to reproduce

These steps are the ones this record was produced with:

```powershell
npm run fetch:sources -- sources
npm run fetch:genshin-db -- sources\_genshin-db.json --base sources\_facts.json --out artifacts\sources\_facts-merged.json
npm run make:pack -- artifacts\sources --merge artifacts\sources\_facts-merged.json --out artifacts\source-pack.json
npm run ingest:validate -- artifacts\source-pack.json
npm run ingest:build -- artifacts\source-pack.json
npm start
npm run evaluate -- evaluation\eval-cases.json --report artifacts\eval-report.json
npm run review:apply -- artifacts\review-export.json
```

The last step is the human half and only runs once a reviewer has produced
`artifacts/review-export.json`; every step above it is machine-reproducible on
its own.

Every step above was run from a cleared `artifacts/` for this record, twice. The
pack hashed identically both times, so `dataset_version` is stable and this run
can be compared with the next one — a property that now has to survive three
fetched sources rather than files sitting in the repository, and does.

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
| `fetch:sources` | `artifacts/sources/` — 8 files (2 HoYoLAB, 6 Fandom) | git-ignored; the repository stores pointers |
| `fetch:genshin-db` | `artifacts/sources/_facts-merged.json` — 53 facts from 20 records | commit `8b15995fa220` |
| `make:pack` | `artifacts/source-pack.json` — 9 documents, 18 chunks | `5c49fb1e6fc577c1` |
| `ingest:validate` | RunResponse `passed`, 0 errors | — |
| `ingest:build` | `artifacts/structured.db` | `433099a6759b10a9` |
| `ingest:build` | `artifacts/index.db` | `2a9f7214f4916a53` |
| `evaluate` | `artifacts/eval-report.json` | run `passed`, exit 0 |

Dataset contents: 9 source documents (2 HoYoLAB announcements, 6 Fandom
profiles, 1 genshin-db tree), 22 canonical entities, 91 structured facts, 4
claims, 18 verbatim chunks.

**Reproducible.** The pipeline was run twice from a cleared `artifacts/` and the
pack hashed identically both times (`5c49fb1e6fc577c1`), so `dataset_version` is
stable and this run can be compared with the next one. That property now covers
three fetched sources, not just files sitting in the repository.

## 4. Gate criteria

| Criterion | Target | Result | Verdict |
|---|---:|---:|---|
| Retrieval Recall@5 | ≥ 90% | 100% (58/58) | **pass** |
| 無資料正確拒答率 | ≥ 90% | 100% (10/10) | **pass** |
| 非拒答答案附來源率 | 100% | 100% (58/58) | **pass** |
| 回答正確率 | ≥ 90% | 96.6% (56/58) | **pass**, 機器評分未經人簽署（見 §6） |
| 引用支持答案率 / Groundedness | ≥ 95% | 100% (58/58) | **pass**, 機器評分未經人簽署（見 §6） |

68 cases ran: 58 answered, 10 refused — matching the bank's declared split
exactly, with no case landing in the wrong bucket.

All three sources reach answers: of the citations attached to the 58 non-refused
answers, 43 are HoYoLAB, 9 Fandom and 9 genshin-db. Two answers fall back to the
citation-only template — `case:version-5-0-changes`, where the verbatim-name
check rejected an invented list of enemies, and `case:natlan-sub-regions`, where
it rejected a corrupted place name.

## 5. End-to-end evidence

Collected on 2026-09-02 against the running server at `http://127.0.0.1:3000`.

`GET /health` reports `status: ok`, `dataset.state: ready`, `index.verified:
true`, 9 source documents, 22 canonical entities, 91 structured facts and 18
chunks with 18 vectors, with the same dataset version in both stores.

`POST /api/v1/query`:

| Question | Status | Reason | Citations |
|---|---|---|---|
| 瑪拉妮是什麼元素？ | uncertain | version_unknown | hoyolab + genshin-db |
| 鍾離是什麼元素？ | uncertain | version_unknown | genshin-db |
| 瑪拉妮是做什麼的？ | uncertain | version_unknown | hoyolab + fandom |
| 5.0版本更新了哪些內容？ | answered | — | hoyolab |
| 雷電將軍該配什麼隊伍？ | refused | out_of_scope | none |
| 納塔的火神是誰？ | refused | insufficient_evidence | none |
| 迪盧克是什麼元素？ | refused | insufficient_evidence | none |

Every response carries a `trace_id` that matches the run log.

Two of these deserve reading twice:

- **`uncertain` is not a defect here.** genshin-db states what is true of the
  current game and carries no version, so a question answered from it — or from
  a mix that includes it — is correctly reported as version-unscoped rather
  than silently claiming a version it does not have. The same question scores
  `answered` in the evaluation, where the bank supplies the version.
- **「納塔的火神是誰？」 refuses again.** The similarity floor stopped catching it
  once Fandom profiles mentioning 納塔 entered the corpus; what refuses it now is
  the check added in §9.3.1 of the design — the model said the evidence does not
  answer the question, and the system stopped reporting that as an answer.

The 6 T12 acceptance scenarios and the full suite pass: `npm run check`, 401
tests, 0 failures, under the offline guard — the generation stage and both
fetchers included, their network calls replaced by fakes so CI still needs
neither a model nor a live source.

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
not count as a pass.

### The review this record still needs

The 58 answers of this run were judged by **Claude (claude-opus-5), not by a
person**, at the project owner's instruction. `artifacts/human-review.json` and
every stamped case carry that attribution verbatim, and §4 marks both rows
accordingly. The model that wrote the answers is the model that graded them, so
treat the numbers as a first pass rather than as the gate being closed.

| 準則 | 結果 |
|---|---|
| 回答正確率 | 96.6% (56/58) — 目標 ≥ 90% |
| Groundedness | 100% (58/58) — 目標 ≥ 95% |

Groundedness was unanimous, and this run checked it against the evidence the
model was actually handed: no answer stated anything its evidence did not
support. `case:version-2-1-changes` is the one worth naming — it lists four
characters, two islands, two domains, three quest chapters, ten world quests and
the fishing system, and **every proper noun in it appears verbatim in the 2.1
announcement**, checked term by term rather than sampled.

Two cases fail 回答正確率, both the same way and both for a good reason:

1. `case:version-5-0-changes` — the guard rejected the model's prose, which had
   invented a list of enemies, so the template answers and never names 納塔 or
   the three new characters the bank expects.
2. `case:natlan-sub-regions` — the guard rejected a corrupted place name, so the
   template answers and never names the four regions the question asks for.

**Refusing to ship a fabrication is the right behaviour and still counts as not
answering the question.** Both are recorded as `fail` rather than excused, which
is why 回答正確率 is 96.6% and not 100%.

The account below is kept because it is where the three defects in §6 were found
and why those guards exist.

The rest of this section is kept as the record of the earlier review, because it
is where the three defects in §6 below were found and why the guards exist.

### What the earlier review found, and who did it

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

**Every passing case has now been read by the project owner.** It happened in two
passes: 10 spot-checked at v1.0.0, and the remaining 29 after v1.1.0. All 39 were
upheld — no answer stated anything its evidence did not support. Groundedness in
§4 therefore carries no reservation.

The second pass was 29 and not 27 because the population moved: `case:version-5-0-changes`
and `case:version-2-1-changes` were failures at v1.0.0 and so were never in the 37,
and T34 changed both answers. They were read in their v1.1.0 form, against the whole
announcement each now retrieves.

回答正確率 took a third pass, because groundedness and correctness are different
questions about the same answer: whether it exceeds its evidence, and whether it
covers what the bank expects. The project owner attested the three v1.0.0 failures;
T34 then turned two of those into passes, and those two were read again — in full,
as text — and confirmed as complete against the expected answer. Every case now
carries a human verdict on both criteria, and neither row in §4 reserves.

What each row means, precisely:

| 準則 | 經人確認的範圍 |
|---|---|
| 回答正確率 | 3 題 v1.0.0 的失敗判定，加上 T34 改變後的 2 題重判。其餘 37 題的通過判定由機器做出，人未逐題複核。 |
| Groundedness | 39 題判為通過的案例全數經人閱讀（10 + 29）。 |

The distinction is worth keeping: someone has read every answer against its
evidence, and has ruled on every case the machine flagged or changed. Nobody has
re-derived the 37 uncontested correctness verdicts from scratch.

The first pass's 10 were chosen to be the ones most likely to overturn the
machine's judgement, not sampled at random:

| 為什麼抽這題 | 案例 |
|---|---|
| 唯一走文件檢索的通過案例 | `case:inazuma-new-islands` |
| 唯一答案來自 claim 而非 structured fact | `case:raiden-shogun-burst-name` |
| 答案只有「5 星」，沒有主詞也沒有句子 | `case:engulfing-lightning-rarity` |
| 三題句型彆扭，用來判斷是不是系統性問題 | `case:kujou-sara-weapon-type`, `case:kinich-weapon-type`, `case:the-catch-weapon-type` |
| T32 三個缺陷的原始案例 | `case:kinich-weapon-type`（enum 翻譯）, `case:surfs-up-weapon-type`（證據沒有主詞）, `case:ash-graven-drinking-horn-weapon-type`（專有名詞守門） |
| 對照組與唯一的 4 星角色 | `case:mualani-element`, `case:kachina-rarity` |

The adverse sample came back clean, and so did the other 29 — which is the
stronger statement, because it is no longer a sample.

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

2. **Nothing notices missing evidence.** Closed for version overviews by T34
   (issue #61). A version question that resolves no entity now takes the whole
   announcement instead of the top-ranked sections, and both version cases pass.
   The general problem now has a check, but not a gate. T35 (issue #65) asks
   the model, before the answer is written, whether the approved evidence
   answers the question at all. Measured on the 58-case bank it catches the
   question the similarity floor no longer catches — and refuses one answerable
   question it should not (`case:kujou-sara-role`, whose evidence states the
   role verbatim). Two prompts and two seeds produced the same mistake, so it
   is systematic, not noise. The verdict is therefore recorded
   (`evidence_may_not_cover_question`) and the answer still goes out;
   `ENFORCE_COVERAGE=true` turns it into a refusal for anyone measuring the
   trade. **The gap is narrowed and documented, not closed** — see
   `docs/03-system-design.md` §9.5 and `docs/07-scale-test.md` §5.
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
