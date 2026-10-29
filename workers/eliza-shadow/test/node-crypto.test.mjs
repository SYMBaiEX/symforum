import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import * as crypto from "node:crypto";
const require = createRequire(import.meta.url);
test("the Node-only worker resolves the browser crypto alias to native crypto", () => {
  const compat = createRequire(require.resolve("@elizaos/core"))(
    "crypto-browserify",
  );
  assert.equal(compat.createSign, crypto.createSign);
  assert.equal(compat.createECDH, crypto.createECDH);
  assert.equal(compat.randomBytes, crypto.randomBytes);
  assert.equal(
    compat.createHash("sha256").update("fixture").digest("hex"),
    crypto.createHash("sha256").update("fixture").digest("hex"),
  );
});
