// dsh-lean-router · lib/lean/index.js —— lean 层 barrel（票 03）
//
// 汇总 lib/lean/ 各模块的导出，便于 doctor/测试一次性核对；每个子模块仍可
// 单独动态 import（各自零宿主静态依赖，见各文件头部）。本 barrel 自身零依赖。
// 机制 → 模块 → frag-lean.patch.yml 行的映射：
//   机制 1 轮次压缩        compaction.js   → compaction 组 compaction-basic 行（0.25/20000/1/auto）
//   机制 2 工具输出裁剪    pruner.js       → compaction 组 tool-result-pruner 行（8192/4096/1024）
//   机制 3 关 6 插件       disabled.js     → delegation 组 disabled 行 + 预设顶层 tool-plugin-manager 行
//   机制 4 行为纪律        persona-text.js → persona 行 suffix（lean 13+软门+自检 / balance 3）
//   plan-mode v1 并入     plan-mode.js    → planning 组 plan-mode 行 section
//   加料 · 交付门          delivery-gate.js → bundle 插件行 'dsh-lean-router/lean/delivery-gate'
//   加料 · glob/grep 并发  tool-concurrency.js → bundle 插件行 'dsh-lean-router/lean/tool-concurrency'
export { LEAN_COMPACTION_CONFIG, HOST_DEFAULTS, resolveCompactSpec, validateCompactionConfig } from './compaction.js';
export { PRUNE_MARKER, LEAN_PRUNER_CONFIG, codePointLength, validatePrunerConfig, pruneText } from './pruner.js';
export { DISABLED_PLUGIN_IDS, DISABLED_PLUGIN_ROWS } from './disabled.js';
export { PERSONA_PREFIX, ROUTER_SLOT_COMMENT, LEAN_SOFT_GATES, LEAN_SELF_CHECK_HOOKS, LEAN_PERSONA_SUFFIX, BALANCE_PERSONA_SUFFIX, PERSONA_TIERS } from './persona-text.js';
export { PLAN_MODE_SECTION, PLANNING_GROUP_ISOLATE } from './plan-mode.js';
export { name as deliveryGateName, inject as deliveryGateInject, apply as deliveryGateApply, validateDeliveryGateConfig } from './delivery-gate.js';
export { markConcurrencySafe, unmarkConcurrencySafe, installToolConcurrency } from './tool-concurrency.js';
