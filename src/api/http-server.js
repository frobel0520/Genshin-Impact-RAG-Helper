import { createServer } from "node:http";

import { HEALTH_API_ROUTE } from "./health-api.js";
import { QUERY_API_ROUTE } from "./query-api.js";

const LOOPBACK_ORIGIN = "http://127.0.0.1";
const HTTP_METHODS = Object.freeze({ GET: "GET" });
const ROUTES = Object.freeze({ ROOT: "/", HEALTH: "/health" });
const HTTP_STATUS = Object.freeze({ OK: 200, BAD_REQUEST: 400, NOT_FOUND: 404 });
const JSON_HEADERS = Object.freeze({
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
});

/**
 * The query route is injected because it needs a built structured store and a
 * built fixed index, which only exist after an ingest run. Without it the route
 * is simply not mounted, so the server can still start and report its health.
 * The health route is injected the same way; without it the server falls back
 * to a liveness-only answer.
 *
 * @param {{ serviceName: string }} config
 * @param {{ queryHandler?: Function, healthHandler?: Function, staticHandler?: Function }} [routes]
 * @returns {import("node:http").Server}
 * @throws {TypeError} when the server configuration is invalid
 */
export function createHttpServer(config, routes = {}) {
  assertServerConfig(config);
  const { queryHandler, healthHandler, staticHandler } = assertRoutes(routes);

  return createServer((request, response) => {
    if (typeof request.url !== "string") {
      sendJson(response, HTTP_STATUS.BAD_REQUEST, {
        error: "invalid_request_url",
        message: "The request URL is required.",
      });
      return;
    }

    const requestUrl = new URL(request.url, LOOPBACK_ORIGIN);

    if (queryHandler !== undefined && requestUrl.pathname === QUERY_API_ROUTE) {
      queryHandler(request, response);
      return;
    }

    if (staticHandler !== undefined && staticHandler(request, response, requestUrl.pathname)) {
      return;
    }

    if (healthHandler !== undefined && requestUrl.pathname === HEALTH_API_ROUTE) {
      healthHandler(request, response);
      return;
    }

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

function assertRoutes(routes) {
  if (routes === null || typeof routes !== "object") {
    throw new TypeError("routes must be a plain object.");
  }
  for (const field of Object.keys(routes)) {
    if (!["queryHandler", "healthHandler", "staticHandler"].includes(field)) {
      throw new TypeError(`Unknown route option: ${field}.`);
    }
  }
  for (const field of ["queryHandler", "healthHandler", "staticHandler"]) {
    if (routes[field] !== undefined && typeof routes[field] !== "function") {
      throw new TypeError(`${field} must be a function when provided.`);
    }
  }
  return {
    queryHandler: routes.queryHandler,
    healthHandler: routes.healthHandler,
    staticHandler: routes.staticHandler,
  };
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
