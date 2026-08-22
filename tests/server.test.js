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

test("minimal server exposes a health route", async (t) => {
  const { config, server } = createApplication({ PORT: "0" });

  await listen(server, config.port);
  t.after(() => closeServer(server));

  const address = server.address();
  assert.ok(address && typeof address === "object");

  const response = await fetch(`http://${LOOPBACK_HOST}:${address.port}${HEALTH_PATH}`);
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
