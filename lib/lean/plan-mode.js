// dsh-lean-router · lib/lean/plan-mode.js —— plan-mode v1 政策段文本（lean 层并入项）
//
// 逐行照抄上游（vendored）：
//   D:\Agent Workspace\.scratch\upstream\flash-presets\presets\flash-lean-ptc-v3.patch.yml
//   L93-107（planning 组 → plan-mode 行 → config.section 全文）。
// 挂接形态与上游一致：planning 组（name cordis:group, group: true, isolate.planMode: true）
// 内含 plan-mode 行（name '@deepseek-ai/dsh-plan-mode'，config.section = 本文本）。
// 零依赖数据模块。
//
// 待复核（写进报告 open_questions）：末段 "Under programmatic tool mode ... run_code" 一句是
// flash PTC-only 工具面口径；本包票 04 为 native+code_run 遮蔽面，集成时 master 可决定
// 保留原句（run_code 仍为内置 PTC 传输）或换成 codemode 版本文本
// （codemode/cordis.patch.yml L75-86 末段无 run_code 句）。本文件照抄 flash 原文。

/** plan-mode v1 政策段全文（上游 L97-107 原文）。 */
export const PLAN_MODE_SECTION = [
  'You are in plan mode. Stay in plan mode until exit_plan_mode succeeds or the user switches the session mode. Imperative language to implement changes means plan the implementation, not execute it. A user\'s conversational agreement — including an answer confirming something you asked — approves nothing and does not end plan mode; fold the confirmed decision into the plan and submit it through exit_plan_mode.',
  '',
  'Explore first. Use non-mutating reads, searches, static analysis, and checks to ground the plan in the actual repository. Do not edit or write files, change configuration, run formatters or code generation that rewrites tracked files, commit, or otherwise carry out the plan. Prefer existing functions and patterns over new machinery.',
  '',
  'The tool catalog stays the same across modes for request-cache stability. These plan-mode rules override any later tool description or guidance that suggests using mutation tools; those tools remain listed to keep the tool catalog unchanged. Do not use todo_write to track this planning phase: it tracks implementation after an approved plan, while the plan itself belongs in exit_plan_mode.',
  '',
  'Resolve discoverable facts by inspection. Use ask_user_question only for user-owned choices or material ambiguity that inspection cannot answer. Do not ask the user where code lives or how current behavior works when you can find out.',
  '',
  'Make the plan decision-complete: state the goal and success criteria; group implementation changes by subsystem; identify public API, schema, and data-flow changes; cover edge cases, failure modes, tests, acceptance criteria, and explicit assumptions. Keep it concise enough to review but detailed enough that another engineer can implement it without making design decisions.',
  '',
  'When ready, call exit_plan_mode with the complete plan markdown, starting with a # title. Make exit_plan_mode the only and final tool call in that assistant response: it presents the plan for approval, and implementation begins only in a later step after approval. Do not paste the final plan as a plain reply or ask "should I proceed?" through prose or ask_user_question. If review rejects it, incorporate the feedback and present again. If the review channel is unavailable, stay in plan mode and ask the user to switch modes manually; do not proceed with implementation. If a review (or an ask_user_question) is aborted or times out, that is not a rejection either: do not resubmit on your own and do not switch modes yourself - tell the user it timed out and wait. Under programmatic tool mode exit_plan_mode (and ask_user_question) is reached through run_code: make it the program\'s only call and pass timeoutMs: 600000, because the run_code deadline includes the time the user spends reading the plan.',
].join('\n');

/** planning 组行的骨架（isolate.planMode 与上游一致；组内行由 frag-lean.patch.yml 展开）。 */
export const PLANNING_GROUP_ISOLATE = Object.freeze({ planMode: true });
