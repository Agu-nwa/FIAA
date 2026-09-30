import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";
import { previewRoot } from "../preview-server.mjs";

test("QA preview resolves workspace paths containing spaces", async () => {
  assert.match(previewRoot, /Fiaa Evolution\/$/);
  assert.doesNotMatch(previewRoot, /%20/);
  const index = await stat(join(previewRoot, "index.html"));
  assert.equal(index.isFile(), true);
});
