import assert from "node:assert/strict";
import test from "node:test";

import { checkBoundaries } from "../scripts/check-boundaries.js";

test("source imports respect the T01 module boundaries", () => {
  assert.deepEqual(checkBoundaries(), []);
});
