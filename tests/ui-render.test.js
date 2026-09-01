import assert from "node:assert/strict";
import test from "node:test";

import {
  ANSWER_STATUS_LABELS,
  describeAnswer,
  describeCitations,
  describeError,
  describeHealth,
  describeVersionScope,
} from "../src/ui/render.js";

function answered(overrides = {}) {
  return {
    answer_status: "answered",
    answer_text: "雷電將軍是雷元素角色。",
    query_category: "structured",
    citations: [
      {
        source_url: "https://example.test/notice",
        title: "5.0 版本更新說明",
        source_kind: "hoyolab",
        published_at: "2026-07-01T00:00:00Z",
        retrieved_at: "2026-08-01T00:00:00Z",
        game_version: "5.0",
      },
    ],
    version_scope: "5.0",
    trace_id: "trace:ui",
    ...overrides,
  };
}

test("an answered response is shown with its citations and version scope", () => {
  const view = describeAnswer(answered());

  assert.equal(view.kind, "answer");
  assert.equal(view.status_label, ANSWER_STATUS_LABELS.answered);
  assert.equal(view.is_refusal, false);
  assert.equal(view.text, "雷電將軍是雷元素角色。");
  assert.equal(view.version_label, "版本範圍：5.0");
  assert.equal(view.reason_label, undefined);
  assert.deepEqual(view.citations, [
    {
      url: "https://example.test/notice",
      title: "5.0 版本更新說明",
      kind_label: "HoYoLAB 官方",
      meta: ["版本 5.0", "發布 2026-07-01", "取得 2026-08-01"],
    },
  ]);
  assert.equal(view.trace_id, "trace:ui");
});

test("a refusal keeps its reason and is not dressed up as an answer", () => {
  const view = describeAnswer(
    answered({
      answer_status: "refused",
      answer_text: "這個問題超出本助手的範疇。",
      uncertainty_reason: "out_of_scope",
      citations: [],
      version_scope: "unknown",
    }),
  );

  assert.equal(view.status_label, "拒答");
  assert.equal(view.is_refusal, true);
  assert.equal(view.reason_label, "超出本助手範疇");
  assert.deepEqual(view.citations, []);
  assert.equal(view.version_label, "版本範圍：未知");
});

test("an uncertain answer states its reason alongside the citations it does have", () => {
  const view = describeAnswer(
    answered({
      answer_status: "uncertain",
      uncertainty_reason: "version_unknown",
      version_scope: "unknown",
    }),
  );

  assert.equal(view.status_label, "不確定");
  assert.equal(view.reason_label, "適用版本無法確認");
  assert.equal(view.citations.length, 1);
});

test("the spoiler notice is shown only when the answer carries one", () => {
  assert.equal(describeAnswer(answered()).spoiler_notice, undefined);
  assert.equal(
    describeAnswer(answered({ spoiler_notice: "提醒：以下內容可能包含劇情透露。" }))
      .spoiler_notice,
    "提醒：以下內容可能包含劇情透露。",
  );
});

test("citation URLs are used as given and never rebuilt", () => {
  const citations = describeCitations([
    { source_url: "https://wiki.example/page?x=1#a", title: "頁面", source_kind: "fandom" },
    "not-a-citation",
  ]);

  assert.equal(citations.length, 1);
  assert.equal(citations[0].url, "https://wiki.example/page?x=1#a");
  assert.equal(citations[0].kind_label, "Fandom Wiki");
  assert.deepEqual(citations[0].meta, []);
});

test("an unstated version scope is said plainly instead of left blank", () => {
  assert.equal(describeVersionScope("3.0-3.8"), "版本範圍：3.0-3.8");
  assert.equal(describeVersionScope("unknown"), "版本範圍：未知");
  assert.equal(describeVersionScope(undefined), "版本範圍：未提供");
});

test("an error envelope is rendered as an error, never as an empty answer", () => {
  const view = describeError({
    answer_status: "error",
    error: { code: "invalid_request", message: "壞掉了", details: [{ field: "question" }] },
  });

  assert.equal(view.kind, "error");
  assert.equal(view.code, "invalid_request");
  assert.equal(view.text, "壞掉了");
  assert.deepEqual(view.details, [{ field: "question" }]);
  assert.equal(describeAnswer(undefined).kind, "error");
  assert.equal(describeAnswer({ nothing: true }).code, "internal_error");
});

test("health reporting tells the player when there is no dataset to ask about", () => {
  const ready = describeHealth({
    status: "ok",
    dataset: {
      state: "ready",
      index: {
        index_hash: "abcdef0123456789",
        counts: { documentChunks: 7 },
        embedding_model: "bge-m3:latest",
      },
    },
  });
  const missing = describeHealth({ status: "degraded", dataset: { state: "missing", index: {} } });

  assert.equal(ready.ready, true);
  assert.match(ready.detail, /abcdef012345・7 個切塊・bge-m3:latest/);
  assert.equal(missing.ready, false);
  assert.equal(missing.label, "尚未建立資料，請先執行 ingest build");
  assert.equal(describeHealth(undefined).ready, false);
});
