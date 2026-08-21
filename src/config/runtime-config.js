export const RUNTIME_DEFAULTS = Object.freeze({
  serviceName: "genshin-impact-rag-helper",
  port: 3000,
  ollamaHost: "http://127.0.0.1:11434",
  generationModel: "qwen2.5-coder:14b",
  embeddingModel: "bge-m3:latest",
});

export function loadRuntimeConfig(environment = process.env) {
  const port = parsePort(environment.PORT ?? String(RUNTIME_DEFAULTS.port));
  const ollamaHost = parseOllamaHost(
    environment.OLLAMA_HOST ?? RUNTIME_DEFAULTS.ollamaHost,
  );

  return Object.freeze({
    ...RUNTIME_DEFAULTS,
    port,
    ollamaHost,
  });
}

function parsePort(rawPort) {
  const value = String(rawPort).trim();
  if (!/^\d+$/.test(value)) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 0 || port > 65535) {
    throw new Error("PORT must be an integer between 0 and 65535.");
  }

  return port;
}

function parseOllamaHost(rawHost) {
  const value = String(rawHost).trim();
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error("OLLAMA_HOST must be a valid http or https URL.");
  }

  if (!parsed.hostname || !["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("OLLAMA_HOST must be a valid http or https URL.");
  }

  return parsed.toString().replace(/\/$/, "");
}
