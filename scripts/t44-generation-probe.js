import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildGenerationPrompt, ANSWER_GENERATION_SYSTEM_PROMPT, createAnswerGenerator } from "../src/generation/answer-generation.js";
import { DEFAULT_GENERATION_OPTIONS, createOllamaGenerator } from "../src/generation/ollama-generator.js";
import { selectOverviewSections } from "../src/query/section-importance.js";

const DEFAULT_HOST = "http://127.0.0.1:11434";
const DEFAULT_MODEL = "qwen2.5-coder:14b";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_REPEATS = 3;
const OUTPUT_PATH = "artifacts/t44-generation-probe.json";

export function loadT44Cases() {
  const evalCases = JSON.parse(readFileSync(resolve(process.cwd(), "evaluation/eval-cases.json"), "utf8"));
  const pack = JSON.parse(readFileSync(resolve(process.cwd(), "artifacts/source-pack.json"), "utf8"));
  return Object.freeze(evalCases.cases.filter((entry) => ["case:version-5-0-changes", "case:version-5-4-changes"].includes(entry.case_id)).map((entry) => {
    const version = entry.game_version;
    const source = pack.source_documents.find((candidate) => candidate.game_version === version);
    const chunks = pack.document_chunks.filter((entry) => entry.source_id === source.source_id);
    const selected = selectOverviewSections(chunks, entry.question_zh_tw);
    return { id: entry.case_id, question: entry.question_zh_tw, versionScope: version, dataset_version: evalCases.dataset_version, contents: selected.map((chunk) => ({ evidence_id: chunk.chunk_id, source_kind: source.source_kind, source_title: source.source_title ?? source.title ?? source.source_url ?? source.source_id, text: chunk.text })) };
  }));
}

export function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

async function unloadAndConfirm(fetchImpl, host, model, timeoutMs) {
  const { response: unloadResponse } = await boundedJson(fetchImpl, `${host}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, prompt: "", keep_alive: 0, stream: false }) }, timeoutMs);
  if (!unloadResponse.ok) throw new Error(`Ollama unload answered with HTTP ${unloadResponse.status}.`);
  const { response: psResponse, payload: ps } = await boundedJson(fetchImpl, `${host}/api/ps`, undefined, timeoutMs);
  if (!psResponse.ok) throw new Error(`Ollama ps answered with HTTP ${psResponse.status}.`);
  if (!Array.isArray(ps.models)) throw new Error("Ollama ps response did not include models; unload cannot be confirmed.");
  const loaded = ps.models.some((entry) => entry?.name === model || entry?.model === model);
  return { unload_requested: true, model_loaded_after_unload: loaded, cold_start_confirmed: !loaded };
}

async function boundedJson(fetchImpl, url, init, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try { const response = await fetchImpl(url, { ...init, signal: controller.signal }); return { response, payload: await response.json() }; } finally { clearTimeout(timer); }
}

export async function runT44Probe({ cases, host = DEFAULT_HOST, model = DEFAULT_MODEL, repeats = DEFAULT_REPEATS, timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch, now = () => new Date().toISOString() } = {}) {
  if (!Array.isArray(cases) || cases.length === 0) throw new TypeError("cases must be a non-empty array.");
  if (!Number.isInteger(repeats) || repeats < 1 || repeats > 3) throw new TypeError("repeats must be an integer from 1 to 3.");
  const runs = [];
  for (const testCase of cases) {
    const prompt = buildGenerationPrompt(testCase);
    const promptHash = sha256(prompt);
    const systemHash = sha256(ANSWER_GENERATION_SYSTEM_PROMPT);
    let unload;
    try {
      unload = await unloadAndConfirm(fetchImpl, host, model, timeoutMs);
    } catch (error) {
      runs.push({ case_id: testCase.id, prompt_sha256: promptHash, system_sha256: systemHash, cold_start_confirmed: false, unload_error: serializeError(error), measurements: [] });
      continue;
    }
    for (let index = 0; index < repeats; index += 1) {
      const startedAt = now();
      const started = performance.now();
      let output;
      let composerResult;
      let fallbackRecords = [];
      let error;
      let ollama;
      try {
        let rawPayload;
        const observedFetch = async (url, init) => {
          const response = await fetchImpl(url, init);
          const payload = await response.clone().json();
          rawPayload = payload;
          return response;
        };
        const observed = createOllamaGenerator({ host, model, timeoutMs, fetchImpl: observedFetch, options: DEFAULT_GENERATION_OPTIONS });
        output = await observed.generate({ system: ANSWER_GENERATION_SYSTEM_PROMPT, prompt });
        const failures = [];
        composerResult = await createAnswerGenerator({ logger: { logFailure: (record) => failures.push(record) }, generate: async () => output }).composeAnswerText({ ...testCase, traceId: `${testCase.id}:${index + 1}` });
        fallbackRecords = failures;
        ollama = selectTiming(rawPayload);
      } catch (caught) { error = serializeError(caught); }
      const phase = error ? "failed" : index === 0 && unload.cold_start_confirmed ? "cold_after_confirmed_unload" : "subsequent_unknown";
      runs.push({ case_id: testCase.id, prompt_sha256: promptHash, system_sha256: systemHash, repeat: index + 1, phase, started_at: startedAt, duration_ms: Math.round(performance.now() - started), cold_start_confirmed: index === 0 && unload.cold_start_confirmed, raw_output: output ?? null, output_sha256: typeof output === "string" ? sha256(output) : null, composer_result: typeof composerResult === "string" ? composerResult : null, fallback_records: fallbackRecords, ollama_timing: ollama ?? null, error });
    }
  }
  return { schema_version: 1, generated_at: now(), host, model, timeout_ms: timeoutMs, repeats, generation_options: DEFAULT_GENERATION_OPTIONS, system_prompt: ANSWER_GENERATION_SYSTEM_PROMPT, cases: cases.map(({ id, question, versionScope, dataset_version, contents }) => ({ id, question, version_scope: versionScope, dataset_version, prompt: buildGenerationPrompt({ question, contents, versionScope }), evidence: contents })), runs };
}

function selectTiming(payload) {
  if (!payload || typeof payload !== "object") return null;
  return Object.fromEntries(["total_duration", "load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration"].filter((key) => payload[key] !== undefined).map((key) => [key, payload[key]]));
}
function serializeError(error) { return { name: error?.name ?? "Error", code: error?.code ?? null, message: error?.message ?? String(error) }; }

if (process.argv[1]?.endsWith("t44-generation-probe.js")) {
  const result = await runT44Probe({ cases: loadT44Cases(), repeats: Number(process.env.T44_REPEATS ?? DEFAULT_REPEATS) });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  const errors = result.runs.filter((run) => run.error || run.unload_error).length;
  console.log(JSON.stringify({ path: OUTPUT_PATH, runs: result.runs.length, errors }));
  if (errors > 0) process.exitCode = 1;
}
