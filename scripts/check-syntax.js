import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_ROOTS = ["src", "scripts", "tests"].map((directory) =>
  resolve(PROJECT_ROOT, directory),
);

/**
 * Parse every repository JavaScript file with the current Node runtime.
 *
 * @returns {{ filePath: string, error: Error }[]}
 */
export function checkSyntax() {
  const failures = [];

  for (const filePath of listJavaScriptFiles()) {
    try {
      execFileSync(process.execPath, ["--check", filePath], {
        cwd: PROJECT_ROOT,
        stdio: "pipe",
      });
    } catch (error) {
      failures.push({ filePath, error });
    }
  }

  return failures;
}

function listJavaScriptFiles() {
  return SOURCE_ROOTS.flatMap((root) => listFilesRecursively(root));
}

function listFilesRecursively(directory) {
  const files = [];

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
      continue;
    }

    if (entry.name.endsWith(".js")) {
      files.push(entryPath);
    }
  }

  return files;
}

const entryPath = process.argv[1];
const isEntrypoint =
  entryPath !== undefined && resolve(entryPath) === resolve(fileURLToPath(import.meta.url));

if (isEntrypoint) {
  const failures = checkSyntax();
  if (failures.length > 0) {
    console.error("JavaScript syntax check failed:");
    for (const failure of failures) {
      console.error(`- ${relative(PROJECT_ROOT, failure.filePath)}`);
      console.error(failure.error.stderr?.toString() ?? failure.error.message);
    }
    process.exitCode = 1;
  } else {
    console.log("JavaScript syntax check passed.");
  }
}
