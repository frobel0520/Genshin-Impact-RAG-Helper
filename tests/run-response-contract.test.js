import assert from "node:assert/strict";
import test from "node:test";

import {
  RUN_ARTIFACT_KINDS,
  assertRunResponse,
  classifyErrorCode,
  isRunResponse,
  validateRunResponse,
} from "../src/domain/run-response-contract.js";

const CONTENT_HASH = "a".repeat(64);

function runResponse(overrides = {}) {
  return {
    run_id: "run:ingest-build",
    input_version: "b".repeat(64),
    started_at: "2026-08-28T00:00:00Z",
    finished_at: "2026-08-28T00:00:05Z",
    status: "passed",
    errors: [],
    artifacts: [
      { path: "artifacts/index.db", content_hash: CONTENT_HASH, kind: "document_index" },
    ],
    ...overrides,
  };
}

function codesOf(response) {
  const result = validateRunResponse(response);
  return result.ok ? [] : result.errors.map((error) => error.code);
}

test("a complete run response satisfies the contract", () => {
  const response = runResponse();

  assert.equal(isRunResponse(response), true);
  assert.equal(assertRunResponse(response), response);
});

test("a passed run may not report errors and a failure must report one", () => {
  assert.ok(
    codesOf(
      runResponse({ errors: [{ code: "invalid_request", message: "bad batch" }] }),
    ).includes("passed_forbids_errors"),
  );
  assert.ok(
    codesOf(runResponse({ status: "failed" })).includes("failure_requires_error"),
  );
  assert.ok(
    codesOf(runResponse({ status: "partial" })).includes("failure_requires_error"),
  );
});

test("a run cannot finish before it started", () => {
  assert.ok(
    codesOf(
      runResponse({
        started_at: "2026-08-28T00:00:05Z",
        finished_at: "2026-08-28T00:00:00Z",
      }),
    ).includes("invalid_run_window"),
  );
});

test("errors carry classifiable codes and optional item locators", () => {
  assert.ok(
    codesOf(
      runResponse({
        status: "failed",
        errors: [{ code: "something_went_wrong", message: "nope" }],
      }),
    ).includes("invalid_error_code"),
  );
  assert.ok(
    codesOf(
      runResponse({
        status: "failed",
        errors: [{ code: "invalid_request", message: "nope", source_id: "hoyolab" }],
      }),
    ).includes("invalid_error_source_id"),
  );
  assert.equal(
    isRunResponse(
      runResponse({
        status: "failed",
        errors: [
          {
            code: "invalid_request",
            message: "nope",
            source_id: "src:hoyolab",
            case_id: "case:001",
            path: "documents[0].source_url",
          },
        ],
      }),
    ),
    true,
  );
});

test("artifacts need a known kind and a sha256 content hash", () => {
  assert.ok(
    codesOf(
      runResponse({
        artifacts: [{ path: "x.db", content_hash: "short", kind: RUN_ARTIFACT_KINDS.REPORT }],
      }),
    ).includes("invalid_artifact_content_hash"),
  );
  assert.ok(
    codesOf(
      runResponse({ artifacts: [{ path: "x.db", content_hash: CONTENT_HASH, kind: "database" }] }),
    ).includes("invalid_artifact_kind"),
  );
});

test("unknown and missing fields are both reported", () => {
  const codes = codesOf({ ...runResponse(), extra: true, run_id: undefined });

  assert.ok(codes.includes("unknown_field"));
  assert.ok(codes.includes("missing_required_field"));
});

test("failures are classified by code and type, never by message text", () => {
  const withCode = (code) => Object.assign(new Error("connect failed"), { code });

  assert.equal(classifyErrorCode(withCode("ECONNREFUSED")), "dependency_unavailable");
  assert.equal(classifyErrorCode(withCode("ETIMEDOUT")), "dependency_unavailable");
  assert.equal(classifyErrorCode(withCode("configuration_error")), "configuration_error");
  assert.equal(classifyErrorCode(new TypeError("Invalid SourceDocument.")), "invalid_request");
  assert.equal(classifyErrorCode(new Error("SQLITE_CONSTRAINT")), "internal_error");
  assert.equal(classifyErrorCode(undefined), "internal_error");
});
