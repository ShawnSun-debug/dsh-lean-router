// test/lean-frag.test.mjs —— frag-lean.patch.yml 形态与模块同源（验收项 2：顶层为列表续项）
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const fragPath = ROOT + 'presets/base/frag-lean.patch.yml';
const basePath = ROOT + 'presets/base/lean-router.patch.yml';

test('分片存在且顶层为 YAML 块序列续项（首个非注释行为顶层列表项）', async () => {
  const frag = await readFile(fragPath, 'utf8');
  const firstLine = frag.split('\n').map((l) => l.trim()).find((l) => l.length > 0 && !l.startsWith('#'));
  assert.ok(firstLine.startsWith('- '), '首个非注释行必须是顶层块序列项（- 开头），got: ' + firstLine);
  // 所有顶层项都在 0 列
  const topLevel = frag.split('\n').filter((l) => /^- /.test(l) || /^-insert/.test(l));
  assert.ok(topLevel.length >= 4, '至少 4 个顶层项（裸覆写行 + 3 个 insert 块）');
  assert.equal(frag.split('\n').filter((l) => l.startsWith('- ')).length, 4, '顶层项恰好 4 个：裸行 + balance + delivery-gate + concurrency');
});

test('裸覆写行重声明 preset-lean-router 完整 config（dsh-app-boot config 整键替换形态）', async () => {
  const frag = await readFile(fragPath, 'utf8');
  assert.ok(frag.includes('- id: preset-lean-router\n  name: \'@deepseek-ai/dsh-agent-preset\'\n  config:'), '裸覆写行形态');
  assert.ok(frag.includes('    id: lean-router'));
  assert.ok(frag.includes('    order: 30'));
  // 口径数值（机制 1/2）
  assert.ok(frag.includes('thresholdRatio: 0.25'));
  assert.ok(frag.includes('retainTokens: 20000'));
  assert.ok(frag.includes('compactionRetries: 1'));
  assert.ok(frag.includes('auto: true'));
  assert.ok(frag.includes('thresholdChars: 8192'));
  assert.ok(frag.includes('headChars: 4096'));
  assert.ok(frag.includes('tailChars: 1024'));
});

test('机制 3：六件 disabled 全在分片（五件在 delegation 组 + plugin-manager 在预设顶层）', async () => {
  const frag = await readFile(fragPath, 'utf8');
  for (const id of ['tool-subagent-codex', 'tool-subagent-claude-code', 'workflow-ptc', 'tool-workflow', 'tool-ralph', 'tool-plugin-manager']) {
    assert.ok(frag.includes('- id: ' + id), '缺 disabled 行：' + id);
  }
  assert.ok(frag.includes('        disabled: true'));
});

test('balance 预设行与两个 bundle 插件行就位', async () => {
  const frag = await readFile(fragPath, 'utf8');
  assert.ok(frag.includes('- id: preset-lean-router-balance'));
  assert.ok(frag.includes('      id: lean-router-balance'));
  assert.ok(frag.includes('      order: 29'));
  assert.ok(frag.includes('- id: lean-delivery-gate'));
  assert.ok(frag.includes("name: 'dsh-lean-router/lean/delivery-gate'"));
  assert.ok(frag.includes('      enabled: false'));
  assert.ok(frag.includes('- id: lean-concurrency'));
  assert.ok(frag.includes("name: 'dsh-lean-router/lean/tool-concurrency'"));
  assert.ok(frag.includes('        enabled: true'));
});

test('拼接占位行在分片的两个 suffix 内（不写路由内容）', async () => {
  const frag = await readFile(fragPath, 'utf8');
  const slots = frag.match(/# \[ticket-05\] 路由分类指令由票 05 拼接/g) || [];
  assert.equal(slots.length, 2, 'lean 与 balance 两个 suffix 各一行占位');
  assert.ok(!frag.includes('band=spec') && !frag.includes('[router] band='), '不得自行写路由内容（票 05 的）');
});

test('数据同源：分片内 persona suffix / plan-mode section 与 lib/lean 模块逐字符一致', async () => {
  const frag = await readFile(fragPath, 'utf8');
  const persona = await import(new URL('../lib/lean/persona-text.js', import.meta.url).href + '?v=' + Date.now());
  const planMode = await import(new URL('../lib/lean/plan-mode.js', import.meta.url).href + '?v=' + Date.now());
  // 从 YAML literal block 提取：suffix 键缩进 10 → 内容缩进 12
  const extract = (text, keyIndent) => {
    const lines = text.split('\n');
    const idx = lines.findIndex((l) => l.startsWith(' '.repeat(keyIndent) + 'suffix: |-'));
    assert.ok(idx >= 0, '找到 suffix 块');
    const pad = ' '.repeat(keyIndent + 2);
    const out = [];
    for (let i = idx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (l === '') { out.push(''); continue; }
      if (l.startsWith(pad)) { out.push(l.slice(pad.length)); continue; }
      break;
    }
    while (out.length > 0 && out[out.length - 1] === '') out.pop();
    return out.join('\n');
  };
  const leanIdx = frag.indexOf('- id: persona');
  const leanPart = frag.slice(leanIdx, frag.indexOf('- id: agent-instructions'));
  assert.equal(extract(leanPart, 10), persona.LEAN_PERSONA_SUFFIX, 'lean suffix 与模块逐字符一致');
  const balIdx = frag.indexOf('- id: preset-lean-router-balance');
  const balPart = frag.slice(balIdx);
  assert.equal(extract(balPart, 12), persona.BALANCE_PERSONA_SUFFIX, 'balance suffix 与模块逐字符一致');
  // plan-mode section：键缩进 14 → 内容缩进 16
  const planIdx = frag.indexOf('- id: plan-mode');
  const planPart = frag.slice(planIdx, frag.indexOf('      # 机制 1'));
  const pad = ' '.repeat(16);
  const secIdx = planPart.split('\n').findIndex((l) => l.startsWith('              section: |'));
  assert.ok(secIdx >= 0, '找到 section 块');
  const secLines = planPart.split('\n').slice(secIdx + 1);
  const out = [];
  for (const l of secLines) {
    if (l === '') { out.push(''); continue; }
    if (l.startsWith(pad)) { out.push(l.slice(pad.length)); continue; }
    break;
  }
  while (out.length > 0 && out[out.length - 1] === '') out.pop();
  assert.equal(out.join('\n'), planMode.PLAN_MODE_SECTION, 'plan-mode section 与模块逐字符一致');
});

test('（宿主 yaml 可用时）合并后整文件可解析且行形态符合预期', async (t) => {
  let yaml = null;
  try {
    const { pathToFileURL } = await import('node:url');
    const mod = await import(pathToFileURL('D:/Deepseek Harness/resources/app.asar/dsh/node_modules/yaml/dist/index.js').href);
    yaml = mod.parse ? mod : mod.default;
  } catch (e) { yaml = null; }
  if (!yaml || typeof yaml.parse !== 'function') {
    // 说明：宿主包树位于 app.asar（Electron 归档）内，纯 node 子进程读不到其中文件，
    // 因此 yaml 只在 Electron 侧可解析；本测试在纯 node 下跳过，静态断言已覆盖结构，
    // 真实合并复验由 master 用宿主 --dump-config 执行（验收项 2 已标注待复验）。
    t.skip('宿主 yaml 在 app.asar 内、纯 node 不可读；静态断言已覆盖，合并复验归 master');
    return;
  }
  const base = await readFile(basePath, 'utf8');
  const frag = await readFile(fragPath, 'utf8');
  const doc = yaml.parse(base + (frag.endsWith('\n') ? frag : frag + '\n'), { schema: 'core' });
  assert.equal(doc.length, 5, '合并后顶层 5 项：base insert + 裸覆写 + balance + delivery-gate + concurrency');
  const override = doc.find((d) => d.id === 'preset-lean-router');
  assert.equal(override.config.plugins.length, 20);
  const deleg = override.config.plugins.find((p) => p.id === 'delegation');
  assert.deepEqual(deleg.config.filter((c) => c.disabled === true).map((c) => c.id), ['tool-subagent-codex', 'tool-subagent-claude-code', 'workflow-ptc', 'tool-workflow', 'tool-ralph']);
  const balance = doc.find((d) => d.insert && d.insert[0] && d.insert[0].id === 'preset-lean-router-balance');
  assert.equal(balance.insert[0].config.plugins.find((p) => p.id === 'persona').config.suffix.match(/^\d+\./gm).length, 3);
  // 合并复验由 master 做（--dump-config）；本断言只保证 YAML 层可解析与行形态。
});
