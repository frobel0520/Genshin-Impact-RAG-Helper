export const RUNTIME_DEFAULTS = Object.freeze({
  serviceName: "genshin-impact-rag-helper",
  port: 3000,
  ollamaHost: "http://127.0.0.1:11434",
  generationModel: "qwen2.5-coder:14b",
  embeddingModel: "bge-m3:latest",
  structuredDatabasePath: "artifacts/structured.db",
  documentDatabasePath: "artifacts/index.db",
  documentMinScore: 0.35,
});

const MIN_PORT = 0;
const MAX_PORT = 65_535;
const SUPPORTED_OLLAMA_PROTOCOLS = new Set(["http:", "https:"]);
const PORT_ERROR_MESSAGE = `PORT must be an integer between ${MIN_PORT} and ${MAX_PORT}.`;
const OLLAMA_HOST_ERROR_MESSAGE = "OLLAMA_HOST must be a valid http or https URL.";
const ENVIRONMENT_ERROR_MESSAGE = "environment must be a non-array object.";
const DOCUMENT_MIN_SCORE_ERROR_MESSAGE =
  "DOCUMENT_MIN_SCORE must be a number between 0 and 1.";

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
  const structuredDatabasePath = parseDatabasePath(
    environment.STRUCTURED_DB_PATH ?? RUNTIME_DEFAULTS.structuredDatabasePath,
    "STRUCTURED_DB_PATH",
  );
  const documentDatabasePath = parseDatabasePath(
    environment.DOCUMENT_DB_PATH ?? RUNTIME_DEFAULTS.documentDatabasePath,
    "DOCUMENT_DB_PATH",
  );

  const documentMinScore = parseMinScore(
    environment.DOCUMENT_MIN_SCORE ?? String(RUNTIME_DEFAULTS.documentMinScore),
  );

  return Object.freeze({
    ...RUNTIME_DEFAULTS,
    port,
    ollamaHost,
    structuredDatabasePath,
    documentDatabasePath,
    documentMinScore,
  });
}

/**
 * The similarity floor is tuned against a corpus, so it has to be reachable
 * without a code change: the value that is right for two announcements is not
 * the value that is right once genshin-db and Fandom are imported.
 */
function parseMinScore(rawScore) {
  const value = String(rawScore).trim();
  if (!/^\d*\.?\d+$/.test(value)) {
    throw new Error(DOCUMENT_MIN_SCORE_ERROR_MESSAGE);
  }
  const score = Number(value);
  if (!Number.isFinite(score) || score < 0 || score > 1) {
    throw new Error(DOCUMENT_MIN_SCORE_ERROR_MESSAGE);
  }
  return score;
}

function parseDatabasePath(rawPath, variableName) {
  const value = String(rawPath).trim();
  if (value.length === 0) {
    throw new Error(`${variableName} must be a non-empty path.`);
  }
  return value;
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
