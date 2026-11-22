// test/integration-preset.test.mjs - master 集成测试：frag-preset.patch.yml 是 preset 行唯一生效 owner
// 并集快照（frag-lean 覆写块 20 行 + toolface 行）+ persona suffix 模块同源（LEAN + ROUTER_PROMPT，占位已替换）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAN_PERSONA_SUFFIX, ROUTER_SLOT_COMMENT } from '../lib/lean/persona-text.js';
import { ROUTER_PROMPT } from '../lib/router.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');
const frag = readFileSync(join(ROOT, 'presets/base/frag-preset.patch.yml'), 'utf8');

function suffixBlock(text) {
  const ls = text.split(/\r?\n/);
  const i = ls.findIndex(l => /^          suffix:/.test(l));
  if (i < 0) return null;
  const out = [];
  for (let k = i + 1; k < ls.length; k++) {
    const l = ls[k];
    if (l.trim() === '') { out.push(''); continue; }
    if (/^ {12,}/.test(l)) { out.push(l.slice(12)); continue; }
    break;
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  return out.join('\n');
}

test('frag-preset 是 preset 行唯一生效 owner：21 行并集、无重复、toolface 收尾', () => {
  const ids = frag.split(/\r?\n/).filter(l => /^      - id: /.test(l)).map(l => /^      - id: (.+)$/.exec(l)[1].trim());
  assert.equal(ids.length, 21, '并集行数 = 覆写块 20 + toolface（ptc-runtime 属宿主层，不进 preset）');
  assert.equal(new Set(ids).size, ids.length, '无重复 id');
  assert.equal(ids[ids.length - 1], 'toolface', 'toolface 最后（遮蔽面与 preset 同行生效）');
  assert.ok(!ids.includes('ptc-runtime'), 'ptc-runtime 由宿主 dsh-base 挂载，放进 preset 会让整条 preset 激活失败（1.0.3 事故回归）');
  for (const id of ['persona', 'agent-instructions', 'skill-filesystem', 'skill-lean-router', 'planning', 'compaction', 'delegation', 'tool-todo', 'tool-web', 'present', 'toolface']) {
    assert.ok(ids.includes(id), '缺行: ' + id);
  }
  assert.ok(!ids.includes('preset-lean-router-balance'), 'balance 是独立行，不在并集行 id 内');
  assert.ok(!ids.includes('lean-delivery-gate') && !ids.includes('lean-concurrency'), '交付门/并发标记是独立行，不在并集行 id 内');
});

test('persona suffix 与模块同源：LEAN 纪律拼 ROUTER_PROMPT，占位已替换', () => {
  const got = suffixBlock(frag);
  assert.ok(got && got.length > 0, '找到 suffix 块');
  const routerText = Array.isArray(ROUTER_PROMPT) ? ROUTER_PROMPT.join('\n') : String(ROUTER_PROMPT);
  const want = LEAN_PERSONA_SUFFIX.split(ROUTER_SLOT_COMMENT).join(routerText);
  assert.equal(got, want, 'suffix 必须与模块组合逐字符一致（同源防漂移）');
  assert.ok(!got.includes(ROUTER_SLOT_COMMENT), '票 05 拼接占位已被 ROUTER_PROMPT 替换');
  assert.ok(got.includes(routerText), '路由分类指令已常驻 suffix（v1 裁定）');
});

test('toolface 关键配置在并集快照内', () => {
  assert.ok(frag.includes("name: 'dsh-lean-router/toolface'"), 'toolface 插件行在并集内');
  assert.ok(frag.includes('runToolName: code_run'), '传输工具名 code_run');
  assert.ok(/hiddenPrefixes:\s*\n\s*- 'mcp__'/.test(frag), 'hiddenPrefixes 默认值');
  assert.ok(frag.includes('maxParallelSubCalls: 10'), '并行上限');
  assert.ok(!/^\s*- id: .*run_code/m.test(frag), '不得注册保留名 run_code');
});
