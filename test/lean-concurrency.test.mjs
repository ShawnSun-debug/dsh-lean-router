// test/lean-concurrency.test.mjs —— 加料件：glob/grep 只读并发标记（假 ctx；仿上游 test/tool-concurrency.mjs）
import test from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../lib/lean/', import.meta.url);
const m = await import(new URL('tool-concurrency.js', base).href + '?v=' + Date.now());

const makeTools = (globalDefs, scoped = {}) => ({
  get(name, scope) {
    if (scope === undefined) return globalDefs[name];
    return scoped[scope.id] ? scoped[scope.id][name] : undefined;
  },
});
const quiet = async (fn) => {
  const origInfo = console.info, origError = console.error;
  const logs = [];
  console.info = (line) => logs.push(String(line));
  console.error = (line) => logs.push(String(line));
  try { return await fn(logs); } finally { console.info = origInfo; console.error = origError; }
};

test('标记 glob/grep：分类函数返回 true（调度器只认 === true）', () => {
  const defs = { glob: { name: 'glob' }, grep: { name: 'grep' } };
  const r = m.markConcurrencySafe(makeTools(defs), ['glob', 'grep']);
  assert.deepEqual(r.marked, ['glob', 'grep']);
  assert.equal(defs.glob.isConcurrencySafe({ pattern: '*' }), true);
});

test('幂等与不覆盖上游声明', () => {
  const defs = { glob: { name: 'glob', isConcurrencySafe: () => true } };
  const r = m.markConcurrencySafe(makeTools(defs), ['glob']);
  assert.deepEqual(r.marked, []);
  assert.deepEqual(r.kept, ['glob']);
  const upstream = () => false;
  const defs2 = { grep: { name: 'grep', isConcurrencySafe: upstream } };
  m.markConcurrencySafe(makeTools(defs2), ['grep']);
  assert.equal(defs2.grep.isConcurrencySafe, upstream, '上游已声明的函数身份不变');
});

test('missing / failed 分类；unmark 撤标记', () => {
  assert.deepEqual(m.markConcurrencySafe(makeTools({}), ['glob']).missing, ['glob']);
  assert.equal(m.markConcurrencySafe(undefined, ['glob']).failed.length, 1);
  const frozen = { glob: Object.freeze({ name: 'glob' }) };
  assert.equal(m.markConcurrencySafe(makeTools(frozen), ['glob']).failed.length, 1);
  const defs = { glob: { name: 'glob' } };
  const tools = makeTools(defs);
  m.markConcurrencySafe(tools, ['glob']);
  m.unmarkConcurrencySafe(tools, ['glob']);
  assert.equal(defs.glob.isConcurrencySafe, undefined);
});

test('parseTargets：数组 / 逗号串 / 默认', () => {
  assert.deepEqual(m.__internals.parseTargets(['a', 'b']), ['a', 'b']);
  assert.deepEqual(m.__internals.parseTargets('glob, grep'), ['glob', 'grep']);
  assert.deepEqual(m.__internals.parseTargets(undefined), ['glob', 'grep']);
});

test('install：全局 + 会话作用域都标记，打出生效行；卸载撤销', async () => {
  const globalDefs = { glob: { name: 'glob' }, grep: { name: 'grep' } };
  const agent = { id: 's1' };
  const scoped = { s1: { glob: { name: 'glob' }, grep: { name: 'grep' } } };
  await quiet(async (logs) => {
    let disposer = null;
    const ctx = {
      inject(names, fn) { assert.deepEqual(names, ['tools', 'agents']); fn({ tools: makeTools(globalDefs, scoped), agents: { list: () => [agent] } }); },
      effect(factory) { disposer = factory(); },
    };
    const r = m.installToolConcurrency(ctx, { version: 'test' });
    assert.equal(r.installed, true);
    assert.equal(globalDefs.glob.isConcurrencySafe({ pattern: '*' }), true);
    assert.equal(scoped.s1.grep.isConcurrencySafe({ pattern: '*' }), true);
    assert.ok(logs.some((l) => l.includes('生效') && l.includes('targets=glob,grep')), '应打唯一生效行：' + logs.join(' | '));
    assert.ok(logs.some((l) => l.includes('witness=glob=true')), '应打调度器判据：' + logs.join(' | '));
    disposer();
    assert.equal(globalDefs.glob.isConcurrencySafe, undefined, '卸载应撤销全局标记');
    assert.equal(scoped.s1.grep.isConcurrencySafe, undefined, '卸载应撤销会话标记');
  });
});

test('install：本包与兼容环境变量任一置 0 都不动作', async () => {
  const cases = ['DSH_LEAN_ROUTER_CONCURRENCY', 'DSH_FLASH_PRESETS_CONCURRENCY'];
  for (const env of cases) {
    process.env[env] = '0';
    try {
      await quiet(async (logs) => {
        const r = m.installToolConcurrency({ inject() {}, effect() {} }, {});
        assert.equal(r.installed, false);
        assert.ok(logs.some((l) => l.includes('未启用') && l.includes(env)), env + ' 应被识别：' + logs.join(' | '));
      });
    } finally { delete process.env[env]; }
  }
});

test('config 关闭：toolConcurrency.enabled=false 不动作', async () => {
  await quiet(async () => {
    const r = m.installToolConcurrency({ inject() {}, effect() {} }, { enabled: false });
    assert.equal(r.installed, false);
    assert.equal(r.reason, 'config:toolConcurrency.enabled=false');
  });
});

test('默认插件导出：apply 走同一 install 路径（config.toolConcurrency 形状）', async () => {
  const globalDefs = { glob: { name: 'glob' } };
  await quiet(async () => {
    let disposer = null;
    const ctx = {
      inject(names, fn) { fn({ tools: makeTools(globalDefs), agents: { list: () => [] } }); },
      effect(factory) { disposer = factory(); },
    };
    const r = m.default.apply(ctx, { toolConcurrency: { sweepMs: 1000 } });
    assert.equal(r.installed, true);
    assert.equal(globalDefs.glob.isConcurrencySafe({ pattern: '*' }), true);
    if (disposer) disposer();
  });
});
