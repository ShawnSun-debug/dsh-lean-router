// test/lean-delivery-gate.test.mjs —— 加料件：交付门（默认关闭、关闭态零注入、钩子登记、无工作区跳过）
import test from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../lib/lean/', import.meta.url);
const m = await import(new URL('delivery-gate.js', base).href + '?v=' + Date.now());

test('默认关闭；DSH_DELIVERY_GATE=0/1 语义（上游 L53-59）', () => {
  const saved = process.env.DSH_DELIVERY_GATE;
  try {
    delete process.env.DSH_DELIVERY_GATE;
    assert.equal(m.__internals.isOff(m.__internals.maybeResolve({})), true, '缺省关闭');
    assert.equal(m.__internals.isOff(m.__internals.maybeResolve({ enabled: true })), false);
    process.env.DSH_DELIVERY_GATE = '0';
    assert.equal(m.__internals.isOff(m.__internals.maybeResolve({ enabled: true })), true, 'env=0 强制关');
    process.env.DSH_DELIVERY_GATE = '1';
    assert.equal(m.__internals.isOff(m.__internals.maybeResolve({})), false, 'env=1 强制开');
  } finally {
    if (saved === undefined) delete process.env.DSH_DELIVERY_GATE; else process.env.DSH_DELIVERY_GATE = saved;
  }
});

test('section：关闭态返回空串（装配时被丢掉），开启态返回门提示', () => {
  const saved = process.env.DSH_DELIVERY_GATE;
  try {
    delete process.env.DSH_DELIVERY_GATE;
    let captured = null;
    const ctx = { systemPrompt: { section: (s) => { captured = s; } }, effect() {} };
    m.apply(ctx, {});
    assert.equal(captured.text(), '', '关闭时一个字都不注入（上游 L217-229）');
    assert.equal(captured.name, 'lean-delivery-gate');
    assert.equal(captured.order, 42);
  } finally {
    if (saved === undefined) delete process.env.DSH_DELIVERY_GATE; else process.env.DSH_DELIVERY_GATE = saved;
  }
});

test('apply 登记效果；无工作区/无脚本的回合直接跳过（不跑脚本、不 steer）', async () => {
  const saved = process.env.DSH_DELIVERY_GATE;
  delete process.env.DSH_DELIVERY_GATE;
  try {
    let onHandler = null;
    const ctx = {
      systemPrompt: { section() {} },
      on(event, handler) { assert.equal(event, 'agent/turn-stopping'); onHandler = handler; return () => {}; },
      effect(factory) { factory(); },
      get(name) { return undefined; },
    };
    m.apply(ctx, { enabled: true, scripts: ['definitely-missing-verify-script.txt'] });
    assert.equal(typeof onHandler, 'function', 'turn-stopping 钩子已登记');
    const agent = { session: { id: 's-gate-test' }, steer() { throw new Error('should not steer'); } };
    // session 无 cwd 字段 → resolveCwd 返回 null → 跳过（上游 L238 同语义）
    await onHandler({ agent, turn: 1, signal: undefined });
    assert.ok(true, '无工作区时静默跳过、不抛错');
  } finally {
    if (saved === undefined) delete process.env.DSH_DELIVERY_GATE; else process.env.DSH_DELIVERY_GATE = saved;
  }
});

test('校验：未知键拒绝；空 scripts 回落默认；非正整数拒绝', () => {
  assert.throws(() => m.validateDeliveryGateConfig({ bogus: 1 }), /unknown key/);
  assert.throws(() => m.validateDeliveryGateConfig({ maxRounds: 0 }), /positive integer/);
  const cfg = m.validateDeliveryGateConfig({ scripts: [] });
  assert.deepEqual(cfg.scripts, process.platform === 'win32' ? ['verify.ps1', 'verify.sh'] : ['verify.sh', 'verify.ps1'], '空数组回落默认（上游 maybeResolve 同语义）');
});

test('无顶层静态宿主依赖：源码级断言（缺宿主依赖也不得加载即崩）', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../lib/lean/delivery-gate.js', import.meta.url), 'utf8');
  assert.ok(!/^import .*@deepseek-ai/m.test(src), '不得顶层静态 import @deepseek-ai/*（须动态 import + 显式降级）');
  assert.ok(!/^import .*zod/m.test(src), '不得顶层静态 import zod');
  assert.ok(/await import\('@deepseek-ai\/dsh-llm'\)/.test(src), 'createUserMessage 走动态 import');
  // 纯 node 环境本模块已成功加载（上一测试文件已 import），说明无加载即崩路径
  assert.ok(m.__internals && m.__internals.MIN_GAP_MS === 15000);
});
