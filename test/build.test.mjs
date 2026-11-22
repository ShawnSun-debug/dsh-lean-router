import test from "node:test";
import assert from "node:assert/strict";
import { check } from "../scripts/build-bundle.mjs";

test("build --check 反向逐字节一致", async () => {
  assert.equal(await check(), true);
});
