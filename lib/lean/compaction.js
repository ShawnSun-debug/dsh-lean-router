// dsh-lean-router · lib/lean/compaction.js —— 机制 1 · 轮次压缩（参数 + 宿主判定公式镜像）
//
// 口径来源（lean 口径照抄 flash 实测，约束台账 v1 第 2 条）：
//   上游 D:\Agent Workspace\.scratch\upstream\flash-presets\presets\flash-lean-ptc-v3.patch.yml
//   L121-133（balance 档 L79-94 同值）：thresholdRatio 0.25 / retainTokens 20000 /
//   compactionRetries 1 / auto true；机理注释（0.8 默认在 1M 窗口 = 800k 才触发、109 次运行
//   0 次触发、压缩是有损摘要）同见 docs/技术文档-省token四机制.md L26-68。
// 判定公式镜像宿主（0.2.2-rc.5 实装，供 config 预检使用）：
//   D:\Deepseek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\dsh-compaction-basic\lib\index.js
//   L15（默认 thresholdRatio 0.8）、L17（默认 retainRatio 0.16）、L63（headroomTokens 默认 65536）、
//   L124-147 resolveCompactSpec（thresholdTokens = floor(min(cw × ratio, pressureBudget))；
//   retainTokens = retainTokens ?? floor(messageBudget × retainRatio)；retain >= threshold → 抛错）、
//   L155-157（retainRatio 必须 < thresholdRatio）、L192（retainRatio 与 retainTokens 互斥）。
// 零依赖：纯函数，任何环境可独立加载。
//
// 注意：本模块只做参数口径与预检，不做压缩执行——执行由宿主 @deepseek-ai/dsh-compaction-basic
// 按 frag-lean.patch.yml 里 compaction 组的 config 完成。

/** flash lean 实测口径的压缩配置（frag-lean.patch.yml compaction-basic 行的数据源）。 */
export const LEAN_COMPACTION_CONFIG = Object.freeze({
  thresholdRatio: 0.25,
  retainTokens: 20000,
  compactionRetries: 1,
  auto: true,
});

/** 宿主默认值（镜像 dsh-compaction-basic L15/L17/L63）。 */
export const HOST_DEFAULTS = Object.freeze({
  thresholdRatio: 0.8,
  retainRatio: 0.16,
  headroomTokens: 65536,
});

const POLICY_KEYS = new Set([
  'thresholdRatio', 'headroomTokens', 'retainRatio', 'retainTokens',
  'summarizationProvider', 'summarizationModel', 'maxTokens', 'compactionRetries', 'maxOverflowRetries',
]);
// 顶层完整键集（镜像宿主 BASIC_COMPACT_CONFIG_KEYS L31-35：多 auto 与 modelPolicies 两键）。
const TOP_LEVEL_KEYS = new Set([...POLICY_KEYS, 'auto', 'modelPolicies']);

/**
 * 镜像宿主 resolveCompactSpec（dsh-compaction-basic L124-147）：把一条路由策略
 * 按模型容量换算成具体 token 预算，并在 retain >= threshold 时抛配置错误。
 * @param policy 含 thresholdRatio/retainTokens|retainRatio/headroomTokens 的策略对象
 * @param contextWindow 该路由声明的上下文窗口（正整数）
 * @param reservedCompletionTokens 单次请求预留的输出 token（非负）
 * @returns deep-frozen 的 {thresholdTokens, retainTokens, ...}
 */
export function resolveCompactSpec(policy, contextWindow, reservedCompletionTokens) {
  if (!Number.isInteger(contextWindow) || contextWindow <= 0) {
    throw new Error('compaction-basic: contextWindow must be a positive integer');
  }
  if (!Number.isInteger(reservedCompletionTokens) || reservedCompletionTokens < 0) {
    throw new Error('compaction-basic: reservedCompletionTokens must be a non-negative integer');
  }
  const messageBudgetTokens = contextWindow - reservedCompletionTokens;
  if (messageBudgetTokens <= 0) {
    throw new Error('compaction-basic: message budget exhausted; raise the adapter contextWindow');
  }
  const headroomTokens = policy.headroomTokens ?? HOST_DEFAULTS.headroomTokens;
  const pressureBudgetTokens = messageBudgetTokens - headroomTokens;
  if (pressureBudgetTokens <= 0) {
    throw new Error('compaction-basic: pressure budget exhausted; reduce maxTokens or headroomTokens');
  }
  const thresholdRatio = policy.thresholdRatio ?? HOST_DEFAULTS.thresholdRatio;
  const thresholdTokens = Math.floor(Math.min(contextWindow * thresholdRatio, pressureBudgetTokens));
  const retainTokens = policy.retainTokens ?? Math.floor(messageBudgetTokens * (policy.retainRatio ?? HOST_DEFAULTS.retainRatio));
  if (retainTokens >= thresholdTokens) {
    throw new Error('compaction-basic: retainTokens (' + retainTokens + ') must be less than threshold tokens ' + thresholdTokens);
  }
  return Object.freeze({
    contextWindow,
    thresholdRatio,
    thresholdTokens,
    retainTokens,
    headroomTokens,
    pressureBudgetTokens,
  });
}

/**
 * 镜像宿主 load 期校验（validatePolicy/validateRatioRetention L155-225）：键集、
 * 比例区间、互斥、整数性。合法返回 true，非法抛 Error。
 */
export function validateCompactionConfig(config) {
  for (const key of Object.keys(config)) {
    if (!TOP_LEVEL_KEYS.has(key)) throw new Error('BasicCompactionConfig: unknown key "' + key + '"');
  }
  const ratio = config.thresholdRatio;
  if (ratio !== undefined && (typeof ratio !== 'number' || !Number.isFinite(ratio) || ratio <= 0 || ratio > 1)) {
    throw new Error('BasicCompactionConfig.thresholdRatio must be a number in (0, 1]');
  }
  const retainRatio = config.retainRatio;
  const retainTokens = config.retainTokens;
  if (retainRatio !== undefined && retainTokens !== undefined) {
    throw new Error('BasicCompactionConfig: retainRatio and retainTokens are mutually exclusive');
  }
  if (retainRatio !== undefined) {
    if (typeof retainRatio !== 'number' || !Number.isFinite(retainRatio) || retainRatio <= 0 || retainRatio > 1) {
      throw new Error('BasicCompactionConfig.retainRatio must be a number in (0, 1]');
    }
    if (retainRatio >= (ratio ?? HOST_DEFAULTS.thresholdRatio)) {
      throw new Error('BasicCompactionConfig: retainRatio must be less than the resolved thresholdRatio');
    }
  }
  if (retainTokens !== undefined) assertNonNegativeInteger('retainTokens', retainTokens);
  if (config.compactionRetries !== undefined) assertNonNegativeInteger('compactionRetries', config.compactionRetries);
  if (config.maxOverflowRetries !== undefined) assertNonNegativeInteger('maxOverflowRetries', config.maxOverflowRetries);
  if (config.auto !== undefined && typeof config.auto !== 'boolean') {
    throw new Error('BasicCompactionConfig: auto must be a boolean');
  }
  return true;
}

function assertNonNegativeInteger(name, value) {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error('BasicCompactionConfig.' + name + ' must be a non-negative integer');
  }
}
