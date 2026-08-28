import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { createHealthReporter, createHealthRoute } from "./api/health-api.js";
import { createHttpServer } from "./api/http-server.js";
import { createQueryRoute, createQueryServiceForStores } from "./api/query-api.js";
import { createStaticRoute } from "./api/static-assets.js";
import { createJsonLineLogger } from "./observability/run-log-adapter.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";
import { createDocumentStore } from "./data/document-store.js";
import { createStructuredStore } from "./data/structured-store.js";

const LOOPBACK_HOST = "127.0.0.1";

/**
 * @typedef {{
 *   serviceName: string,
 *   port: number,
 *   ollamaHost: string,
 *   generationModel: string,
 *   embeddingModel: string,
 * }} RuntimeConfig
 */

/**
 * @typedef {{
 *   config: Readonly<RuntimeConfig>,
 *   server: import("node:http").Server,
 * }} Application
 */

/**
 * Compose the application from whatever an ingest run has left on disk.
 *
 * The stores are opened only when their database files already exist: opening
 * a missing SQLite path would create an empty database, and an empty index that
 * looks present is exactly the state health reporting exists to expose. Without
 * data the server still starts, reports `degraded`, and mounts no query route,
 * because a query it cannot answer with evidence is worse than a missing route.
 *
 * @param {Record<string, string | undefined>} environment
 * @param {{ queryHandler?: Function, healthHandler?: Function }} [routes]
 *   explicit routes, used by tests and by callers that build their own stores
 * @returns {Application}
 */
export function createApplication(environment = process.env, routes = {}) {
  const config = loadRuntimeConfig(environment);
  const { stores, storeFailures } = openExistingStores(config);
  const reporter = createHealthReporter({ config, ...stores, storeFailures });
  const composed = {
    healthHandler: createHealthRoute({ reporter }),
    staticHandler: createStaticRoute({
      rootDir: resolve(dirname(fileURLToPath(import.meta.url)), "ui"),
    }),
    ...(createQueryHandler(config, stores, reporter) ?? {}),
    ...routes,
  };
  const server = createHttpServer(config, composed);

  return Object.freeze({
    config,
    server,
    health: reporter,
    ...stores,
    close: () => closeStores(stores),
  });
}

/**
 * A database that exists but cannot be opened — corrupt, half-written, or from
 * an incompatible schema — is reported, not thrown. The one broken state health
 * could never describe is the one that stops the process from starting.
 */
function openExistingStores(config) {
  const stores = {};
  const storeFailures = {};

  if (existsSync(resolve(config.structuredDatabasePath))) {
    try {
      stores.structuredStore = createStructuredStore({
        databasePath: config.structuredDatabasePath,
      });
    } catch (error) {
      storeFailures.structured = describeStoreFailure(config.structuredDatabasePath, error);
    }
  }
  if (existsSync(resolve(config.documentDatabasePath))) {
    try {
      stores.documentStore = createDocumentStore({ databasePath: config.documentDatabasePath });
    } catch (error) {
      storeFailures.document = describeStoreFailure(config.documentDatabasePath, error);
    }
  }
  return { stores, storeFailures };
}

function describeStoreFailure(path, error) {
  const detail = error instanceof Error ? error.message : "unknown error";
  logError("store_unreadable", { path, error: detail });
  return `${path} could not be opened: ${detail}`;
}

function createQueryHandler(config, { structuredStore, documentStore }, reporter) {
  if (reporter.report().status !== "ok") {
    return undefined;
  }

  // One JSON object per line on stdout: greppable by trace_id, and nothing to
  // rotate or clean up beyond what the operator already redirects.
  const logger = createJsonLineLogger({ write: (line) => process.stdout.write(line) });
  const service = createQueryServiceForStores({
    config,
    structuredStore,
    documentStore,
    logger,
  });
  return { queryHandler: createQueryRoute({ service, logger }) };
}

function closeStores({ structuredStore, documentStore }) {
  for (const store of [structuredStore, documentStore]) {
    if (store !== undefined && store.getStatus().isOpen) {
      store.close();
    }
  }
}

/**
 * @param {Record<string, string | undefined>} environment
 * @param {{ queryHandler?: Function }} [routes]
 * @returns {Application}
 */
export function startServer(environment = process.env, routes = {}) {
  const application = createApplication(environment, routes);

  application.server.listen(
    application.config.port,
    LOOPBACK_HOST,
    () => {
      const address = application.server.address();
      const port = getListeningPort(address, application.config.port);
      logInfo("server_listening", {
        url: `http://${LOOPBACK_HOST}:${port}`,
      });
    },
  );

  registerShutdown(application.server);
  return application;
}

function registerShutdown(server) {
  const shutdown = (signal) => {
    server.close((error) => {
      if (error) {
        logError("server_shutdown_failed", {
          error: error.message,
          signal,
        });
        process.exitCode = 1;
        return;
      }

      process.exitCode = 0;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

function getListeningPort(address, fallbackPort) {
  if (address && typeof address === "object" && "port" in address) {
    return address.port;
  }

  return fallbackPort;
}

function logInfo(event, details) {
  console.log(JSON.stringify({ event, level: "info", ...details }));
}

function logError(event, details) {
  console.error(JSON.stringify({ event, level: "error", ...details }));
}

const entryPath = process.argv[1];
const isEntrypoint =
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href;

if (isEntrypoint) {
  startServer();
}
