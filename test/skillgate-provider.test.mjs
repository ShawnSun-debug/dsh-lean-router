import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { makeProvider, DEFAULT_RANK, internals } from "../lib/skill-provider.js";
import { createAuditChannel } from "../lib/skillgate.js";

test("票 02 scaffold 断言镜像：门控关闭时全量 31、rank 350、矩阵 invocation", async () => {
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
  assert.ok(!got.content.startsWith("---"));
  await assert.rejects(() => p.get({ name: "no-such-skill" }));
  // list({}) 与显式空态同样全量（门控关闭）
  assert.equal((await p.list({})).length, 31);
  assert.equal((await p.list({ leanGate: { taskText: "", turn: 1 } })).length, 31);
});

test("两级来源：user 目录优先，缺失时 assets 兜底（invocation 仍按矩阵）", async () => {
  const temp = await mkdtemp(join(tmpdir(), "t6-user-skills-"));
  const fake = "---\nname: tdd\ndescription: USER TIER COPY of tdd\n---\n\n# tdd\nuser body\n";
  await mkdir(join(temp, "tdd"), { recursive: true });
  await writeFile(join(temp, "tdd", "SKILL.md"), fake, "utf8");
  const p = makeProvider({ userSkillsDir: temp });
  const list = await p.list();
  const tdd = list.find(s => s.name === "tdd");
  assert.equal(tdd.source, "user");
  assert.equal(tdd.description, "USER TIER COPY of tdd");
  assert.equal(tdd.invocation.modelInvocable, true, "invocation 仍按矩阵");
  assert.equal(tdd.invocation.userInvocable, false, "invocation 仍按矩阵");
  assert.equal(tdd.rank, DEFAULT_RANK);
  assert.ok(tdd.resourceBase.path.includes("t6-user-skills-"));
  const chief = list.find(s => s.name === "chief-of-staff");
  assert.equal(chief.source, "bundled");
  assert.ok(chief.description.length > 0);
  const got = await p.get({ name: "tdd" });
  assert.ok(got.content.includes("user body"));
  assert.equal(got.source, "user");
});

test("两级来源：user 目录整目录缺失时全部兜底 bundled", async () => {
  const empty = await mkdtemp(join(tmpdir(), "t6-empty-skills-"));
  const p = makeProvider({ userSkillsDir: empty });
  const list = await p.list();
  assert.equal(list.length, 31);
  assert.equal(list.every(s => s.source === "bundled"), true);
});

test("门控显式参数生效：build 任务只放行 model-invocable 的 auto+hint 集合", async () => {
  const p = makeProvider();
  const gated = await p.list({ leanGate: { taskText: "写一个游戏网页 build a tool", turn: 3 } });
  assert.ok(gated.length > 0 && gated.length < 31);
  const full = new Map((await p.list()).map(s => [s.name, s]));
  const gatedNames = new Set(gated.map(s => s.name));
  assert.equal(gated.every(s => s.invocation.modelInvocable === true), true);
  assert.ok(gatedNames.has("tdd"));
  assert.ok(gatedNames.has("chief-of-staff"));
  assert.ok(!gatedNames.has("grilling"));
  assert.ok(!gatedNames.has("prototype"));
  assert.ok(!gatedNames.has("writing-beats"));
  assert.ok(!gatedNames.has("research"));
  for (const s of gated) {
    assert.deepEqual(s.invocation, full.get(s.name).invocation);
    assert.equal(s.rank, DEFAULT_RANK);
  }
});

test("门控显式参数：spec 任务放行 research 场景 hint", async () => {
  const p = makeProvider();
  const gated = await p.list({ leanGate: { taskText: "排查一个报错 bug 为什么崩溃", turn: 2 } });
  const names = new Set(gated.map(s => s.name));
  assert.ok(names.has("research"));
  assert.ok(names.has("tdd"));
  assert.ok(!names.has("chief-of-staff"));
});

test("门控显式参数：ds-* 活跃时 engineering 降档，process 不动", async () => {
  const audit = createAuditChannel({ capacity: 8 });
  const p = makeProvider({ audit });
  const gated = await p.list({ leanGate: { taskText: "写一个游戏网页", turn: 5, dsActive: ["ds-tdd"] } });
  const names = new Set(gated.map(s => s.name));
  assert.ok(names.has("chief-of-staff"));
  const entry = audit.entries().at(-1);
  assert.equal(entry.kind, "skillgate-round");
  assert.ok(entry.decision.arbitrations.some(a => a.from === "auto" && a.to === "hint"));
  assert.deepEqual(entry.dsActive, ["ds-tdd"]);
  assert.equal(entry.decision.mode, "fallback-cached-list");
});

test("门控显式参数：软降级可被 tokenBudget 触发", async () => {
  const audit = createAuditChannel({ capacity: 4 });
  const p2 = makeProvider({ gateConfig: { tokenBudget: 40 }, audit });
  const gated = await p2.list({ leanGate: { taskText: "全面重构系统架构做详细设计", turn: 1 } });
  assert.ok(Array.isArray(gated));
  const entry = audit.entries()[0];
  // 软保险地板：降级持续到 auto 清空或 estTokens <= 预算（hint 文本不受保护）
  assert.ok(entry.decision.auto.length === 0 || entry.decision.estTokens <= 40, "estTokens=" + entry.decision.estTokens + " auto=" + entry.decision.auto.length);
  assert.ok(entry.decision.degradations.length > 0);
});

test("frontmatter 自解析：值内冒号保留、宿主扫描坑不复现", async () => {
  const parsed = internals.parseFrontmatter("---\nname: ask-matt\ndescription: use when: grilling the plan, hard\ndisable-model-invocation: false\n---\nbody");
  assert.equal(parsed.name, "ask-matt");
  assert.equal(parsed.description, "use when: grilling the plan, hard");
  const catalog = await internals.loadCatalog();
  assert.equal(catalog.size, 31);
  for (const row of catalog.values()) {
    assert.ok(row.tier === "user" || row.tier === "bundled");
    assert.ok(row.path.length > 0);
  }
});
