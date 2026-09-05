import { randomUUID } from "node:crypto";

import {
  ANSWER_STATUSES,
  ERROR_CODES,
  UNCERTAINTY_REASONS,
  createDomainId,
} from "../domain/domain-contract.js";
import { isRecord } from "../domain/contract-validation.js";
import { classifyErrorCode } from "../domain/run-response-contract.js";
import { formatAnswer } from "../policy/answer-formatter.js";
import { applyConflictVersionPolicy } from "../policy/conflict-version-policy.js";
import { evaluateRefusalScope } from "../policy/refusal-scope-policy.js";
import { createAnswerGenerator } from "../generation/answer-generation.js";
import { readsAsCannotAnswer } from "../generation/answer-grounding.js";
import {
  COVERAGE_VERDICTS,
  createCoverageJudge,
} from "../generation/evidence-coverage.js";
import { createOllamaGenerator } from "../generation/ollama-generator.js";
import { createOllamaEmbedder } from "../ingest/ollama-embedder.js";
import { createEvidenceContentResolver } from "../query/evidence-content.js";
import { createDocumentRetriever } from "../query/document-retrieval.js";
import { createQueryClassifier } from "../query/query-classifier.js";
import { createQueryOrchestrator } from "../query/query-orchestrator.js";
import { validateQueryRequest } from "../query/query-contract.js";
import { createStructuredRetriever } from "../query/structured-retrieval.js";

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

const SERVICE_OPTION_FIELDS = new Set([
  "orchestrator",
  "generateTraceId",
  "logger",
  "composeAnswerText",
  "judgeCoverage",
  "enforceCoverage",
]);

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
  const { orchestrator, generateTraceId, logger, composeAnswerText, judgeCoverage, enforceCoverage } =
    validateServiceOptions(options);

  async function answer(request, providedTraceId) {
    const traceId = providedTraceId ?? generateTraceId();
    const queryId = createDomainId("query", traceId);

    const {
      query_plan: queryPlan,
      bundle,
      game_version: gameVersion,
    } = await orchestrator.run({ queryId, request });
    logger?.logQueryRun({ traceId, queryId, request, queryPlan });

    const policyDecision = applyConflictVersionPolicy({
      bundle,
      versionConstraint: queryPlan.version_constraint,
      ...(gameVersion === undefined ? {} : { gameVersion }),
    });
    const refusalDecision = evaluateRefusalScope({ queryPlan, bundle, policyDecision });
    logger?.logEvidence({ traceId, queryId, bundle, policyDecision });

    // Only an answer is written: a refusal states why it refused, and handing
    // its reason to a model to reword would be the one place a fabrication
    // could reach a reader who was told there was nothing to say. The evidence
    // offered is what the policy stage approved, never the raw bundle.
    // Before an answer exists, ask whether the evidence answers the question at
    // all. The similarity floor cannot tell any more (docs/07-scale-test.md
    // §3.1), and writing prose from evidence that does not address the question
    // produces exactly the failure this product cannot ship: fluent, cited, and
    // about something else. `unknown` answers as before — a check that could not
    // run must not cost the reader an answer.
    const willAnswer = refusalDecision.answer_status !== ANSWER_STATUSES.REFUSED;
    const coverage =
      willAnswer && judgeCoverage !== undefined
        ? await judgeCoverage({
            question: request.question,
            evidenceItems: policyDecision?.applicable_items ?? bundle.items,
            traceId,
            queryId,
          })
        : COVERAGE_VERDICTS.UNKNOWN;
    // Recorded, not enforced — see docs/07-scale-test.md §5. The check is right
    // about the case the similarity floor can no longer catch, and wrong about
    // roughly one answerable question in fifty. Its mistakes are systematic,
    // not noisy: a question about someone's role, answered by evidence that
    // states the role without reusing the question's word for it, is judged NO
    // under both prompts and both seeds tried. A false refusal costs a reader
    // an answer they should have had, so until the judge is better than that,
    // the verdict goes in the log and the answer proceeds. `enforceCoverage`
    // turns it into a gate for anyone who wants to measure the trade.
    const notCovered = coverage === COVERAGE_VERDICTS.NOT_COVERED;
    if (notCovered) {
      logger?.logFailure({
        traceId,
        queryId,
        code: enforceCoverage
          ? "evidence_does_not_cover_question"
          : "evidence_may_not_cover_question",
        message: enforceCoverage
          ? "The coverage check found the approved evidence does not answer the question."
          : "The coverage check thinks the approved evidence does not answer the question. Recorded only; the answer was not withheld.",
      });
    }
    const uncovered = notCovered && enforceCoverage;

    const answerText =
      composeAnswerText === undefined ||
      uncovered ||
      refusalDecision.answer_status === ANSWER_STATUSES.REFUSED
        ? undefined
        : await composeAnswerText({
            question: request.question,
            evidenceItems: policyDecision?.applicable_items ?? bundle.items,
            versionScope: policyDecision?.version_scope,
            traceId,
            queryId,
          });

    // The retrieval floor decides whether a chunk is close enough to the
    // question; nothing decides whether it addresses it. The model, having read
    // both, sometimes says outright that the evidence does not — and reporting
    // that as an answer with a citation behind it is a false claim about what
    // happened, even though the prose itself misleads nobody.
    const modelReportsNoEvidence = readsAsCannotAnswer(answerText);
    const cannotAnswer = uncovered || modelReportsNoEvidence;
    const decision = cannotAnswer
      ? {
          ...refusalDecision,
          answer_status: ANSWER_STATUSES.REFUSED,
          uncertainty_reason: UNCERTAINTY_REASONS.INSUFFICIENT_EVIDENCE,
        }
      : refusalDecision;
    // Only when the model actually said it. An enforced coverage verdict
    // refuses before any answer exists, and recording that under this code as
    // well filed one refusal under two contradictory causes — with the model's
    // words quoted as the literal string "undefined", because it was never
    // asked. The coverage record above is the one that describes what happened.
    if (modelReportsNoEvidence) {
      logger?.logFailure({
        traceId,
        queryId,
        code: "model_reports_no_evidence",
        message: `The model reported the evidence does not answer the question: ${answerText}`,
      });
    }

    const response = formatAnswer({
      queryPlan,
      bundle,
      policyDecision,
      refusalDecision: decision,
      traceId,
      ...(answerText === undefined || cannotAnswer ? {} : { answerText }),
    });
    logger?.logAnswerRun({ traceId, queryId, answer: response, refusalDecision: decision });
    return response;
  }

  /**
   * A failure carries the trace it failed under, so the answer that never came
   * back can still be looked up beside the records the run did write.
   */
  async function answerWithTrace(request) {
    const traceId = generateTraceId();
    try {
      return await answer(request, traceId);
    } catch (error) {
      if (error !== null && typeof error === "object" && error.traceId === undefined) {
        error.traceId = traceId;
      }
      throw error;
    }
  }

  return Object.freeze({ answer: answerWithTrace });
}

/**
 * Assemble the query service that answers from a built dataset.
 *
 * Both the server and the evaluation runner need the same pipeline over the
 * same stores; building it twice would risk evaluating something other than
 * what the API serves.
 *
 * @param {{ config: object, structuredStore: object, documentStore: object, logger?: object }} options
 * @returns {{ answer: (request: object) => Promise<object> }}
 */
export function createQueryServiceForStores(options) {
  if (
    !isRecord(options) ||
    !isRecord(options.config) ||
    typeof options.structuredStore?.listCanonicalEntities !== "function" ||
    typeof options.documentStore?.getIndexManifest !== "function"
  ) {
    throw new TypeError("config, structuredStore, and documentStore are required.");
  }
  const { config, structuredStore, documentStore, logger } = options;
  const embedder = createOllamaEmbedder({
    host: config.ollamaHost,
    model: config.embeddingModel,
  });

  const contentResolver = createEvidenceContentResolver({ structuredStore, documentStore });
  // One extra model call per answered query, before the answer exists: the
  // similarity floor stopped separating answerable questions from unanswerable
  // ones once the corpus grew (docs/07-scale-test.md §3.1), and reading is what
  // still separates them.
  const coverage = createCoverageJudge({
    ...(logger === undefined ? {} : { logger }),
    chat: createOllamaGenerator({
      host: config.ollamaHost,
      model: config.generationModel,
    }).generate,
  });
  const generator = createAnswerGenerator({
    ...(logger === undefined ? {} : { logger }),
    generate: createOllamaGenerator({
      host: config.ollamaHost,
      model: config.generationModel,
    }).generate,
  });

  return createQueryService({
    ...(logger === undefined ? {} : { logger }),
    enforceCoverage: config.enforceCoverage === true,
    judgeCoverage: async ({ question, evidenceItems, traceId, queryId }) =>
      coverage.judge({
        question,
        contents: contentResolver.resolve(evidenceItems),
        traceId,
        queryId,
      }),
    composeAnswerText: ({ question, evidenceItems, versionScope, traceId, queryId }) =>
      generator.composeAnswerText({
        question,
        contents: contentResolver.resolve(evidenceItems),
        ...(versionScope === undefined ? {} : { versionScope }),
        traceId,
        queryId,
      }),
    orchestrator: createQueryOrchestrator({
      classifier: createQueryClassifier({
        canonicalEntities: structuredStore.listCanonicalEntities(),
      }),
      structuredRetriever: createStructuredRetriever({ store: structuredStore }),
      documentRetriever: createDocumentRetriever({
        store: documentStore,
        minScore: config.documentMinScore,
        // The retriever is built once, before any query exists, so it reports
        // the query it filtered rather than the trace. The query ID is minted
        // from the trace ID, which is what makes the record findable alongside
        // the rest of the run.
        onBelowThreshold: ({ queryId, considered, kept, bestScore, minScore }) => {
          logger?.logRetrievalFiltered({
            traceId: queryId.slice(queryId.indexOf(":") + 1),
            queryId,
            considered,
            kept,
            bestScore,
            minScore,
          });
        },
        embedQuery: async (question) => {
          const [vector] = await embedder.embedDocuments([question], {
            model: config.embeddingModel,
            dimensions: documentStore.getIndexManifest().embedding_dimensions,
          });
          return vector;
        },
      }),
    }),
  });
}

/**
 * Create the `POST /api/v1/query` handler.
 *
 * @param {{
 *   service: { answer: (request: object) => Promise<object> },
 *   logger?: object,
 *   generateTraceId?: () => string,
 * }} options
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
  const { service, logger } = options;
  const generateTraceId = options.generateTraceId ?? (() => randomUUID());

  return async function handleQuery(request, response) {
    // Every request gets a trace before anything can go wrong with it, so a
    // rejection is as traceable as an answer.
    const requestTraceId = generateTraceId();
    const reject = (statusCode, error) => {
      logger?.logRequestRejected({
        traceId: requestTraceId,
        statusCode,
        code: error.code,
        message: error.message,
      });
      sendError(response, statusCode, { ...error, traceId: requestTraceId });
    };

    if (request.method !== QUERY_API_RULES.method) {
      reject(HTTP_STATUS.METHOD_NOT_ALLOWED, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: `${QUERY_API_ROUTE} accepts POST only.`,
      });
      return;
    }
    if (!isJsonContentType(request.headers["content-type"])) {
      reject(HTTP_STATUS.UNSUPPORTED_MEDIA_TYPE, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: "Content-Type must be application/json.",
      });
      return;
    }

    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      reject(error.statusCode ?? HTTP_STATUS.BAD_REQUEST, {
        code: ERROR_CODES.INVALID_REQUEST,
        message: error.publicMessage ?? "The request body could not be read as JSON.",
      });
      return;
    }

    const validation = validateQueryRequest(body);
    if (!validation.ok) {
      reject(HTTP_STATUS.BAD_REQUEST, {
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
      // The player never sees an internal message: only a classifiable code and
      // the trace the failure happened under.
      const traceId = error?.traceId ?? requestTraceId;
      const code = classifyErrorCode(error);
      logger?.logFailure({
        traceId,
        code,
        message: error instanceof Error ? error.message : "unknown failure",
      });
      sendError(response, HTTP_STATUS.INTERNAL_SERVER_ERROR, {
        code,
        message: "The query could not be completed because of an internal failure.",
        traceId,
        systemFailure: true,
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
  if (options.logger !== undefined && typeof options.logger.logAnswerRun !== "function") {
    throw new TypeError("logger must be a run logger when provided.");
  }
  if (options.composeAnswerText !== undefined && typeof options.composeAnswerText !== "function") {
    throw new TypeError("composeAnswerText must be a function when provided.");
  }
  if (options.judgeCoverage !== undefined && typeof options.judgeCoverage !== "function") {
    throw new TypeError("judgeCoverage must be a function when provided.");
  }
  if (options.enforceCoverage !== undefined && typeof options.enforceCoverage !== "boolean") {
    throw new TypeError("enforceCoverage must be a boolean when provided.");
  }
  return {
    orchestrator: options.orchestrator,
    generateTraceId: options.generateTraceId ?? (() => randomUUID()),
    logger: options.logger,
    composeAnswerText: options.composeAnswerText,
    judgeCoverage: options.judgeCoverage,
    enforceCoverage: options.enforceCoverage === true,
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

/**
 * `answer_status: "error"` marks a system failure only. A malformed request is
 * not a broken helper, so a 4xx says what was wrong with the request without
 * claiming the system failed. Both carry the trace they happened under.
 */
function sendError(response, statusCode, { code, message, details, traceId, systemFailure }) {
  sendJson(response, statusCode, {
    ...(systemFailure === true ? { answer_status: ANSWER_STATUSES.ERROR } : {}),
    error: { code, message, ...(details === undefined ? {} : { details }) },
    trace_id: traceId,
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
