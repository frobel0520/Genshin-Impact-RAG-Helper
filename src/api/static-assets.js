import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const UI_ROUTES = Object.freeze({
  PAGE: "/",
  ASSET_PREFIX: "/assets/",
});

/**
 * The exact files the page is allowed to serve.
 *
 * An allowlist rather than a directory walk: the server hands out the query
 * page, not whatever happens to sit next to it, so a stray file in the UI
 * folder can never become a public endpoint and a crafted path can never
 * escape it.
 */
export const UI_ASSETS = Object.freeze({
  "index.html": "text/html; charset=utf-8",
  "app.js": "text/javascript; charset=utf-8",
  "render.js": "text/javascript; charset=utf-8",
  "styles.css": "text/css; charset=utf-8",
});

const PAGE_FILE = "index.html";

/**
 * Serve the static query page.
 *
 * @param {{ rootDir: string, readFile?: (path: string) => Buffer }} options
 * @returns {(request: import("node:http").IncomingMessage, response: import("node:http").ServerResponse, pathname: string) => boolean}
 *   true when the request was handled
 */
export function createStaticRoute(options) {
  const { rootDir, readFile } = validateOptions(options);

  return function handleStatic(request, response, pathname) {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return false;
    }

    const fileName = resolveFileName(pathname);
    if (fileName === undefined) {
      return false;
    }

    let body;
    try {
      body = readFile(join(rootDir, fileName));
    } catch {
      return false;
    }

    response.writeHead(200, {
      "cache-control": "no-store",
      "content-type": UI_ASSETS[fileName],
      // The page talks only to its own origin, and nothing it renders is markup.
      "content-security-policy":
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'",
      "x-content-type-options": "nosniff",
    });
    response.end(request.method === "HEAD" ? undefined : body);
    return true;
  };
}

function resolveFileName(pathname) {
  if (pathname === UI_ROUTES.PAGE) {
    return PAGE_FILE;
  }
  if (!pathname.startsWith(UI_ROUTES.ASSET_PREFIX)) {
    return undefined;
  }
  const requested = pathname.slice(UI_ROUTES.ASSET_PREFIX.length);
  return Object.hasOwn(UI_ASSETS, requested) ? requested : undefined;
}

function validateOptions(options) {
  if (options === null || typeof options !== "object") {
    throw new TypeError("Static route options must be a plain object.");
  }
  for (const field of Object.keys(options)) {
    if (field !== "rootDir" && field !== "readFile") {
      throw new TypeError(`Unknown static route option: ${field}.`);
    }
  }
  if (typeof options.rootDir !== "string" || options.rootDir.trim().length === 0) {
    throw new TypeError("rootDir must be a non-empty string.");
  }
  if (options.readFile !== undefined && typeof options.readFile !== "function") {
    throw new TypeError("readFile must be a function when provided.");
  }

  return {
    rootDir: resolve(options.rootDir),
    readFile: options.readFile ?? ((path) => readFileSync(path)),
  };
}
