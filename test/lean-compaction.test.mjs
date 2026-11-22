// test/lean-compaction.test.mjs —— 机制 1：压缩口径与宿主判定公式镜像（验收项 5 之参数覆盖）
import test from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../lib/lean/', import.meta.url);
const m = await import(new URL('compaction.js', base).href + '?v=' + Date.now());

test('口径照抄 flash 实测：0.25 / 20000 / 1 / auto', () => {
  assert.deepEqual({ ...m.LEAN_COMPACTION_CONFIG }, { thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1, auto: true });
});

test('resolveCompactSpec 镜像宿主公式：thresholdTokens = floor(min(cw × ratio, pressureBudget))', () => {
  // 宿主 dsh-compaction-basic/lib/index.js L128-134
  const spec = m.resolveCompactSpec({ ...m.LEAN_COMPACTION_CONFIG }, 1000000, 8192);
  // messageBudget = 1000000 - 8192 = 991808; pressureBudget = 991808 - 65536 = 926272
  // threshold = floor(min(1000000 × 0.25, 926272)) = 250000
  assert.equal(spec.thresholdTokens, 250000);
  assert.equal(spec.retainTokens, 20000);
  assert.equal(spec.pressureBudgetTokens, 926272);
});

test('800k 窗口：阈值压到 200k（flash 文档「把阈值压进够得着的区间」的算例）', () => {
  const spec = m.resolveCompactSpec({ ...m.LEAN_COMPACTION_CONFIG }, 800000, 8192);
  assert.equal(spec.thresholdTokens, 200000);
});

test('retainTokens >= thresholdTokens 抛配置错误（宿主 L134 同判据）', () => {
  assert.throws(() => m.resolveCompactSpec({ thresholdRatio: 0.25, retainTokens: 300000 }, 1000000, 0), /must be less than threshold/);
});

test('窗口减去预留后不够预算时抛错（宿主 L129-131 同语义）', () => {
  // 70000 - 65536 预留后剩 4464，再减 headroom 65536 → pressure budget 耗尽
  assert.throws(() => m.resolveCompactSpec({ ...m.LEAN_COMPACTION_CONFIG }, 70000, 65536), /pressure budget exhausted/);
  // 窗口小于预留（输出 token）→ message budget 耗尽
  assert.throws(() => m.resolveCompactSpec({ ...m.LEAN_COMPACTION_CONFIG }, 5000, 6000), /message budget exhausted/);
});

test('validateCompactionConfig：合法通过；未知键 / 互斥 / 区间 / 整数性拒绝', () => {
  assert.equal(m.validateCompactionConfig({ ...m.LEAN_COMPACTION_CONFIG }), true);
  assert.throws(() => m.validateCompactionConfig({ bogus: 1 }), /unknown key/);
  assert.throws(() => m.validateCompactionConfig({ retainRatio: 0.1, retainTokens: 100 }), /mutually exclusive/);
  assert.throws(() => m.validateCompactionConfig({ thresholdRatio: 1.5 }), /\(0, 1\]/);
  assert.throws(() => m.validateCompactionConfig({ retainRatio: 0.9 }), /must be less than/);
  assert.throws(() => m.validateCompactionConfig({ retainTokens: -1 }), /non-negative/);
  assert.throws(() => m.validateCompactionConfig({ compactionRetries: 1.5 }), /non-negative/);
  assert.throws(() => m.validateCompactionConfig({ auto: 'yes' }), /must be a boolean/);
});
