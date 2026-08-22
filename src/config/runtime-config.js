export const RUNTIME_DEFAULTS = Object.freeze({
  serviceName: "genshin-impact-rag-helper",
  port: 3000,
  ollamaHost: "http://127.0.0.1:11434",
  generationModel: "qwen2.5-coder:14b",
  embeddingModel: "bge-m3:latest",
});

const MIN_PORT = 0;
const MAX_PORT = 65_535;
const SUPPORTED_OLLAMA_PROTOCOLS = new Set(["http:", "https:"]);
const PORT_ERROR_MESSAGE = `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}.`;
const OLLAMA_HOST_ERROR_MESSAGE = "OLLAMA_HOST must be a valid http or https URL.";
const ENVIRONMENT_ERROR_MESSAGE = "environment must be a non-array object.";

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {Readonly<typeof RUNTIME_DEFAULTS> & { port: number, ollamaHost: string }}
 */
export function loadRuntimeConfig(environment = process.env) {
  if (environment === null || typeof environment !== "object" || Array.isArray(environment)) {
    throw new TypeError(ENVIRONMENT_ERROR_MESSAGE);
  }

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
    throw new Error(PORT_ERROR_MESSAGE);
  }

  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < MIN_PORT || port > MAX_PORT) {
    throw new Error(PORT_ERROR_MESSAGE);
  }

  return port;
}

function parseOllamaHost(rawHost) {
  const value = String(rawHost).trim();
  let parsed;

  try {
    parsed = new URL(value);
  } catch {
    throw new Error(OLLAMA_HOST_ERROR_MESSAGE);
  }

  if (!parsed.hostname || !SUPPORTED_OLLAMA_PROTOCOLS.has(parsed.protocol)) {
    throw new Error(OLLAMA_HOST_ERROR_MESSAGE);
  }

  return parsed.toString().replace(/\/$/, "");
}
