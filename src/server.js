import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createHealthReporter, createHealthRoute } from "./api/health-api.js";
import { createHttpServer } from "./api/http-server.js";
import { createQueryRoute, createQueryService } from "./api/query-api.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";
import { createDocumentStore } from "./data/document-store.js";
import { createStructuredStore } from "./data/structured-store.js";
import { createOllamaEmbedder } from "./ingest/ollama-embedder.js";
import { createDocumentRetriever } from "./query/document-retrieval.js";
import { createQueryClassifier } from "./query/query-classifier.js";
import { createQueryOrchestrator } from "./query/query-orchestrator.js";
import { createStructuredRetriever } from "./query/structured-retrieval.js";

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
  const stores = openExistingStores(config);
  const reporter = createHealthReporter({ config, ...stores });
  const composed = {
    healthHandler: createHealthRoute({ reporter }),
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

function openExistingStores(config) {
  const stores = {};
  if (existsSync(resolve(config.structuredDatabasePath))) {
    stores.structuredStore = createStructuredStore({
      databasePath: config.structuredDatabasePath,
    });
  }
  if (existsSync(resolve(config.documentDatabasePath))) {
    stores.documentStore = createDocumentStore({ databasePath: config.documentDatabasePath });
  }
  return stores;
}

function createQueryHandler(config, { structuredStore, documentStore }, reporter) {
  if (reporter.report().status !== "ok") {
    return undefined;
  }

  const embedder = createOllamaEmbedder({
    host: config.ollamaHost,
    model: config.embeddingModel,
  });
  const service = createQueryService({
    orchestrator: createQueryOrchestrator({
      classifier: createQueryClassifier({
        canonicalEntities: structuredStore.listCanonicalEntities(),
      }),
      structuredRetriever: createStructuredRetriever({ store: structuredStore }),
      documentRetriever: createDocumentRetriever({
        store: documentStore,
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
  return { queryHandler: createQueryRoute({ service }) };
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
