import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createHttpServer } from "./api/http-server.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";

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
 * @param {Record<string, string | undefined>} environment
 * @returns {Application}
 */
export function createApplication(environment = process.env) {
  const config = loadRuntimeConfig(environment);
  const server = createHttpServer(config);

  return Object.freeze({ config, server });
}

/**
 * @param {Record<string, string | undefined>} environment
 * @returns {Application}
 */
export function startServer(environment = process.env) {
  const application = createApplication(environment);

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
