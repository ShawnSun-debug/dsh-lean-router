// dsh-lean-router 票 07 —— /lean-audit 命令与统计单测（宿主纯 node --test；临时目录验证）
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync as readFileSyncSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseAuditArgs,
  formatDecisionLine,
  formatTokenLine,
  aggregateStats,
  renderStatsTable,
  renderScoreTable,
  renderScoreCollapsed,
  collectWarnings,
  renderWeights,
  executeAuditCommand,
  DEFAULT_RECENT,
  SCORE_TABLE_TOP,
} from "../lib/audit-commands.js";
import { loadGateWeights, gateWeightsFile, DEFAULT_GATE_CONFIG } from "../lib/skillgate.js";
import { apply, internals } from "../lib/router.js";

/** 合成审计条目（与 lib/skillgate.js round() 的 v=1 格式同构）。 */
function makeEntry(overrides) {
  const o = overrides ?? {};
  const scores = o.scores ?? [
    { name: "code-review", score: 2, signals: { category: { band: "react", scene: "engineering", points: 2, complex: false }, keywords: [] }, model: true, user: true },
    { name: "tdd", score: 2, signals: { category: { band: "react", scene: "engineering", points: 2, complex: false }, keywords: ["test"] }, model: true, user: false },
    { name: "chief-of-staff", score: 1, signals: { category: { band: "react", scene: "process", points: 1, complex: false }, keywords: [] }, model: true, user: true },
  ];
  return {
    seq: o.seq ?? 1,
    v: 1,
    ts: "2026-11-24T00:00:00.000Z",
    kind: "skillgate-round",
    turn: o.turn ?? 1,
    task: { band: "react", complex: o.complex ?? false, head: "写一个游戏网页" },
    config: { autoScore: 2, hintScore: 1, tokenBudget: 8000, charsPerToken: 4 },
    dsActive: [],
    scores,
    decision: {
      band: "react",
      complex: o.complex ?? false,
      auto: o.auto ?? ["code-review", "tdd"],
      hint: o.hint ?? ["chief-of-staff"],
      arbitrations: [],
      degradations: o.degraded ?? [],
      estTokens: o.estTokens ?? 1240,
      budgetTokens: 8000,
      mode: "fallback-cached-list",
    },
    estimateText: "",
  };
}

async function tempRoot() {
  return await mkdtemp(join(tmpdir(), "lean-audit-cmd-"));
}

test("parseAuditArgs：默认 summary 10；视图与条数解析；非法值报错", () => {
  assert.deepEqual(parseAuditArgs(""), { view: "summary", count: DEFAULT_RECENT });
  assert.deepEqual(parseAuditArgs("5"), { view: "summary", count: 5 });
  assert.deepEqual(parseAuditArgs("scores"), { view: "scores", count: 1 });
  assert.deepEqual(parseAuditArgs("scores 3"), { view: "scores", count: 3 });
  assert.deepEqual(parseAuditArgs("stats"), { view: "stats", count: null });
  assert.deepEqual(parseAuditArgs("weights"), { view: "weights", count: null });
  assert.throws(() => parseAuditArgs("bogus"), /usage/);
  assert.throws(() => parseAuditArgs("scores 0"), /1\.\.100/);
  assert.throws(() => parseAuditArgs("scores 101"), /1\.\.100/);
});

test("决策行与 token 对比行格式", () => {
  const e = makeEntry({ turn: 3, complex: true });
  assert.equal(formatDecisionLine(e, 1), "#01 turn=3 band=react* auto=2 hint=1 tokens=1240/8000");
  assert.equal(formatTokenLine(e), "Token (turn 3): est 1240 / budget 8000 tokens (charsPerToken=4)  within");
  const over = makeEntry({ turn: 4, estTokens: 9000 });
  assert.ok(formatTokenLine(over).endsWith("OVER"));
  assert.equal(formatTokenLine(null), null);
});

test("aggregateStats：按技能×场景聚合命中/挂载/降级（约束台账 1）", () => {
  const e1 = makeEntry({
    turn: 1,
    scores: [
      { name: "a", score: 2, signals: { category: { band: "react", scene: "engineering", points: 2, complex: false }, keywords: ["test"] }, model: true, user: true },
      { name: "b", score: 1, signals: { category: { band: "react", scene: "process", points: 1, complex: false }, keywords: [] }, model: true, user: true },
    ],
    auto: ["a"],
    hint: ["b"],
    degraded: [{ name: "b", from: "auto", to: "hint" }],
  });
  const e2 = makeEntry({
    turn: 2,
    scores: [
      { name: "a", score: 1, signals: { category: { band: "react", scene: "engineering", points: 1, complex: false }, keywords: [] }, model: true, user: true },
      { name: "b", score: 1, signals: { category: { band: "react", scene: "process", points: 1, complex: false }, keywords: [] }, model: true, user: true },
    ],
    auto: [],
    hint: ["a", "b"],
    degraded: [],
  });
  const rows = aggregateStats([e1, e2]);
  const a = rows.find((r) => r.name === "a");
  const b = rows.find((r) => r.name === "b");
  assert.deepEqual({ rounds: a.rounds, hits: a.hits, auto: a.auto, hint: a.hint, degraded: a.degraded, scene: a.scene }, { rounds: 2, hits: 1, auto: 1, hint: 1, degraded: 0, scene: "engineering" });
  assert.deepEqual({ rounds: b.rounds, hits: b.hits, auto: b.auto, hint: b.hint, degraded: b.degraded, scene: b.scene }, { rounds: 2, hits: 0, auto: 0, hint: 2, degraded: 1, scene: "process" });
});

test("命中统计表文本：表头与数据行", () => {
  const e1 = makeEntry({});
  const text = renderStatsTable(aggregateStats([e1]), 1);
  assert.ok(text.includes("Hit stats (per skill x scene, from 1 replayed round(s)):"));
  assert.ok(text.includes("code-review"));
  assert.ok(text.includes("rounds"));
  assert.ok(text.includes("degraded"));
});

test("得分表：展开全量行（tier/场景/命中词/invocation）与折叠视图（Top K + 展开提示）", () => {
  const e = makeEntry({ turn: 7 });
  const table = renderScoreTable(e);
  assert.ok(table.includes("Score table turn=7 band=react (3 skills):"));
  assert.ok(table.includes("code-review"));
  assert.ok(table.includes("auto"));
  assert.ok(table.includes("test"));
  assert.ok(table.includes("m-") || table.includes("mu") || table.includes("-u") || table.includes("m/"), "invocation 旗标存在");
  const collapsed = renderScoreCollapsed(e);
  assert.ok(collapsed.includes("collapsed"));
  assert.ok(collapsed.includes("/lean-audit scores to expand"));
  const bigEntry = makeEntry({ turn: 8, scores: [] });
  assert.equal(SCORE_TABLE_TOP, 5);
  assert.ok(renderScoreTable(bigEntry).includes("(0 skills):"));
});

test("collectWarnings：超预算/软降级/坏行/权重回退；无问题则无黄条", () => {
  const over = makeEntry({ turn: 2, estTokens: 9500, degraded: [{ name: "tdd", from: "auto", to: "hint" }] });
  const bars = collectWarnings([over], { skipped: 2 }, { status: "fallback", error: "invalid JSON" });
  assert.equal(bars.length, 4);
  assert.ok(bars.some((b) => b.startsWith("⚠ turn 2: token est 9500 > budget 8000")));
  assert.ok(bars.some((b) => b.startsWith("⚠ turn 2: 1 skill(s) soft-degraded")));
  assert.ok(bars.some((b) => b.includes("malformed")));
  assert.ok(bars.some((b) => b.includes("weights fallback")));
  assert.deepEqual(collectWarnings([makeEntry({ turn: 1 })], { skipped: 0 }, null), []);
});

test("executeAuditCommand 汇总视图：决策行 + token 对比 + 折叠得分表 + 统计 + 坏行黄条", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    const lines = [JSON.stringify(makeEntry({ turn: 1, seq: 1 })), "not-json", JSON.stringify(makeEntry({ turn: 2, seq: 2, estTokens: 9500, degraded: [{ name: "tdd" }] }))];
    await writeFile(path, lines.join("\n") + "\n", "utf8");
    const res = await executeAuditCommand({ rawInput: "" }, { auditPath: path, weightsPath: null });
    assert.equal(res.kind, "success");
    assert.ok(res.text.includes("Lean audit - replayed from " + path));
    assert.ok(res.text.includes("#01 turn=1"));
    assert.ok(res.text.includes("#02 turn=2"));
    assert.ok(res.text.includes("est 9500 / budget 8000"));
    assert.ok(res.text.includes("OVER"));
    assert.ok(res.text.includes("Score table (collapsed"));
    assert.ok(res.text.includes("Hit stats"));
    assert.ok(res.text.includes("⚠ turn 2: token est 9500 > budget 8000"));
    assert.ok(res.text.includes("⚠ replay skipped 1 malformed line(s)"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executeAuditCommand scores 视图：展开最近 N 条全量得分行", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    await writeFile(path, [JSON.stringify(makeEntry({ turn: 1, seq: 1 })), JSON.stringify(makeEntry({ turn: 2, seq: 2 }))].join("\n") + "\n", "utf8");
    const res = await executeAuditCommand({ rawInput: "scores 2" }, { auditPath: path, weightsPath: null });
    assert.equal(res.kind, "success");
    assert.match(res.text, /Score table turn=1/g);
    assert.match(res.text, /Score table turn=2/g);
    assert.ok(res.text.includes("chief-of-staff"));
    const one = await executeAuditCommand({ rawInput: "scores" }, { auditPath: path, weightsPath: null });
    assert.match(one.text, /Score table turn=2/g);
    assert.doesNotMatch(one.text, /Score table turn=1/g);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("executeAuditCommand stats 视图与空文件友好提示", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    await writeFile(path, JSON.stringify(makeEntry({ turn: 1, seq: 1 })) + "\n", "utf8");
    const stats = await executeAuditCommand({ rawInput: "stats" }, { auditPath: path, weightsPath: null });
    assert.equal(stats.kind, "success");
    assert.ok(stats.text.includes("Hit stats"));
    assert.ok(!stats.text.includes("Decisions"));
    const none = await executeAuditCommand({ rawInput: "" }, { auditPath: join(root, "missing.jsonl"), weightsPath: null });
    assert.equal(none.kind, "success");
    assert.ok(none.text.includes("No audit entries yet"));
    assert.ok(none.text.includes("missing.jsonl"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("weights 视图：loaded/default/fallback 三态（约束台账 3）", async () => {
  const root = await tempRoot();
  try {
    const loaded = await executeAuditCommand({ rawInput: "weights" }, {
      auditPath: join(root, "audit.jsonl"),
      weightsPath: join(root, "weights.json"),
    });
    assert.equal(loaded.kind, "success");
    assert.ok(loaded.text.includes("[default]"), "缺失文件回退默认且不报错");
    assert.ok(loaded.text.includes("autoScore=2"));
    await writeFile(join(root, "weights.json"), JSON.stringify({ version: 1, autoScore: 3, tokenBudget: 5000 }), "utf8");
    const custom = await executeAuditCommand({ rawInput: "weights" }, {
      auditPath: join(root, "audit.jsonl"),
      weightsPath: join(root, "weights.json"),
    });
    assert.ok(custom.text.includes("[loaded]"));
    assert.ok(custom.text.includes("autoScore=3"));
    assert.ok(custom.text.includes("tokenBudget=5000"));
    await writeFile(join(root, "bad.json"), "{oops", "utf8");
    const bad = await executeAuditCommand({ rawInput: "weights" }, {
      auditPath: join(root, "audit.jsonl"),
      weightsPath: join(root, "bad.json"),
    });
    assert.ok(bad.text.includes("[fallback]"));
    assert.ok(bad.text.includes("invalid JSON"));
    assert.ok(bad.text.includes("autoScore=2"), "回退默认值");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("包内权重文件（assets/gating.weights.json）= 当前硬编码缺省值", async () => {
  const source = gateWeightsFile();
  assert.ok(source.includes(join("assets", "gating.weights.json")));
  const weights = await loadGateWeights();
  assert.equal(weights.status, "loaded");
  assert.equal(weights.config.autoScore, DEFAULT_GATE_CONFIG.autoScore);
  assert.equal(weights.config.tokenBudget, DEFAULT_GATE_CONFIG.tokenBudget);
  assert.equal(weights.config.charsPerToken, DEFAULT_GATE_CONFIG.charsPerToken);
  assert.deepEqual(weights.config.sceneMap, DEFAULT_GATE_CONFIG.sceneMap);
  assert.deepEqual(weights.config.complexBoost, DEFAULT_GATE_CONFIG.complexBoost);
});

test("非法权重值回退默认（loadGateWeights 直测）", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "w.json");
    await writeFile(path, JSON.stringify({ version: 1, autoScore: -1 }), "utf8");
    const weights = await loadGateWeights(path);
    assert.equal(weights.status, "fallback");
    assert.equal(weights.config.autoScore, DEFAULT_GATE_CONFIG.autoScore);
    await writeFile(path, JSON.stringify({ version: 2 }), "utf8");
    assert.equal((await loadGateWeights(path)).status, "fallback");
    await writeFile(path, JSON.stringify({ version: 1, nope: 1 }), "utf8");
    const unknown = await loadGateWeights(path);
    assert.equal(unknown.status, "fallback");
    assert.ok(unknown.error.includes("unknown option"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

/** 最小假 ctx（与 test/router.test.mjs 同构）。 */
function makeCtx() {
  const commands = new Map();
  return {
    ctx: {
      on() {
        return () => {};
      },
      systemPrompt: { context() { return () => {}; } },
      commands: { register(def) { commands.set(def.name, def); return () => {}; } },
      skills: {},
    },
    commands,
  };
}

test("router 加法接线：audit:true 挂 sink（决策流 -> JSONL），/lean-audit 命令回放同文件", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    // resolveOptions：audit 默认关；audit:true 才挂 sink（关闭 = 零行为变化）。
    assert.equal(internals.resolveOptions({}).audit, false);
    const direct = internals.setupAudit({ auditPath: path });
    direct.channel.push(makeEntry({ turn: 1, seq: 1 }));
    direct.unsubscribe();
    assert.equal(readLines(path).length, 1);
    const { ctx, commands } = makeCtx();
    apply(ctx, { hooks: false, commands: true, audit: false, auditPath: path });
    assert.ok(commands.has("lean-audit"));
    assert.ok(commands.has("band"));
    assert.ok(commands.has("skill"));
    const res = await commands.get("lean-audit").handler({ rawInput: "stats" });
    assert.equal(res.kind, "success");
    assert.ok(res.text.includes("Hit stats"));
    assert.ok(res.text.includes("code-review"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function readLines(path) {
  return readFileSyncSync(path, "utf8").split("\n").filter((l) => l.trim().length > 0);
}

test("setupAudit 幂等护栏：同路径只挂一次（防双写），退订后可重挂", async () => {
  const root = await tempRoot();
  try {
    const shared = join(root, "guard.jsonl");
    const h1 = internals.setupAudit({ auditPath: shared });
    const h2 = internals.setupAudit({ auditPath: shared });
    assert.equal(h1, h2, "同路径第二次返回同一 handle，不再新增订阅");
    h1.unsubscribe();
    const h3 = internals.setupAudit({ auditPath: shared });
    assert.notEqual(h1, h3, "退订清掉注册，可重新挂载");
    h3.unsubscribe();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
