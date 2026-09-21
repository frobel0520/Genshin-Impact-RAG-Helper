import assert from "node:assert/strict";
import test from "node:test";
import { runT44Probe, sha256 } from "../scripts/t44-generation-probe.js";

const cases = [
  { id: "a", question: "問題？", versionScope: "5.0", dataset_version: "fixture", contents: [{ evidence_id: "ev:a", source_kind: "hoyolab", source_title: "測試", text: "證據內容" }] },
  { id: "b", question: "問題？", versionScope: "5.4", dataset_version: "fixture", contents: [{ evidence_id: "ev:b", source_kind: "hoyolab", source_title: "測試", text: "證據內容" }] },
];

function fakeFetchFactory() {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, init = {}) => {
      calls.push({ url, init });
      if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({}) };
      if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
      const payload = { message: { content: "依據證據，5.0版本新增納塔。" }, total_duration: 123, load_duration: 45, prompt_eval_count: 7, prompt_eval_duration: 8, eval_count: 9, eval_duration: 10 };
      return { ok: true, clone() { return { json: async () => payload }; }, json: async () => payload };
    },
  };
}

test("T44 probe fixes prompt/options and records output hash plus Ollama timings", async () => {
  const fake = fakeFetchFactory();
  const result = await runT44Probe({ cases, fetchImpl: fake.fetchImpl, repeats: 2, timeoutMs: 180_000, now: () => "2026-09-08T00:00:00.000Z" });
  assert.equal(result.runs.length, 4);
  assert.equal(result.runs[0].cold_start_confirmed, true);
  assert.equal(result.runs[1].phase, "subsequent_unknown");
  assert.equal(result.runs[0].output_sha256, sha256(result.runs[0].raw_output));
  assert.equal(result.runs[0].ollama_timing.eval_duration, 10);
  assert.ok(result.runs[0].composer_result !== null);
  const generation = fake.calls.filter((call) => call.url.endsWith("/api/chat"));
  assert.equal(generation.length, 4);
  const firstBody = JSON.parse(generation[0].init.body);
  assert.equal(firstBody.options.temperature, 0);
  assert.equal(firstBody.options.seed, 1);
  assert.equal(firstBody.options.num_predict, 512);
});

test("T44 probe does not label a run cold when unload or ps cannot be confirmed", async () => {
  const result = await runT44Probe({ cases, repeats: 1, fetchImpl: async () => { throw new Error("ECONNREFUSED"); } });
  assert.equal(result.runs.length, 2);
  assert.equal(result.runs.every((run) => run.cold_start_confirmed === false), true);
  assert.match(result.runs[0].unload_error.message, /ECONNREFUSED/);
});

test("missing ps models cannot confirm cold", async () => {
  const fake = fakeFetchFactory();
  fake.fetchImpl = async (url) => url.endsWith("/api/generate") ? { ok: true, json: async () => ({}) } : { ok: true, json: async () => ({}) };
  const result = await runT44Probe({ cases: cases.slice(0, 1), repeats: 1, fetchImpl: fake.fetchImpl });
  assert.equal(result.runs[0].cold_start_confirmed, false);
});

test("a resident model cannot confirm cold", async () => {
  const fake = fakeFetchFactory();
  const fetchImpl = async (url, init) => url.endsWith("/api/generate") ? { ok: true, json: async () => ({}) } : url.endsWith("/api/ps") ? { ok: true, json: async () => ({ models: [{ name: "qwen2.5-coder:14b" }] }) } : fake.fetchImpl(url, init);
  const result = await runT44Probe({ cases: cases.slice(0, 1), repeats: 1, fetchImpl });
  assert.equal(result.runs[0].phase, "subsequent_unknown");
});

test("a failed first generation is failed, not warm, when a later call succeeds", async () => {
  const fake = fakeFetchFactory(); let chats = 0;
  const fetchImpl = async (url, init = {}) => {
    if (url.endsWith("/api/generate")) return { ok: true, json: async () => ({}) };
    if (url.endsWith("/api/ps")) return { ok: true, json: async () => ({ models: [] }) };
    chats += 1; if (chats === 1) throw new Error("first failed");
    return fake.fetchImpl(url, init);
  };
  const result = await runT44Probe({ cases: cases.slice(0, 1), repeats: 2, fetchImpl });
  assert.equal(result.runs[0].phase, "failed");
  assert.equal(result.runs[1].phase, "subsequent_unknown");
});

test("hanging unload and ps bodies are aborted by the injected timeout", async () => {
  for (const endpoint of ["/api/generate", "/api/ps"]) {
    const fetchImpl = async (url, init) => {
      if (url.endsWith(endpoint)) return { ok: true, json: () => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(new Error("aborted")))) };
      return { ok: true, json: async () => ({ models: [] }) };
    };
    const result = await runT44Probe({ cases: cases.slice(0, 1), repeats: 1, timeoutMs: 5, fetchImpl });
    assert.ok(result.runs[0].unload_error);
  }
});
