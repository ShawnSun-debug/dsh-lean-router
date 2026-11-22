// dsh-lean-router - 思考链路由三带配置表（票 05）
// 思想来源（只移植结论，不搬代码）：上游 routing-suite 实测 —— DeepSeek persona 轴
// 非连续、分相变，量化为稳定带：spec（先读后改）/ react（直接产出）/ weak（模型自分类）；
// mixed 0.2-0.49 是转换陷阱，永不自动选中。V4.1 Flash 为阈值型：neutral + classify
// few-shot + 三锚（回顾/收敛/反跑题）为实测最优（路由 96%、单任务完成 100%）。
// 本表只交「persona 变体文本常量 + 工具面宽窄标记」；persona suffix 拼接由 master 集成，
// 工具面裁剪归票 04。本模块零外部依赖，纯 node 可测。

/** 三个实测稳定行为带（自动分类只会落在其中之一；'auto' 仅作显式指令值，表示回退自动路由）。 */
export const BAND_IDS = ["spec", "react", "weak"];

/** 显式 [router] 指令里合法的 band 值（含 auto：清除显式覆盖，回退自动分类）。 */
export const DIRECTIVE_BAND_IDS = [...BAND_IDS, "auto"];

/**
 * 近场引导固定文本基调：每带一段、内容恒定（缓存友好）——
 * 同一带内每轮请求渲染同一文本，dynamic context 判定相等即零写入。
 */
const GUIDE_TAIL =
  "Recall what you have already done in this session and continue from there; do not repeat completed steps. Converge on the deliverable; do not expand scope. Return to the task at hand whenever you notice drift.";

/**
 * 三带配置表。
 * - personaText: 该带的 persona 变体文本常量（英文；由 master 拼进 persona suffix）。
 * - toolsWide:   工具面宽窄标记（true=写向宽面，false=读向窄面）。裁剪实现归票 04。
 * - guideText:   近场引导固定文本（dynamic context 通道，见 lib/router.js）。
 */
export const BANDS = {
  spec: {
    id: "spec",
    label: "inspect-and-plan",
    toolsWide: false,
    personaText:
      "Approach each task as an inspector: read before changing. Collect context, locate the exact cause, plan the smallest safe change, then apply and verify. " +
      GUIDE_TAIL,
    guideText:
      "Near-field guide (inspect-and-plan): you are working a fix/inspection task. Read and locate before changing; state the plan when your information is complete, then apply the smallest safe change and verify it. " +
      GUIDE_TAIL,
  },
  react: {
    id: "react",
    label: "hands-on-production",
    toolsWide: true,
    personaText:
      "Approach each task as a builder: produce working increments now. Read only what the next increment needs, make it real, and verify by running it. " +
      GUIDE_TAIL,
    guideText:
      "Near-field guide (hands-on production): you are working a build task. Produce the next working increment now; verify by running it before claiming progress. " +
      GUIDE_TAIL,
  },
  weak: {
    id: "weak",
    label: "model-routed",
    toolsWide: false,
    // weak 带是唯一内路由窗口（实测：模型不能自路由，weak persona + few-shot
    // classify 指令是仅有解；区分度 +2.3..+3.3，lean 不翻转）。
    personaText:
      "You are a generalist. For each new task, first classify it before acting: (build) create something new end-to-end; (fix) diagnose and repair something broken. Adopt the matching style: build -> hands-on production; fix -> inspect-and-plan. " +
      GUIDE_TAIL,
    guideText:
      "Near-field guide (self-routed): classify the current user message before acting - build (create something new) or fix (diagnose and repair) - then follow the matching style for the rest of this turn. " +
      GUIDE_TAIL,
  },
};

/** 任务回显前缀：引导文本里携带显式 task 文本时使用（上游实测：模型每轮看清在为什么事工作）。 */
export const TASK_ECHO_PREFIX = "Task: ";

/** build（react 带）关键词计数词表 —— 自写词表，非上游代码。 */
export const REACT_HINT_RE =
  /(开发|创建|写一个|写个|生成|做一个|做个|搭建|实现|新增|上线|落地|游戏|网页|网站|构建|脚本|工具|应用|从零|新项目|build|create|develop|generate|implement|new project|scaffold|bootstrap)/gi;

/** fix（spec 带）关键词计数词表 —— 自写词表，非上游代码。 */
export const SPEC_HINT_RE =
  /(修复|修一下|调试|排查|报错|出错|崩溃|异常|故障|审查|复核|重构|维护|优化|兼容|迁移|升级|为什么|bug|fix|debug|refactor|maintain|broken|error|investigate|regression|regress)/gi;

function countHits(regex, text) {
  return [...text.matchAll(regex)].length;
}

/**
 * 按首条真实用户消息分类任务带（思想移植、实现重写）：
 * build 类证据占优 -> react；fix 类证据占优 -> spec；平票或无匹配 -> weak
 * （weak 是实测最优的内路由模式：模型按 few-shot 指令自分类）。
 * @param {string} text 用户消息全文
 * @returns {"spec"|"react"|"weak"}
 */
export function classifyTask(text) {
  if (typeof text !== "string" || text.length === 0) return "weak";
  const react = countHits(REACT_HINT_RE, text);
  const spec = countHits(SPEC_HINT_RE, text);
  if (react > spec) return "react";
  if (spec > react) return "spec";
  return "weak";
}

/** 架构型词（深度任务启发）：命中或长文本视为复杂任务（深度引导变体）。 */
const COMPLEX_HINT_RE =
  /(重构|架构|全面|详细|设计|系统|优化|分析|survey|overview|architecture|refactor|comprehensive|detailed|design|system|optimize|analyze)/i;

/** 简单任务给快收敛引导；复杂任务给深度引导（深度自适应，实测 depth +12% 且更快收敛）。 */
export function isComplexTask(text) {
  return typeof text === "string" && (text.length > 120 || COMPLEX_HINT_RE.test(text));
}

/**
 * 解析用户消息里的显式路由指令：`[router] band=<spec|react|weak|auto>[ task=<...>]`
 * - 显式指令优先于关键词分类（人在回路）。
 * - band=auto 表示清除显式覆盖、回退自动分类。
 * - task 为可选任务回显文本，捕获到行尾。
 * @param {string} text 用户消息全文
 * @returns {{ band: string, task?: string } | null} 无指令时返回 null
 */
export function parseRouterDirective(text) {
  if (typeof text !== "string") return null;
  const match = /\[router\][ \t]*band[ \t]*=[ \t]*(spec|react|weak|auto)(?:[ \t]+task[ \t]*=[ \t]*(.+))?/i.exec(text);
  if (match === null) return null;
  const out = { band: match[1].toLowerCase() };
  if (match[2] !== undefined) {
    const task = match[2].trim();
    if (task.length > 0) out.task = task;
  }
  return out;
}

/**
 * 勤勉自检固定文本（每 N 轮注入一次；含轮次号使文本轮间稳定、轮到才变化）。
 * @param {number} turn 当前轮次（>= 1）
 * @returns {string}
 */
export function diligenceReminder(turn) {
  return (
    "Diligence self-check (turn " +
    turn +
    "): before your next action, confirm you still hold the deliverable, the remaining steps, and the freshest evidence; re-derive whichever is unclear from this session, then continue with full attention. Do not repeat completed steps."
  );
}
