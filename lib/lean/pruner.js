// dsh-lean-router · lib/lean/pruner.js —— 机制 2 · 工具输出裁剪（参数 + marker + 纯函数端口）
//
// 口径来源（lean 口径照抄 flash 实测，约束台账 v1 第 2 条）：
//   上游 D:\Agent Workspace\.scratch\upstream\flash-presets\presets\flash-lean-ptc-v3.patch.yml
//   L129-133（balance 档 L87-91 同值）：thresholdChars 8192 / headChars 4096 / tailChars 1024。
//   裁剪机理（头=结构、尾=结论、中段=重复；中段替换为固定 marker）：
//   docs/技术文档-省token四机制.md L71-113。
// marker 与不变量镜像宿主：
//   D:\Deepseek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-compaction-tool-result-pruner\lib\index.js
//   L8（PRUNE_MARKER 原文）、L10-14（默认值）、L25-27（codePointLength 按码点计）、
//   L43-44（headChars + marker + tailChars 必须 <= thresholdChars，否则抛错）、
//   L91-124（pruneContent：按码点切，不拆代理对）。
// 零依赖：纯函数，任何环境可独立加载。
//
// 注意：执行由宿主 @deepseek-ai/dsh-compaction-tool-result-pruner 完成；本模块的 pruneText
// 是同判据的纯函数端口，供单测与 config 预检复用，不写会话。

/** 宿主 PRUNE_MARKER 原文（dsh-compaction-tool-result-pruner L8）。 */
export const PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n';

/** flash lean 实测口径的裁剪配置（frag-lean.patch.yml tool-result-pruner 行的数据源）。 */
export const LEAN_PRUNER_CONFIG = Object.freeze({
  thresholdChars: 8192,
  headChars: 4096,
  tailChars: 1024,
});

/** 按 Unicode 码点计数（不拆代理对；镜像宿主 codePointLength L25-27）。 */
export function codePointLength(text) {
  return Array.from(text).length;
}

/**
 * 镜像宿主 resolveConfig（L33-46）：未知键拒绝、整数性、以及
 * headChars + marker 码点 + tailChars <= thresholdChars 的硬不变量。
 */
export function validatePrunerConfig(config) {
  for (const key of Object.keys(config)) {
    if (key !== 'thresholdChars' && key !== 'headChars' && key !== 'tailChars') {
      throw new Error('ToolResultPruneConfig: unknown key "' + key + '" (allowed: thresholdChars, headChars, tailChars)');
    }
  }
  const resolved = {
    thresholdChars: config.thresholdChars ?? LEAN_PRUNER_CONFIG.thresholdChars,
    headChars: config.headChars ?? LEAN_PRUNER_CONFIG.headChars,
    tailChars: config.tailChars ?? LEAN_PRUNER_CONFIG.tailChars,
  };
  if (!Number.isInteger(resolved.thresholdChars) || resolved.thresholdChars <= 0) {
    throw new Error('ToolResultPruneConfig: thresholdChars must be a positive integer');
  }
  for (const name of ['headChars', 'tailChars']) {
    if (!Number.isInteger(resolved[name]) || resolved[name] < 0) {
      throw new Error('ToolResultPruneConfig: ' + name + ' must be a non-negative integer');
    }
  }
  const emitted = resolved.headChars + codePointLength(PRUNE_MARKER) + resolved.tailChars;
  if (emitted > resolved.thresholdChars) {
    throw new Error('ToolResultPruneConfig: headChars + marker + tailChars (' + emitted + ') must be at most thresholdChars (' + resolved.thresholdChars + ')');
  }
  return Object.freeze(resolved);
}

/**
 * pruneText：单条文本超出 thresholdChars 时保留头 headChars + marker + 尾 tailChars。
 * 与宿主 pruneContent（L91-124）同判据：码点切分、不拆代理对；未超阈值返回 null。
 * @returns 裁剪后的文本；未超阈值返回 null。
 */
export function pruneText(text, config) {
  const cfg = validatePrunerConfig({ ...LEAN_PRUNER_CONFIG, ...(config ?? {}) });
  const points = Array.from(text);
  if (points.length <= cfg.thresholdChars) return null;
  const head = points.slice(0, cfg.headChars).join('');
  const tail = points.slice(points.length - cfg.tailChars).join('');
  return head + PRUNE_MARKER + tail;
}
