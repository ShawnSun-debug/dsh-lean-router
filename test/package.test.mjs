import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("package.json 骨架字段", async () => {
  const pkg = JSON.parse(await readFile(join(ROOT, "package.json"), "utf8"));
  assert.equal(pkg.name, "dsh-lean-router");
  assert.match(pkg.version, /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/);
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.type, "module");
  assert.equal(pkg.main, "lib/index.js");
  assert.equal(pkg.engines.dsh, ">=0.2.1-rc.5 <0.2.3-0");
  assert.equal(pkg.dsh.bundle.patch, "./cordis.patch.yml");
});
