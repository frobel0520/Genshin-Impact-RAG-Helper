import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";

import { UI_ASSETS, createStaticRoute } from "../src/api/static-assets.js";
import { createApplication } from "../src/server.js";

const LOOPBACK_HOST = "127.0.0.1";
const MISSING_DATASET = {
  PORT: "0",
  STRUCTURED_DB_PATH: "does-not-exist.db",
  DOCUMENT_DB_PATH: "also-missing.db",
};

async function startServer(context) {
  const application = createApplication(MISSING_DATASET);
  await new Promise((resolve, reject) => {
    application.server.once("error", reject);
    application.server.listen(application.config.port, LOOPBACK_HOST, resolve);
  });
  context.after(async () => {
    application.close();
    application.server.closeAllConnections();
    await new Promise((resolve, reject) => {
      application.server.close((error) => (error ? reject(error) : resolve()));
    });
  });
  return `http://${LOOPBACK_HOST}:${application.server.address().port}`;
}

test("the query page and its assets are served with their own content types", async (context) => {
  const base = await startServer(context);

  const page = await fetch(`${base}/`);
  const script = await fetch(`${base}/assets/app.js`);
  const styles = await fetch(`${base}/assets/styles.css`);

  assert.equal(page.status, 200);
  assert.equal(page.headers.get("content-type"), UI_ASSETS["index.html"]);
  assert.match(await page.text(), /原神知識助手/);
  assert.equal(script.headers.get("content-type"), UI_ASSETS["app.js"]);
  assert.equal(styles.headers.get("content-type"), UI_ASSETS["styles.css"]);
});

test("the page is served under a policy that allows only its own origin", async (context) => {
  const base = await startServer(context);

  const page = await fetch(`${base}/`);

  assert.match(page.headers.get("content-security-policy"), /default-src 'none'/);
  assert.match(page.headers.get("content-security-policy"), /connect-src 'self'/);
  assert.equal(page.headers.get("x-content-type-options"), "nosniff");
});

test("only the allowlisted files are reachable", async (context) => {
  const base = await startServer(context);

  const traversal = await fetch(`${base}/assets/..%2F..%2Fpackage.json`);
  const sibling = await fetch(`${base}/assets/.gitkeep`);
  const nested = await fetch(`${base}/assets/sub/app.js`);

  for (const response of [traversal, sibling, nested]) {
    assert.equal(response.status, 404);
    assert.equal((await response.json()).error, "not_found");
  }
});

test("a non-GET request to the page falls through instead of serving it", async (context) => {
  const base = await startServer(context);

  const posted = await fetch(`${base}/`, { method: "POST" });

  assert.equal(posted.status, 404);
});

test("a missing file on disk falls through rather than failing the request", () => {
  const route = createStaticRoute({
    rootDir: "src/ui",
    readFile: () => {
      throw new Error("ENOENT");
    },
  });
  let wrote = false;

  const handled = route(
    { method: "GET", headers: {} },
    {
      writeHead: () => {
        wrote = true;
      },
      end: () => {
        wrote = true;
      },
    },
    "/",
  );

  assert.equal(handled, false);
  assert.equal(wrote, false);
});

test("the served page references only assets the route will serve", () => {
  const page = readFileSync("src/ui/index.html", "utf8");
  const referenced = [...page.matchAll(/\/assets\/([\w.-]+)/g)].map((match) => match[1]);

  assert.ok(referenced.length > 0);
  for (const asset of referenced) {
    assert.ok(Object.hasOwn(UI_ASSETS, asset), `${asset} must be allowlisted`);
  }
});

test("static route options are validated", () => {
  assert.throws(() => createStaticRoute({}), /rootDir/);
  assert.throws(() => createStaticRoute({ rootDir: "src/ui", extra: true }), /Unknown static/);
  assert.throws(() => createStaticRoute({ rootDir: "src/ui", readFile: 1 }), /readFile/);
});
