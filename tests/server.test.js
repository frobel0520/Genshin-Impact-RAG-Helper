import assert from "node:assert/strict";
import test from "node:test";

import { createApplication } from "../src/server.js";

test("minimal server exposes a health route", async (t) => {
  const { config, server } = createApplication({ PORT: "0" });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });

  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  assert.equal(typeof address, "object");

  const response = await fetch(`http://127.0.0.1:${address.port}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    service: "genshin-impact-rag-helper",
    status: "ok",
  });
});

test("minimal server returns a structured 404", async (t) => {
  const { config, server } = createApplication({ PORT: "0" });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(config.port, "127.0.0.1", resolve);
  });

  t.after(() => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())));

  const address = server.address();
  const response = await fetch(`http://127.0.0.1:${address.port}/missing`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "not_found",
    message: "The requested route does not exist.",
  });
});
