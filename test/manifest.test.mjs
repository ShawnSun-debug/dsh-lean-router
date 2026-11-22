import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

test("manifest 与 assets/skills 与 matrix 三方一致", async () => {
  const manifest = JSON.parse(await readFile(join(ROOT, "skills.manifest.json"), "utf8"));
  const matrix = JSON.parse(await readFile(join(ROOT, "assets", "skills.matrix.json"), "utf8"));
  const dirs = (await readdir(join(ROOT, "assets", "skills"), { withFileTypes: true })).filter(d => d.isDirectory()).map(d => d.name);
  assert.equal(manifest.skills.length, 31);
  assert.equal(matrix.skills.length, 31);
  assert.deepEqual([...dirs].sort(), [...matrix.skills.map(s => s.dir)].sort());
  for (const row of matrix.skills) {
    const m = manifest.skills.find(s => s.dir === row.dir);
    assert.ok(m, "manifest 缺 " + row.dir);
    assert.equal(m.model, row.model, row.dir + " model 开关不一致");
    assert.equal(m.user, row.user, row.dir + " user 开关不一致");
  }
  const c = { both: 0, modelOnly: 0, userOnly: 0 };
  for (const s of matrix.skills) { if (s.model && s.user) c.both++; else if (s.model) c.modelOnly++; else c.userOnly++; }
  assert.deepEqual(c, { both: 13, modelOnly: 10, userOnly: 8 });
});
