// dsh-lean-router · lib/lean/disabled.js —— 机制 3 · 关 6 插件（清单数据）
//
// 逐行照抄上游（vendored，约束台账 v1 第 2 条）：
//   D:\Agent Workspace\.scratch\upstream\flash-presets\presets\flash-lean-ptc-v3.patch.yml
//   L155-168（tool-subagent-codex / tool-subagent-claude-code）、
//   L169-182（workflow-ptc / tool-workflow / tool-ralph）、
//   L200-202（tool-plugin-manager）。
// 这些行属于 frag-lean.patch.yml 里 delegation 组与预设顶层；disabled: true 的插件不加载，
// 其工具 schema 不进系统提示（docs/技术文档-省token四机制.md L119-140）。
// 与 codemode 遮蔽面（native+code_run）的逐项复核结论：docs/复核-关插件清单.md。
// 零依赖数据模块。
//
// 顺序与 id 与上游一致；config 原值保留（maxDepth: provider-managed 为上游原文字面量）。

/** 上游 lean v3 关闭的 6 个插件 id（顺序同上游）。 */
export const DISABLED_PLUGIN_IDS = Object.freeze([
  'tool-subagent-codex',
  'tool-subagent-claude-code',
  'workflow-ptc',
  'tool-workflow',
  'tool-ralph',
  'tool-plugin-manager',
]);

/** 6 行 disabled 行数据（id/name/disabled/config 与上游预设行逐字段一致）。 */
export const DISABLED_PLUGIN_ROWS = Object.freeze([
  Object.freeze({
    id: 'tool-subagent-codex',
    name: '@deepseek-ai/dsh-tool-subagent',
    disabled: true,
    config: Object.freeze({ provider: 'codex', toolName: 'subagent_codex', maxDepth: 'provider-managed' }),
  }),
  Object.freeze({
    id: 'tool-subagent-claude-code',
    name: '@deepseek-ai/dsh-tool-subagent',
    disabled: true,
    config: Object.freeze({ provider: 'claude-code', toolName: 'subagent_claude_code', maxDepth: 'provider-managed' }),
  }),
  Object.freeze({
    id: 'workflow-ptc',
    name: '@deepseek-ai/dsh-workflow-ptc',
    disabled: true,
    config: Object.freeze({ provider: 'spawn' }),
  }),
  Object.freeze({
    id: 'tool-workflow',
    name: '@deepseek-ai/dsh-tool-workflow',
    disabled: true,
  }),
  Object.freeze({
    id: 'tool-ralph',
    name: '@deepseek-ai/dsh-tool-ralph',
    disabled: true,
    config: Object.freeze({ subagentProvider: 'spawn', maxRounds: 64 }),
  }),
  Object.freeze({
    id: 'tool-plugin-manager',
    name: '@deepseek-ai/dsh-plugin-manager/tools',
    disabled: true,
  }),
]);
