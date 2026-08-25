import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC_ROOT = resolve(PROJECT_ROOT, "src");
const RUNTIME_LAYERS = new Set([
  "api",
  "config",
  "data",
  "domain",
  "evaluation",
  "ingest",
  "observability",
  "policy",
  "query",
  "ui",
]);

const ALLOWED_IMPORTS = new Map([
  ["api", new Set(["config", "evaluation", "ingest", "observability", "policy", "query"])],
  ["config", new Set()],
  ["data", new Set(["domain"])],
  ["domain", new Set()],
  ["evaluation", new Set(["domain", "observability", "policy", "query"])],
  ["ingest", new Set(["data", "domain", "observability"])],
  ["observability", new Set()],
  ["policy", new Set(["domain"])],
  ["query", new Set(["data", "domain"])],
  ["ui", new Set()],
]);

const STATIC_IMPORT_RE = /\b(?:import|export)\s+(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/g;
const DYNAMIC_IMPORT_RE = /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g;

/**
 * @returns {string[]}
 */
export function checkBoundaries() {
  const violations = [];

  for (const filePath of listJavaScriptFiles(SRC_ROOT)) {
    const sourceLayer = layerFor(filePath);
    const source = readFileSync(filePath, "utf8");
    const specifiers = [
      ...collectSpecifiers(source, STATIC_IMPORT_RE),
      ...collectSpecifiers(source, DYNAMIC_IMPORT_RE),
    ];

    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) {
        continue;
      }

      const targetPath = resolveImport(filePath, specifier);
      if (!targetPath) {
        violations.push(`${relative(PROJECT_ROOT, filePath)} imports missing ${specifier}`);
        continue;
      }

      const relativeTarget = relative(SRC_ROOT, targetPath);
      const isWithinSource =
        targetPath === SRC_ROOT ||
        (!relativeTarget.startsWith("..") && !isAbsolute(relativeTarget));
      if (!isWithinSource) {
        continue;
      }

      const targetLayer = layerFor(targetPath);
      if (sourceLayer === "root") {
        continue;
      }

      if (sourceLayer === targetLayer && RUNTIME_LAYERS.has(sourceLayer)) {
        continue;
      }

      const allowed = ALLOWED_IMPORTS.get(sourceLayer);
      if (!allowed || !allowed.has(targetLayer)) {
        violations.push(
          `${relative(PROJECT_ROOT, filePath)} (${sourceLayer}) cannot import ` +
            `${relative(PROJECT_ROOT, targetPath)} (${targetLayer})`,
        );
      }
    }
  }

  return violations;
}

function listJavaScriptFiles(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listJavaScriptFiles(entryPath));
    } else if ([".js", ".mjs", ".cjs"].includes(extname(entry.name))) {
      files.push(entryPath);
    }
  }

  return files;
}

function collectSpecifiers(source, pattern) {
  const matches = [...source.matchAll(pattern)];
  return matches.map((match) => match[1]);
}

function resolveImport(sourcePath, specifier) {
  const basePath = resolve(dirname(sourcePath), specifier);
  const candidates = [
    basePath,
    `${basePath}.js`,
    `${basePath}.mjs`,
    `${basePath}.cjs`,
    resolve(basePath, "index.js"),
  ];

  return candidates.find((candidate) => {
    try {
      return statSync(candidate).isFile();
    } catch {
      return false;
    }
  });
}

function layerFor(filePath) {
  const relativePath = relative(SRC_ROOT, filePath);
  const segments = relativePath.split(/[\\/]/);
  if (segments.length === 1) {
    return "root";
  }

  const [firstSegment] = segments;
  return RUNTIME_LAYERS.has(firstSegment) ? firstSegment : "unknown";
}

const isEntrypoint =
  process.argv[1] !== undefined &&
  isAbsolute(process.argv[1]) &&
  resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const violations = checkBoundaries();
  if (violations.length > 0) {
    console.error("Module boundary check failed:");
    for (const violation of violations) {
      console.error(`- ${violation}`);
    }
    process.exitCode = 1;
  } else {
    console.log("Module boundary check passed.");
  }
}
