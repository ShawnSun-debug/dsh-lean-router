// scripts/integrate-preset.mjs - master 集成：生成 frag-preset.patch.yml（preset 行并集快照，最后声明者生效）
// 裁定依据：cordis patch 对 preset 行是键级整体替换，frag-lean 与 frag-toolface 的同 id 裸覆写会互相清场；
// 本片把 base 12 行 + lean 层行（frag-lean 覆写块）+ toolface 行（frag-toolface）收敛为并集，排在 FRAGMENTS 最后。
// persona suffix 由 lib/lean/persona-text.js 与 lib/router.js 同源生成（改模块后重跑本脚本 + npm run build 即同步）。
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LEAN_PERSONA_SUFFIX, ROUTER_SLOT_COMMENT } from '../lib/lean/persona-text.js';
import { ROUTER_PROMPT } from '../lib/router.js';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '..');

function lines(t) { return t.split(/\r?\n/); }
function topLevelSlices(text) {
  const ls = lines(text);
  const marks = [];
  ls.forEach((l, i) => { if (/^- (id|insert):/.test(l)) marks.push(i); });
  const slices = [];
  for (let k = 0; k < marks.length; k++) {
    slices.push({ start: marks[k], end: (k + 1 < marks.length ? marks[k + 1] : ls.length), head: ls[marks[k]] });
  }
  return { ls, slices };
}
function rowsOf(blockLines) {
  const idxs = [];
  blockLines.forEach((l, i) => { if (/^      - id: /.test(l)) idxs.push(i); });
  return idxs.map((ri, k) => {
    const end = (k + 1 < idxs.length ? idxs[k + 1] : blockLines.length);
    const m = /^      - id: (.+)$/.exec(blockLines[ri]);
    return { id: m[1].trim(), text: blockLines.slice(ri, end) };
  });
}

// 1) frag-lean 的 preset 覆写块（wrapper + 行）
const leanTop = topLevelSlices(readFileSync(join(ROOT, 'presets/base/frag-lean.patch.yml'), 'utf8'));
const ov = leanTop.slices.find(s => /^- id: preset-lean-router$/.test(s.head));
if (!ov) throw new Error('frag-lean 未找到 preset-lean-router 覆写块');
const ovLines = leanTop.ls.slice(ov.start, ov.end);
const pluginsIdx = ovLines.findIndex(l => /^    plugins:\s*$/.test(l));
if (pluginsIdx < 0) throw new Error('覆写块未找到 plugins: 行');
const wrapper = ovLines.slice(0, pluginsIdx + 1);
const ovRows = rowsOf(ovLines);

// 2) frag-toolface 的 toolface 行
const tfTop = topLevelSlices(readFileSync(join(ROOT, 'presets/base/frag-toolface.patch.yml'), 'utf8'));
const tfOv = tfTop.slices.find(s => /^- id: preset-lean-router$/.test(s.head));
if (!tfOv) throw new Error('frag-toolface 未找到 preset 行块');
const tfRow = rowsOf(leanTop.ls.slice(0, 0).concat(leanTop.ls.slice(0, 0))).length === 0 ? null : null;
const tfRowsAll = rowsOf(tfTop.ls.slice(tfOv.start, tfOv.end));
const toolfaceRow = tfRowsAll.find(r => r.id === 'toolface');
if (!toolfaceRow) throw new Error('frag-toolface 未找到 toolface 行');

// 3) persona suffix 同源组合
if (!LEAN_PERSONA_SUFFIX.includes(ROUTER_SLOT_COMMENT)) throw new Error('LEAN_PERSONA_SUFFIX 缺 ROUTER_SLOT_COMMENT 占位');
const routerText = Array.isArray(ROUTER_PROMPT) ? ROUTER_PROMPT.join('\n') : String(ROUTER_PROMPT);
const composed = LEAN_PERSONA_SUFFIX.split(ROUTER_SLOT_COMMENT).join(routerText);

// 4) 替换 persona 行 suffix 块（prefix 等其余键逐字保留）
const personaRow = ovRows.find(r => r.id === 'persona');
if (!personaRow) throw new Error('覆写块未找到 persona 行');
const pr = personaRow.text;
const sufIdx = pr.findIndex(l => /^          suffix:/.test(l));
if (sufIdx < 0) throw new Error('persona 行未找到 suffix: 键');
let contentIndent = '            ';
for (let i = sufIdx + 1; i < pr.length; i++) {
  if (pr[i].trim().length > 0) { contentIndent = pr[i].match(/^\s*/)[0]; break; }
}
const newPersona = pr.slice(0, sufIdx + 1).concat(composed.split('\n').map(l => (l.length ? contentIndent + l : '')));

// 5) 并集 = 覆写块全部行（persona 换 composed）+ master 补挂行 + toolface 行收尾
// ptc-runtime 行：宿主 dsh-base/cordis.patch.yml L407-408 同款（0.2.2-rc.5 实读）；
// codemode 上游补丁不带此行，而 code_run 的 transport.js:221-224 依赖 ctx.get('ptcRuntime') 服务，
// 缺行会在运行时兜底报错——由 master 集成补挂（票 08 open_question 5 裁定）。
const extraRows = [
  { id: 'ptc-runtime', text: ['      - id: ptc-runtime', "      name: '@deepseek-ai/dsh-ptc-runtime-node'", ''] },
];
const unionRows = ovRows.map(r => (r.id === 'persona' ? { id: 'persona', text: newPersona } : r)).concat(extraRows).concat([toolfaceRow]);
const ids = unionRows.map(r => r.id);
if (new Set(ids).size !== ids.length) throw new Error('并集行 id 重复: ' + ids.join(','));
if (ids[ids.length - 1] !== 'toolface') throw new Error('toolface 行必须收尾');
const leanExtra = ids.filter(x => !['persona', 'agent-instructions', 'tool-bash', 'tool-pwsh', 'tool-fs', 'tool-fs-search', 'tool-jobs', 'skill-filesystem', 'skill-lean-router', 'tool-skill', 'command-goal', 'tool-goal', 'toolface'].includes(x));
console.log('[integrate] rows=' + ids.length + ' leanExtra=' + leanExtra.join(','));

// 6) 写 frag-preset.patch.yml
const header = [
  '# dsh-lean-router frag-preset.patch.yml - master 集成产物（票 03/04/05/06 preset 行收敛）',
  '# 唯一生效 owner：cordis patch 键级整体替换 + 本片在 FRAGMENTS 最后 → apply 时以本片为准。',
  '# frag-lean / frag-toolface 的同 id 覆写保留原文件（其自测不动），apply 时被本片覆盖。',
  '# persona suffix = LEAN_PERSONA_SUFFIX（lean 13 纪律 + 3 软门 + 自检钩）拼接 ROUTER_PROMPT（首轮 [router] 分类指令），',
  '# 由 lib/lean/persona-text.js 与 lib/router.js 同源生成；改动模块后重跑本脚本 + npm run build 即同步。',
  '# v1 裁定（master）：三带 persona 不常驻 suffix，走 pre-step 近场引导分流；balance 预设行 v1 不拼路由指令（见票 08）。',
].join('\n');
const out = header + '\n' + wrapper.join('\n') + '\n' + unionRows.map(r => r.text.join('\n')).join('\n') + '\n';
writeFileSync(join(ROOT, 'presets/base/frag-preset.patch.yml'), out, 'utf8');
console.log('[integrate] frag-preset.patch.yml bytes=' + Buffer.byteLength(out));

// 7) build-bundle.mjs 的 FRAGMENTS 追加本片（保持最后）
const bbPath = join(ROOT, 'scripts/build-bundle.mjs');
const bb = readFileSync(bbPath, 'utf8');
const fromFrag = 'const FRAGMENTS = ["frag-lean.patch.yml", "frag-toolface.patch.yml", "frag-router.patch.yml"];';
const toFrag = 'const FRAGMENTS = ["frag-lean.patch.yml", "frag-toolface.patch.yml", "frag-router.patch.yml", "frag-preset.patch.yml"];';
if (bb.includes(toFrag)) {
  console.log('[integrate] FRAGMENTS already includes frag-preset (skip, idempotent)');
} else if (bb.includes(fromFrag)) {
  writeFileSync(bbPath, bb.split(fromFrag).join(toFrag), 'utf8');
  console.log('[integrate] FRAGMENTS updated (frag-preset last)');
} else {
  throw new Error('build-bundle.mjs FRAGMENTS 行形态不符');
}
