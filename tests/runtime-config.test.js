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
