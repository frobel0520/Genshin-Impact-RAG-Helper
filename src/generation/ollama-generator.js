import { ERROR_CODES } from "../domain/domain-contract.js";
import { isRecord, isStableString } from "../domain/contract-validation.js";

export const OLLAMA_CHAT_PATH = "/api/chat";
export const DEFAULT_GENERATION_TIMEOUT_MS = 60_000;

const GENERATOR_OPTION_FIELDS = new Set(["host", "model", "fetchImpl", "timeoutMs", "options"]);

/**
 * Deterministic decoding for the fixed local baseline.
 *
 * The same question over the same dataset must produce the same answer, or an
 * evaluation report describes one run rather than the system. Temperature is
 * therefore zero and the seed fixed; this is a knowledge assistant, not a
 * writing aid.
 */
export const DEFAULT_GENERATION_OPTIONS = Object.freeze({
  temperature: 0,
  seed: 1,
  num_predict: 512,
});

/**
 * Live generation adapter for the fixed `qwen2.5-coder:14b` baseline.
 *
 * Every failure carries a classifiable `code` so the caller can fall back to
 * the deterministic template without parsing an error message.
 *
 * @param {{
 *   host: string,
 *   model: string,
 *   fetchImpl?: Function,
 *   timeoutMs?: number,
 *   options?: object,
 * }} options
 * @returns {{ model: string, host: string, generate: (request: object) => Promise<string> }}
 */
export function createOllamaGenerator(options) {
  const { host, model, fetchImpl, timeoutMs, generationOptions } = validateOptions(options);

  /**
   * @param {{ system: string, prompt: string }} request
   * @returns {Promise<string>} the assistant message content
   */
  async function generate(request) {
    if (!isRecord(request) || !isStableString(request.prompt)) {
      throw new TypeError("A generation request needs a prompt.");
    }

    // The request is bounded: a model that stops responding must not hold the
    // HTTP request open until the client gives up on the whole query.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      let response;
      try {
        response = await fetchImpl(`${host}${OLLAMA_CHAT_PATH}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          signal: controller.signal,
          body: JSON.stringify({
            model,
            stream: false,
            options: generationOptions,
            messages: [
              ...(isStableString(request.system)
                ? [{ role: "system", content: request.system }]
                : []),
              { role: "user", content: request.prompt },
            ],
          }),
        });
      } catch (error) {
        throw failure(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          `Ollama at ${host} could not be reached for generation.`,
          error,
        );
      }

      if (!response.ok) {
        throw failure(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          `Ollama at ${host} answered with HTTP ${response.status}.`,
        );
      }

      // The body is read while the timer is still running. `fetch` resolves as
      // soon as the headers arrive, so clearing the timeout here — which is
      // where it used to be cleared — left the read below with nothing to abort
      // it: a model that answered 200 and then stopped mid-stream held the
      // query open for ever, and the fallback to the template that exists for
      // exactly that failure was never reached.
      let payload;
      try {
        payload = await response.json();
      } catch (error) {
        throw failure(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          `Ollama at ${host} sent a reply that could not be read.`,
          error,
        );
      }

      const content = payload?.message?.content;
      if (!isRecord(payload) || typeof content !== "string") {
        throw failure(
          ERROR_CODES.DEPENDENCY_UNAVAILABLE,
          "Ollama returned a response without an assistant message.",
        );
      }
      return content;
    } finally {
      clearTimeout(timer);
    }
  }

  return Object.freeze({ model, host, generate });
}

function failure(code, message, cause) {
  const error = new Error(message, cause === undefined ? undefined : { cause });
  error.code = code;
  return error;
}

function validateOptions(options) {
  if (!isRecord(options)) {
    throw new TypeError("Ollama generator options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!GENERATOR_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown Ollama generator option: ${field}.`);
    }
  }
  if (!isStableString(options.host)) {
    throw new TypeError("host must be a non-empty string without surrounding whitespace.");
  }
  if (!isStableString(options.model)) {
    throw new TypeError("model must be a non-empty string without surrounding whitespace.");
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function when global fetch is unavailable.");
  }
  const timeoutMs = options.timeoutMs ?? DEFAULT_GENERATION_TIMEOUT_MS;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }
  if (options.options !== undefined && !isRecord(options.options)) {
    throw new TypeError("options must be a plain object of Ollama generation options.");
  }
  return {
    host: options.host,
    model: options.model,
    fetchImpl,
    timeoutMs,
    generationOptions: options.options ?? DEFAULT_GENERATION_OPTIONS,
  };
}
