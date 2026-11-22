// test/lean-pruner.test.mjs —— 机制 2：裁剪口径、不变量与 pruneText 行为（验收项 5 之参数覆盖）
import test from 'node:test';
import assert from 'node:assert/strict';

const base = new URL('../lib/lean/', import.meta.url);
const m = await import(new URL('pruner.js', base).href + '?v=' + Date.now());

test('口径照抄 flash 实测：8192 / 4096 / 1024；marker 与宿主同文', () => {
  assert.deepEqual({ ...m.LEAN_PRUNER_CONFIG }, { thresholdChars: 8192, headChars: 4096, tailChars: 1024 });
  assert.equal(m.PRUNE_MARKER, '\n\n[... tool result middle pruned ...]\n\n');
});

test('不变量：headChars + marker + tailChars <= thresholdChars（宿主 L43-44 同判据）', () => {
  // lean 口径本身合法
  assert.deepEqual({ ...m.validatePrunerConfig({}) }, { thresholdChars: 8192, headChars: 4096, tailChars: 1024 });
  // 违反不变量即抛（flash 四机制文档 L92-93：这三个数不能随手乱配）
  assert.throws(() => m.validatePrunerConfig({ thresholdChars: 5000 }), /must be at most thresholdChars/);
  assert.throws(() => m.validatePrunerConfig({ thresholdChars: 0 }), /positive integer/);
  assert.throws(() => m.validatePrunerConfig({ headChars: -1 }), /non-negative/);
  assert.throws(() => m.validatePrunerConfig({ bogus: 1 }), /unknown key/);
});

test('pruneText：未超阈值返回 null；超阈值保头 4096 + marker + 尾 1024', () => {
  assert.equal(m.pruneText('abc'), null);
  assert.equal(m.pruneText('x'.repeat(8192)), null, '恰好等于阈值不裁');
  const pruned = m.pruneText('x'.repeat(10000));
  assert.ok(pruned.startsWith('x'.repeat(4096)));
  assert.ok(pruned.endsWith('x'.repeat(1024)));
  assert.ok(pruned.includes('[... tool result middle pruned ...]'));
  assert.ok(m.codePointLength(pruned) <= 8192, '裁后不超过阈值');
});

test('pruneText 按码点切分：CJK 与代理对不被拆（宿主 codePointLength 同语义）', () => {
  const cjk = '汉'.repeat(9000); // 9000 码点
  const pruned = m.pruneText(cjk);
  assert.ok(pruned.startsWith('汉'.repeat(4096)));
  assert.ok(pruned.endsWith('汉'.repeat(1024)));
  const emoji = '😀'.repeat(9000); // 9000 码点（= 18000 UTF-16 单元），码点数 > 8192 才触发
  const pe = m.pruneText(emoji);
  assert.ok(!pe.includes('\uFFFD'), '不得出现替换符（代理对被拆的迹象）');
  assert.ok(pe.startsWith('😀'.repeat(4096)));
});
