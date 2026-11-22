import test from "node:test";
import assert from "node:assert/strict";
import { makeProvider, DEFAULT_RANK } from "../lib/skill-provider.js";

test("provider 31 技能且 invocation 消费矩阵", async () => {
  const p = makeProvider();
  const list = await p.list();
  assert.equal(list.length, 31);
  assert.equal(list.every(s => s.rank === DEFAULT_RANK), true);
  const byName = new Map(list.map(s => [s.name, s]));
  assert.equal(byName.get("tdd").invocation.modelInvocable, true);
  assert.equal(byName.get("tdd").invocation.userInvocable, false);
  assert.equal(byName.get("grilling").invocation.modelInvocable, false);
  assert.equal(byName.get("grilling").invocation.userInvocable, true);
  assert.equal(byName.get("to-spec").invocation.modelInvocable, true);
  assert.equal(byName.get("to-spec").invocation.userInvocable, true);
  const got = await p.get({ name: "tdd" });
  assert.ok(got.content.length > 0);
  assert.ok(!got.content.startsWith("---"), "正文应已剥掉 frontmatter");
  await assert.rejects(() => p.get({ name: "no-such-skill" }));
});
