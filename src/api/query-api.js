import { randomUUID } from "node:crypto";

import { ANSWER_STATUSES, ERROR_CODES, createDomainId } from "../domain/domain-contract.js";
import { classifyErrorCode } from "../domain/run-response-contract.js";
import { formatAnswer } from "../policy/answer-formatter.js";
import { applyConflictVersionPolicy } from "../policy/conflict-version-policy.js";
import { evaluateRefusalScope } from "../policy/refusal-scope-policy.js";
import { validateQueryRequest } from "../query/query-contract.js";

export const QUERY_API_ROUTE = "/api/v1/query";
export const QUERY_API_MAX_BODY_BYTES = 16 * 1024;

export const HTTP_STATUS = Object.freeze({
  OK: 200,
  BAD_REQUEST: 400,
  METHOD_NOT_ALLOWED: 405,
  UNSUPPORTED_MEDIA_TYPE: 415,
  PAYLOAD_TOO_LARGE: 413,
  INTERNAL_SERVER_ERROR: 500,
});

/**
 * Query API contract.
 *
 * A refusal is a successful answer, not a transport failure, so `answered`,
 * `uncertain`, and `refused` all return 200 with an `AnswerResponse`. Only a
 * genuine system failure produces `answer_status: "error"`, and it is reported
 * through the error envelope with a classifiable code — never a stack trace,
 * and never a data refusal dressed up as a failure.
 */
export const QUERY_API_RULES = Object.freeze({
  route: QUERY_API_ROUTE,
  method: "POST",
  refusalIsHttpOk: true,
  errorMeansSystemFailure: true,
  exposesInternalIds: false,
  maxBodyBytes: QUERY_API_MAX_BODY_BYTES,
});

const SERVICE_OPTION_FIELDS = new Set(["orchestrator", "generateTraceId"]);

/**
 * Assemble the query pipeline: T21 orchestration, then the T18 version and
 * conflict rules, the T19 refusal rules, and the T20 projection.
 *
 * This is the layer that owns the wiring, because module boundaries keep the
 * query layer from importing policy: the orchestrator retrieves, the policies
 * decide, the formatter projects, and only the API knows about all three.
 *
 * @param {{
 *   orchestrator: { run: (request: object) => Promise<object> },
 *   generateTraceId?: () => string,
 * }} options
 * @returns {{ answer: (request: object) => Promise<object> }}
 */
export function createQueryService(options) {
  const { orchestrator, generateTraceId } = validateServiceOptions(options);

  async function answer(request) {
    const traceId = generateTraceId();
    const queryId = createDomainId("query", traceId);

    const {
      query_plan: queryPlan,
      bundle,
      game_version: gameVersion,
    } = await orchestrator.run({ queryId, request });
    const policyDecision = applyConflictVersionPolicy({
      bundle,
      versionConstraint: queryPlan.version_constraint,
      ...(gameVersion === undefined ? {} : { gameVersion }),
    });
    const refusalDecision = evaluateRefusalScope({ queryPlan, bundle, policyDecision });

    return formatAnswer({
      queryPlan,
      bundle,
      policyDecision,
      refusalDecision,
      traceId,
    });
  }

  return Object.freeze({ answer });
}

/**
 * Create the `POST /api/v1/query` handler.
 *
 * @param {{ service: { answer: (request: object) => Promise<object> } }} options
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse) => Promise<void>}
 */
export function createQueryRoute(options) {
  if (
    options === null ||
    typeof options !== "object" ||
    typeof options.service?.answer !== "function"
  ) {
    throw new TypeError("service must expose answer().");
  }
  const { service } = options;

  return async function handleQuery(request, response) {
    if (request.method !== QUERY_API_RULES.method) {
      sendError(response, HTTP_STATUS.METHOD_NOT_ALLOWED, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `${QUERY_API_ROUTE} accepts POST only.`,
      });
      return;
    }
    if (!isJsonContentType(request.headers["content-type"])) {
      sendError(response, HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "Content-Type must be application/json.",
      });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendError(response, error.statusCode ?? HTTP_STATUS.BAD_REQUEST, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: error.publicMessage ?? "The request body could not be read as JSON.",
      });
      return;
    }

    const validation = validateQueryRequest(body);
    if (!validation.ok) {
      sendError(response, HTTP_STATUS.BAD_REQUEST, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "The request does not satisfy the QueryRequest contract.",
        details: validation.errors.map((error) => ({
          code: error.code,
          field: error.path,
        })),
      });
      return;
    }

    try {
      sendJson(response, HTTP_STATUS.OK, await service.answer(body));
    } catch (error) {
      // The player never sees an internal message: only a classifiable code.
      sendError(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
        code: classifyErrorCode(error),
        message: "The query could not be completed because of an internal failure.",
      });
    }
  };
}

function validateServiceOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Query service options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (!SERVICE_OPTION_FIELDS.has(field)) {
      throw new TypeError(`Unknown query service option: ${field}.`);
    }
  }
  if (typeof options.orchestrator?.run !== "function") {
    throw new TypeError("orchestrator must expose run().");
  }
  if (options.generateTraceId !== undefined && typeof options.generateTraceId !== "function") {
    throw new TypeError("generateTraceId must be a function when provided.");
  }
  return {
    orchestrator: options.orchestrator,
    generateTraceId: options.generateTraceId ?? (() => randomUUID()),
  };
}

function isJsonContentType(contentType) {
  return (
    typeof contentType === "string" &&
    contentType.split(";")[0].trim().toLowerCase() === "application/json"
  );
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;

    request.on("data", (chunk) => {
      if (rejected) {
        return;
      }
      size += chunk.length;
      if (size > QUERY_API_MAX_BODY_BYTES) {
        rejected = true;
        chunks.length = 0;
        // Drain instead of destroying the socket: the client must still be able
        // to read the 413 answer rather than see the connection disappear.
        request.resume();
        reject(
          createTransportError(
            HTTP_STATUS.PAYLOAD_TOO_LARGE,
            `The request body must not exceed ${QUERY_API_MAX_BODY_BYTES} bytes.`,
          ),
        );
        return;
      }
      chunks.push(chunk);
    });
    request.on("error", () =>
      reject(createTransportError(HTTP_STATUS.BAD_REQUEST, "The request body could not be read.")),
    );
    request.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(
          createTransportError(HTTP_STATUS.BAD_REQUEST, "The request body must be valid JSON."),
        );
      }
    });
  });
}

function createTransportError(statusCode, publicMessage) {
  const error = new Error(publicMessage);
  error.statusCode = statusCode;
  error.publicMessage = publicMessage;
  return error;
}

function sendError(response, statusCode, { code, message, details }) {
  sendJson(response, statusCode, {
    answer_status: ANSWER_STATUSES.ERROR,
    error: { code, message, ...(details === undefined ? {} : { details }) },
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
