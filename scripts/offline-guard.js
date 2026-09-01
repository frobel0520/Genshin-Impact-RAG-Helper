/**
 * Proof that the suite needs no model and no live source.
 *
 * Loaded with `node --test --import ./scripts/offline-guard.js`, it replaces
 * `fetch` with one that allows only loopback — the HTTP tests start their own
 * server — and throws for anything else. A test that quietly reached Ollama or
 * a wiki would otherwise pass on a developer's machine and fail in CI, or worse,
 * pass in CI while testing the network instead of the code.
 */

const ALLOWED_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

export const blockedRequests = [];

const originalFetch = globalThis.fetch;

globalThis.fetch = function guardedFetch(resource, options) {
  const url = resourceUrl(resource);
  if (url !== undefined && !ALLOWED_HOSTNAMES.has(url.hostname)) {
    blockedRequests.push(url.href);
    const error = new Error(
      `Offline test suite: refusing to reach ${url.hostname}. ` +
        "Inject a fake embedder or fixture instead of calling a live service.",
    );
    error.code = "OFFLINE_GUARD";
    throw error;
  }
  return originalFetch.call(globalThis, resource, options);
};

function resourceUrl(resource) {
  try {
    if (typeof resource === "string") {
      return new URL(resource);
    }
    if (resource instanceof URL) {
      return resource;
    }
    if (typeof resource?.url === "string") {
      return new URL(resource.url);
    }
  } catch {
    // A relative or unparseable target cannot reach the network from Node.
    return undefined;
  }
  return undefined;
}
