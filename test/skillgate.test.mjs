import test from "node:test";
import assert from "node:assert/strict";
import {
  AUDIT_FORMAT_VERSION,
  DEFAULT_GATE_CONFIG,
  createAuditChannel,
  resolveGateConfig,
  scoreSkills,
  classifyTiers,
  arbitrate,
  degrade,
  renderAdmission,
  isGateActive,
  round,
  estimateTokens,
} from "../lib/skillgate.js";
import { makeProvider, internals as providerInternals } from "../lib/skill-provider.js";

const CAT = [
  { name: "code-review", scenario: "engineering", keywords: [], model: true, user: true },
  { name: "tdd", scenario: "engineering", keywords: ["test", "测试"], model: true, user: false },
  { name: "chief-of-staff", scenario: "process", keywords: [], model: true, user: true },
  { name: "research", scenario: "research", keywords: [], model: true, user: true },
  { name: "grilling", scenario: "meta", keywords: [], model: false, user: true },
];

test("评分样例：react 建任务按场景加分，弱带只靠关键词", () => {
  const cfg = resolveGateConfig();
  const a = scoreSkills("写一个游戏网页 build a tool", CAT, cfg);
  assert.equal(a.band, "react");
  const byName = new Map(a.scores.map(s => [s.name, s]));
  assert.equal(byName.get("code-review").score, 2);
  assert.equal(byName.get("tdd").score, 2);
  assert.equal(byName.get("chief-of-staff").score, 1);
  assert.equal(byName.get("research").score, 0);
  assert.equal(byName.get("grilling").score, 0);
  assert.equal(byName.get("grilling").model, false);

  const b = scoreSkills("帮我测试这个模块的 test 覆盖", CAT, cfg);
  assert.equal(b.band, "weak");
  const bBy = new Map(b.scores.map(s => [s.name, s]));
  assert.equal(bBy.get("tdd").score, 2); // 仅关键词命中：test 与 测试 两个词各 +1，弱带无场景分
  assert.deepEqual(bBy.get("tdd").signals.keywords.sort(), ["test", "测试"]);
});

test("评分样例：spec 排查任务 engineering 主导，research 次要", () => {
  const cfg = resolveGateConfig();
  const a = scoreSkills("修复报错 bug 调试一下", CAT, cfg);
  assert.equal(a.band, "spec");
  const byName = new Map(a.scores.map(s => [s.name, s]));
  assert.equal(byName.get("code-review").score, 2);
  assert.equal(byName.get("research").score, 1);
  assert.equal(byName.get("chief-of-staff").score, 0);
});

test("评分样例：isComplexTask 给 engineering 深度加成", () => {
  const cfg = resolveGateConfig();
  const a = scoreSkills("全面重构系统架构，做详细设计与优化分析", CAT, cfg);
  assert.equal(a.band, "spec"); // 重构/优化 命中 spec 词表
  assert.equal(a.complex, true);
  const byName = new Map(a.scores.map(s => [s.name, s]));
  assert.equal(byName.get("code-review").score, 3); // spec engineering 2 + complexBoost 1
  assert.equal(byName.get("chief-of-staff").score, 0); // spec 表无 process
  assert.equal(byName.get("research").score, 1); // spec research +1
});

test("阈值可配：调高 autoScore 后原 auto 落到 hint", () => {
  const cfg = resolveGateConfig({ autoScore: 3, hintScore: 2 });
  const a = scoreSkills("写一个游戏网页", CAT, cfg);
  const tiers = classifyTiers(a.scores, cfg);
  assert.equal(tiers.get("code-review"), "hint"); // 2 >= hintScore 2
  assert.equal(tiers.get("chief-of-staff"), "off"); // 1 < hintScore 2
  assert.equal(tiers.get("grilling"), "off"); // 非 model 永不进档
});

test("ds-* 场景裁决：engineering 降档、invocation 不变、表数据驱动可配", () => {
  const cfg = resolveGateConfig();
  const scored = scoreSkills("写一个游戏网页", CAT, cfg).scores;
  const tiers = classifyTiers(scored, cfg);
  const arb = arbitrate(tiers, CAT, cfg, ["ds-tdd", "ds-mode"]);
  assert.equal(arb.tiers.get("code-review"), "hint");
  assert.equal(arb.tiers.get("chief-of-staff"), "hint"); // process 本就 hint（分数 1），裁决不动它
  assert.ok(arb.applied.some(x => x.name === "code-review" && x.from === "auto" && x.to === "hint"));
  // 非 ds- 前缀不算 ds-* 活跃
  const arb2 = arbitrate(tiers, CAT, cfg, ["dsh-badge"]);
  assert.equal(arb2.tiers.get("code-review"), "auto");
  assert.equal(arb2.applied.length, 0);
  // 自定义表：engineering 优先 mattpocock -> 不降档
  const cfg2 = resolveGateConfig({ arbitration: [{ scene: "engineering", prefer: "mattpocock" }] });
  const arb3 = arbitrate(tiers, CAT, cfg2, ["ds-tdd"]);
  assert.equal(arb3.tiers.get("code-review"), "auto");
  // 裁决不改 invocation（score 行保持矩阵语义）
  assert.equal(scored.find(s => s.name === "code-review").user, true);
  assert.equal(scored.find(s => s.name === "tdd").user, false);
});

function bigCatalog(n) {
  const rows = [];
  for (let i = 0; i < n; i += 1) {
    rows.push({
      name: "skill-" + String(i).padStart(2, "0"),
      scenario: "engineering",
      keywords: [],
      model: true,
      user: true,
      description: "Engineering skill number " + i + " with a fairly long description text to inflate tokens.",
    });
  }
  return rows;
}

test("软降级：低分先降、只设总量软保险、invocation 不变", () => {
  const cfg = resolveGateConfig({ tokenBudget: 60 });
  const rows = bigCatalog(6);
  const scored = scoreSkills("写一个游戏网页 build", rows, cfg).scores;
  // 人为制造分数差：前三个 3 分（仍 auto），后三个保持 2 分（仍 auto，但低分先降）
  for (let i = 0; i < 3; i += 1) scored[i].score = 3;
  const tiers = classifyTiers(scored, cfg);
  const autoAll = [...tiers].filter(([, v]) => v === "auto").map(([k]) => k);
  const renderText = (auto, hint) =>
    renderAdmission({ band: "react", complex: false, auto, hint }, rows, { turn: 1 });
  const baseline = estimateTokens(renderText(autoAll, []), cfg);
  const res = degrade(autoAll, [], scored, renderText, cfg);
  // 软保险语义：降到 auto 清空为止或 estTokens <= 预算；hint 文本不受保险保护（地板效应）
  assert.ok(res.auto.length === 0 || res.estTokens <= 60, "estTokens=" + res.estTokens + " auto=" + res.auto.length);
  assert.ok(res.degraded.length > 0);
  assert.ok(res.estTokens < baseline, "baseline=" + baseline + " est=" + res.estTokens);
  // 低分（2 分档 skill-03..05）先被降
  const first = res.degraded[0].name;
  assert.ok(["skill-03", "skill-04", "skill-05"].includes(first), "first degraded = " + first);
  // 低分（2 分档）先降、同名分数内名字序；3 分档最后降
  assert.deepEqual(res.degraded.map(d => d.name), ["skill-03", "skill-04", "skill-05", "skill-00", "skill-01", "skill-02"]);
  // invocation 不变
  assert.equal(scored.every(s => s.model === true && s.user === true), true);
});

test("软降级：个数不设上限，超预算到全部降为 hint 也不报错", () => {
  const cfg = resolveGateConfig({ tokenBudget: 1 });
  const rows = bigCatalog(4);
  const scored = scoreSkills("写一个游戏网页", rows, cfg).scores;
  const tiers = classifyTiers(scored, cfg);
  const autoAll = [...tiers].filter(([, v]) => v === "auto").map(([k]) => k);
  const renderText = (auto, hint) => renderAdmission({ band: "react", complex: false, auto, hint }, rows, { turn: 1 });
  const res = degrade(autoAll, [], scored, renderText, cfg);
  assert.equal(res.auto.length, 0);
  assert.equal(res.hint.length, 4);
});

test("estimateTokens 与门控激活判据", () => {
  const cfg = resolveGateConfig();
  assert.equal(estimateTokens("", cfg), 0);
  assert.equal(estimateTokens("abcd", cfg), 1);
  assert.equal(isGateActive(null), false);
  assert.equal(isGateActive({ taskText: "" }), false);
  assert.equal(isGateActive({ taskText: "修一个 bug" }), true);
  assert.equal(round(null, CAT, cfg).active, false);
  assert.equal(round({ taskText: "" }, CAT, cfg).active, false);
});

test("审计：格式先出（v/kind/scores/decision），订阅与环形缓冲", () => {
  const audit = createAuditChannel({ capacity: 2 });
  const seen = [];
  audit.subscribe(e => seen.push(e));
  const cfg = resolveGateConfig();
  const r1 = round({ taskText: "写一个游戏网页", turn: 1 }, CAT, cfg, audit);
  assert.equal(r1.active, true);
  assert.equal(r1.decision.mode, "fallback-cached-list");
  const entry = r1.auditEntry;
  assert.equal(entry.v, AUDIT_FORMAT_VERSION);
  assert.equal(entry.kind, "skillgate-round");
  assert.equal(entry.turn, 1);
  assert.equal(entry.task.band, "react");
  assert.equal(entry.scores.length, CAT.length);
  assert.ok(entry.decision.auto.includes("code-review"));
  assert.ok(entry.decision.hint.includes("chief-of-staff"));
  assert.ok(!entry.decision.auto.includes("grilling"));
  assert.equal(typeof entry.estimateText, "string");
  assert.deepEqual(entry.config, { autoScore: 2, hintScore: 1, tokenBudget: 8000, charsPerToken: 4 });
  assert.deepEqual(seen, [entry]);
  // capacity=2：第三条把最旧挤出
  round({ taskText: "修复报错 bug", turn: 2 }, CAT, cfg, audit);
  round({ taskText: "写一个网页", turn: 3 }, CAT, cfg, audit);
  assert.equal(audit.entries().length, 2);
  assert.equal(audit.entries()[0].turn, 2);
  const drained = audit.drain();
  assert.equal(drained.length, 2);
  assert.equal(audit.entries().length, 0);
});

test("矩阵消费：真实目录 31 行、counts 13/10/8 与 _meta 一致", async () => {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = fileURLToPath(new URL("..", import.meta.url));
  const matrix = JSON.parse(await readFile(join(root, "assets", "skills.matrix.json"), "utf8"));
  const p = makeProvider();
  const list = await p.list();
  assert.equal(list.length, 31);
  let both = 0, modelOnly = 0, userOnly = 0;
  for (const s of list) {
    if (s.invocation.modelInvocable && s.invocation.userInvocable) both += 1;
    else if (s.invocation.modelInvocable) modelOnly += 1;
    else userOnly += 1;
  }
  assert.deepEqual({ both, modelOnly, userOnly }, matrix._meta.counts);
  assert.deepEqual(matrix._meta.counts, { both: 13, modelOnly: 10, userOnly: 8 });
  // catalogRows：scenario/keywords 随矩阵进评分输入
  const catalog = await providerInternals.loadCatalog();
  assert.equal(catalog.size, 31);
  const tdd = catalog.get("tdd");
  assert.equal(tdd.scenario, "engineering");
  assert.deepEqual(tdd.keywords, []);
  assert.equal(tdd.model, true);
  assert.equal(tdd.user, false);
  assert.equal(DEFAULT_GATE_CONFIG.autoScore, 2);
  assert.equal(DEFAULT_GATE_CONFIG.tokenBudget, 8000);
});
