// test/lean-modules.test.mjs —— lib/lean/ 各模块可独立加载与导出面（验收项 3）
import test from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../lib/lean/', import.meta.url);
const mod = (name) => import(new URL(name, base).href + '?v=' + Date.now());

test('compaction.js 独立加载：口径常量与校验导出', async () => {
  const m = await mod('compaction.js');
  assert.deepEqual({ ...m.LEAN_COMPACTION_CONFIG }, { thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1, auto: true });
  assert.equal(m.validateCompactionConfig(m.LEAN_COMPACTION_CONFIG), true);
  assert.equal(m.HOST_DEFAULTS.thresholdRatio, 0.8);
});

test('pruner.js 独立加载：marker 与口径常量', async () => {
  const m = await mod('pruner.js');
  assert.equal(m.PRUNE_MARKER.includes('tool result middle pruned'), true);
  assert.deepEqual({ ...m.LEAN_PRUNER_CONFIG }, { thresholdChars: 8192, headChars: 4096, tailChars: 1024 });
  assert.equal(typeof m.pruneText, 'function');
});

test('disabled.js 独立加载：6 件清单与上游一致', async () => {
  const m = await mod('disabled.js');
  assert.deepEqual([...m.DISABLED_PLUGIN_IDS], ['tool-subagent-codex', 'tool-subagent-claude-code', 'workflow-ptc', 'tool-workflow', 'tool-ralph', 'tool-plugin-manager']);
  assert.equal(m.DISABLED_PLUGIN_ROWS.length, 6);
  assert.equal(m.DISABLED_PLUGIN_ROWS.every((r) => r.disabled === true), true);
});

test('persona-text.js 独立加载：lean 13 条 + 3 软门 + 自检题钩子 + balance 3 条 + 拼接占位', async () => {
  const m = await mod('persona-text.js');
  const leanRules = m.LEAN_PERSONA_SUFFIX.match(/^\d+\./gm) || [];
  assert.equal(leanRules.length, 13);
  assert.equal((m.BALANCE_PERSONA_SUFFIX.match(/^\d+\./gm) || []).length, 3);
  assert.equal(m.LEAN_SOFT_GATES.length, 3);
  assert.equal(m.LEAN_SELF_CHECK_HOOKS.length, 2);
  // 3 软门：澄清/计划/交付
  assert.ok(m.LEAN_PERSONA_SUFFIX.includes('CLARIFY:'));
  assert.ok(m.LEAN_PERSONA_SUFFIX.includes('PLAN:'));
  assert.ok(m.LEAN_PERSONA_SUFFIX.includes('DELIVER:'));
  // 自检题钩子：勤勉 + 合卷
  assert.ok(m.LEAN_PERSONA_SUFFIX.includes('Diligence (~every 10 turns):'));
  assert.ok(m.LEAN_PERSONA_SUFFIX.includes('Close-the-book:'));
  // 票 05 拼接占位（两个 suffix 都要有；不写任何路由内容）
  for (const s of [m.LEAN_PERSONA_SUFFIX, m.BALANCE_PERSONA_SUFFIX]) {
    assert.ok(s.includes('# [ticket-05] 路由分类指令由票 05 拼接'), 'suffix 需含票 05 拼接占位');
  }
  // 不含路由内容（不出现 band/classify/router 指令字样）
  assert.ok(!m.LEAN_PERSONA_SUFFIX.includes('band='), '不得自行写路由内容');
  // prefix 与上游一致
  assert.equal(m.PERSONA_PREFIX, 'You are a coding agent powered by the {{model}} model.');
});

test('plan-mode.js 独立加载：v1 政策段原文要点', async () => {
  const m = await mod('plan-mode.js');
  for (const needle of ['You are in plan mode.', 'exit_plan_mode', 'Do not use todo_write to track this planning phase', 'Make the plan decision-complete']) {
    assert.ok(m.PLAN_MODE_SECTION.includes(needle), 'section 缺：' + needle);
  }
  assert.deepEqual({ ...m.PLANNING_GROUP_ISOLATE }, { planMode: true });
});

test('delivery-gate.js 独立加载：插件形态与手写校验（动态 import 降级不崩）', async () => {
  const m = await mod('delivery-gate.js');
  assert.equal(m.name, 'lean-delivery-gate');
  assert.deepEqual([...m.inject], ['systemPrompt']);
  assert.equal(typeof m.apply, 'function');
  assert.equal(typeof m.default.apply, 'function');
  const cfg = m.validateDeliveryGateConfig({ enabled: true, maxRounds: 3 });
  assert.equal(cfg.enabled, true);
  assert.equal(cfg.maxRounds, 3);
  assert.deepEqual(cfg.scripts, process.platform === 'win32' ? ['verify.ps1', 'verify.sh'] : ['verify.sh', 'verify.ps1']);
  assert.throws(() => m.validateDeliveryGateConfig({ bogus: 1 }), /unknown key/);
  assert.equal(m.validateDeliveryGateConfig({}).enabled, false, '默认关闭');
});

test('tool-concurrency.js 独立加载：导出面与默认插件', async () => {
  const m = await mod('tool-concurrency.js');
  assert.equal(typeof m.markConcurrencySafe, 'function');
  assert.equal(typeof m.unmarkConcurrencySafe, 'function');
  assert.equal(typeof m.installToolConcurrency, 'function');
  assert.equal(m.default.name, 'lean-concurrency');
  assert.deepEqual([...m.default.inject], ['tools', 'agents']);
  assert.deepEqual([...m.__internals.DEFAULT_TARGETS], ['glob', 'grep']);
});

test('barrel index.js 汇总加载且不崩（零宿主静态依赖）', async () => {
  const m = await mod('index.js');
  assert.equal(Object.keys(m).length >= 25, true, 'barrel 导出应覆盖全部子模块');
  assert.ok(m.LEAN_PERSONA_SUFFIX && m.PRUNE_MARKER && m.deliveryGateApply && m.installToolConcurrency);
});
