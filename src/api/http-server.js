import { createServer } from "node:http";

export function createHttpServer(config) {
  return createServer((request, response) => {
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "GET" && requestUrl.pathname === "/health") {
      sendJson(response, 200, {
        status: "ok",
        service: config.serviceName,
      });
      return;
    }

    if (request.method === "GET" && requestUrl.pathname === "/") {
      sendJson(response, 200, {
        service: config.serviceName,
        message: "Local-first RAG helper is running.",
      });
      return;
    }

    sendJson(response, 404, {
      error: "not_found",
      message: "The requested route does not exist.",
    });
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "cache-control": "no-store",
    "content-type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}
