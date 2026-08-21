import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { createHttpServer } from "./api/http-server.js";
import { loadRuntimeConfig } from "./config/runtime-config.js";

export function createApplication(environment = process.env) {
  const config = loadRuntimeConfig(environment);
  const server = createHttpServer(config);

  return Object.freeze({ config, server });
}

export function startServer(environment = process.env) {
  const application = createApplication(environment);

  application.server.listen(
    application.config.port,
    "127.0.0.1",
    () => {
      const address = application.server.address();
      const port = typeof address === "object" && address ? address.port : application.config.port;
      console.log(`RAG helper listening at http://127.0.0.1:${port}`);
    },
  );

  registerShutdown(application.server);
  return application;
}

function registerShutdown(server) {
  const shutdown = (signal) => {
    server.close((error) => {
      if (error) {
        console.error(`Failed to stop server after ${signal}:`, error);
        process.exitCode = 1;
        return;
      }

      process.exitCode = 0;
    });
  };

  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

const entryPath = process.argv[1];
const isEntrypoint =
  entryPath !== undefined &&
  import.meta.url === pathToFileURL(resolve(entryPath)).href;

if (isEntrypoint) {
  startServer();
}
