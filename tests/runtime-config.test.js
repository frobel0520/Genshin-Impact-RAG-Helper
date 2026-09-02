import assert from "node:assert/strict";
import test from "node:test";

import {
  RUNTIME_DEFAULTS,
  loadRuntimeConfig,
} from "../src/config/runtime-config.js";

test("runtime config uses the fixed local-first defaults", () => {
  const config = loadRuntimeConfig({});

  assert.equal(config.serviceName, RUNTIME_DEFAULTS.serviceName);
  assert.equal(config.port, RUNTIME_DEFAULTS.port);
  assert.equal(config.ollamaHost, RUNTIME_DEFAULTS.ollamaHost);
  assert.equal(config.generationModel, RUNTIME_DEFAULTS.generationModel);
  assert.equal(config.embeddingModel, RUNTIME_DEFAULTS.embeddingModel);
});

test("runtime config accepts an explicit local port and Ollama host", () => {
  const config = loadRuntimeConfig({
    OLLAMA_HOST: "http://localhost:11434/",
    PORT: "4317",
  });

  assert.equal(config.port, 4317);
  assert.equal(config.ollamaHost, "http://localhost:11434");
});

test("runtime config rejects invalid ports and Ollama hosts", () => {
  assert.throws(
    () => loadRuntimeConfig(null),
    /environment must be a non-array object/,
  );
  assert.throws(
    () => loadRuntimeConfig({ PORT: "not-a-port" }),
    /PORT must be an integer/,
  );
  assert.throws(
    () => loadRuntimeConfig({ OLLAMA_HOST: "ftp://localhost:11434" }),
    /OLLAMA_HOST must be a valid http or https URL/,
  );
});

test("the document similarity floor is configurable and defaults to a value", () => {
  assert.equal(loadRuntimeConfig({}).documentMinScore, 0.42);
  assert.equal(loadRuntimeConfig({ DOCUMENT_MIN_SCORE: "0" }).documentMinScore, 0);
  assert.equal(loadRuntimeConfig({ DOCUMENT_MIN_SCORE: "0.62" }).documentMinScore, 0.62);
  assert.equal(loadRuntimeConfig({ DOCUMENT_MIN_SCORE: "1" }).documentMinScore, 1);
});

test("an unusable document similarity floor is rejected rather than rounded", () => {
  for (const value of ["-0.1", "1.5", "high", "", "0.5x"]) {
    assert.throws(
      () => loadRuntimeConfig({ DOCUMENT_MIN_SCORE: value }),
      /DOCUMENT_MIN_SCORE must be a number between 0 and 1/,
      `DOCUMENT_MIN_SCORE=${value} must be refused`,
    );
  }
});
