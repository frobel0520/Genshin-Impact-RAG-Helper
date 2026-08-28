import assert from "node:assert/strict";
import test from "node:test";

import { createHttpServer } from "../src/api/http-server.js";
import { RUNTIME_DEFAULTS } from "../src/config/runtime-config.js";
import { createApplication } from "../src/server.js";

const LOOPBACK_HOST = "127.0.0.1";
const HEALTH_PATH = "/health";
const MISSING_PATH = "/missing";

test("HTTP server rejects an invalid configuration boundary", () => {
  assert.throws(
    () => createHttpServer({ serviceName: "   " }),
    /config\.serviceName must be a non-empty string/,
  );
});

test("the server reports its readiness on the health route", async (t) => {
  const { config, server } = createApplication({
    PORT: "0",
    STRUCTURED_DB_PATH: "does-not-exist.db",
    DOCUMENT_DB_PATH: "also-missing.db",
  });

  await listen(server, config.port);
  t.after(() => closeServer(server));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://${LOOPBACK_HOST}:${address.port}${HEALTH_PATH}`);
  assert.equal(response.status, 200);

  // Started without an ingested dataset, the server is live but not ready, and
  // it says so rather than reporting a bare "ok".
  const payload = await response.json();
  assert.equal(payload.service, RUNTIME_DEFAULTS.serviceName);
  assert.equal(payload.status, "degraded");
  assert.equal(payload.dataset.state, "missing");
});

test("a server with no injected health route still answers a liveness check", async (t) => {
  const server = createHttpServer({ serviceName: RUNTIME_DEFAULTS.serviceName });

  await listen(server, 0);
  t.after(() => closeServer(server));

  const response = await fetch(`http://${LOOPBACK_HOST}:${server.address().port}${HEALTH_PATH}`);

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: RUNTIME_DEFAULTS.serviceName,
    status: "ok",
  });
});

test("minimal server returns a structured 404", async (t) => {
  const { config, server } = createApplication({ PORT: "0" });

  await listen(server, config.port);
  t.after(() => closeServer(server));

  const address = server.address();
  assert.ok(address && typeof address === "object");
  const response = await fetch(`http://${LOOPBACK_HOST}:${address.port}${MISSING_PATH}`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "not_found",
    message: "The requested route does not exist.",
  });
});

function listen(server, port) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, LOOPBACK_HOST, resolve);
  });
}

function closeServer(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}
