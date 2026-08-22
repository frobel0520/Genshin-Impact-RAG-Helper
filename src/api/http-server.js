import { createServer } from "node:http";

const LOOPBACK_ORIGIN = "http://127.0.0.1";
const HTTP_METHODS = Object.freeze({ GET: "GET" });
const ROUTES = Object.freeze({ ROOT: "/", HEALTH: "/health" });
const HTTP_STATUS = Object.freeze({ OK: 200, BAD_REQUEST: 400, NOT_FOUND: 404 });
const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

/**
 * @param {{ serviceName: string }} config
 * @returns {import("node:http").Server}
 * @throws {TypeError} when the server configuration is invalid
 */
export function createHttpServer(config) {
  assertServerConfig(config);

  return createServer((request, response) => {
    if (typeof request.url !== "string") {
      sendJson(response, HTTP_STATUS.BAD_REQUEST, {
        error: "invalid_request_url",
        message: "The request URL is required.",
      });
      return;
    }

    const requestUrl = new URL(request.url, LOOPBACK_ORIGIN);

    if (request.method === HTTP_METHODS.GET && requestUrl.pathname === ROUTES.HEALTH) {
      sendJson(response, HTTP_STATUS.OK, {
        status: "ok",
        service: config.serviceName,
      });
      return;
    }

    if (request.method === HTTP_METHODS.GET && requestUrl.pathname === ROUTES.ROOT) {
      sendJson(response, HTTP_STATUS.OK, {
        service: config.serviceName,
        message: "Local-first RAG helper is running.",
      });
      return;
    }

    sendJson(response, HTTP_STATUS.NOT_FOUND, {
      error: "not_found",
      message: "The requested route does not exist.",
    });
  });
}

function assertServerConfig(config) {
  if (
    config === null ||
    typeof config !== "object" ||
    typeof config.serviceName !== "string" ||
    config.serviceName.trim().length === 0
  ) {
    throw new TypeError("config.serviceName must be a non-empty string.");
  }
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, JSON_HEADERS);
  response.end(JSON.stringify(payload));
}
