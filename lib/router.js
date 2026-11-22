// dsh-lean-router - 思考链路由层（票 05）
//
// 职责（思想移植自上游 routing-suite 实测结论，不搬其代码）：
// 1. 首轮捕获：agent/inbox/claimed 只认 source.kind === 'user' 的真实用户消息，
//    解析显式 [router] band=… task=… 指令，或按关键词自动分类到 spec/react/weak 三带。
// 2. 近场引导：ctx.systemPrompt.context() 注册动态 context —— 同一带内文本恒定
//    （宿主 deepEqualJson 相等即零写入 = 不改写历史、不加 API 轮次、缓存友好）；
//    改档/勤勉轮才追加一条新 reminder（宿主 supersession 管理，append-only）。
//    不走 agent/pre-step append：非 runtime-context 消息会被宿主 durable 写历史，
//    每步累积，违反缓存友好约束（证据见 docs/路由-设计说明.md 接缝表）。
// 3. 勤勉自检：每 diligenceEvery 轮在引导文本尾部追加一段勤勉提醒（轮次号入文，
//    非 10 的倍数轮文本不变、零写入）。
// 4. 命令：/band 显式改档（人在回路）、/skill 列出可用技能与 invocation 开关，
//    走 ctx.commands.register 宿主命令缝。
// 5. 每轮门控（票 09）：gate:true 时 pre-step 近场求值里调 skillgate.round()，hint
//    追加进近场引导文本、决策经共享审计通道发出（接线见 lib/gate-runner.js 与
//    docs/面板-设计说明.md §9.3 已接线）；gate 默认关 = 一切不变。
//
// 路由状态存 agent 会话作用域 WeakMap（keyed by agent），不污染全局；
// 禁直接改 persona —— ROUTER_PROMPT 以导出常量交付，拼接点见 ROUTER_INJECTION_NOTES。

import {
  BANDS,
  BAND_IDS,
  DIRECTIVE_BAND_IDS,
  TASK_ECHO_PREFIX,
  classifyTask,
  diligenceReminder,
  parseRouterDirective,
} from "./bands.js";
import { defaultAuditPath, wireAuditSink } from "./audit-sink.js";
import { executeAuditCommand } from "./audit-commands.js";
import { getAuditChannel } from "./skillgate.js";
import { createGateRunner } from "./gate-runner.js";

/** 三带配置表（re-export，满足单入口消费）。 */
export { BANDS, BAND_IDS, DIRECTIVE_BAND_IDS, classifyTask, isComplexTask, parseRouterDirective, diligenceReminder } from "./bands.js";

/** 近场引导的 dynamic context 名（宿主 NamedEntries 按 name 唯一）。 */
export const GUIDE_CONTEXT_NAME = "lean-router:guide";

/** 默认勤勉自检轮距（可配，约束台账为「每 10 轮可配」）。 */
export const DEFAULT_DILIGENCE_EVERY = 10;

/**
 * ROUTER_PROMPT —— 首轮 [router] 分类指令文本（persona suffix 拼接由 master 集成）。
 * 这是 weak 带的 few-shot 分类指令 + 三锚（回顾/收敛/反跑题）+ 显式指令语法说明。
 * 实测依据：Flash = neutral + classify + 三锚（路由 96%、单任务完成 100%、反稀释）。
 */
export const ROUTER_PROMPT = [
  "Routing: before acting on any new task, classify it - (build) create something new end-to-end, or (fix) diagnose and repair something broken - then adopt the matching style: build -> hands-on production; fix -> inspect-and-plan.",
  "The first real user message of the session may carry an explicit directive like [router] band=spec|react|weak|auto task=<one line>; treat it as the routing decision for the session.",
  "Recall what you have already done in this session and continue from there; do not repeat completed steps.",
  "Converge on the deliverable; do not expand scope.",
  "Return to the task at hand whenever you notice drift.",
].join("\n");

/**
 * ROUTER_INJECTION_NOTES —— 注入点说明（给 master 集成与后续维护者；行号来自实读宿主 0.2.2-rc.5 源码）。
 */
export const ROUTER_INJECTION_NOTES = {
  personaSuffix:
    "ROUTER_PROMPT 拼接点 = 预设 persona 插件行的 config.suffix 文本尾部（@deepseek-ai/dsh-persona 渲染为 deployment:persona-suffix 节，order 10200；见 dsh-persona/lib/index.js L42-46）。票 03 lean 纪律在前、ROUTER_PROMPT 在后，换行续接。",
  nearFieldGuide:
    "近场引导注入点 = ctx.systemPrompt.context({ name: 'lean-router:guide', order: 220, text })（@deepseek-ai/dsh-system-prompt L281-284）。同一带内文本恒定，宿主 RuntimeContextProjection L341 deepEqualJson 相等即不写；改档/勤勉轮才追加新 system-reminder（append-only，不改写历史）。",
  firstTurnCapture:
    "首轮捕获事件 = ctx.on('agent/inbox/claimed', ({ agent, message, turn }))（@deepseek-ai/dsh-agent-loop L106-109，payload { message, turn }）；只认 message.source.kind === 'user'（宿主判据见 @deepseek-ai/dsh-api-session-controller L492）。",
  commands:
    "命令注册缝 = ctx.commands.register({ name, description, input?, handler })（@deepseek-ai/dsh-commands L266-269；definitionId 可选，L166）。",
  patchEntry:
    "patch 分片 = presets/base/frag-router.patch.yml 顶层列表续项（scripts/build-bundle.mjs 字符串续接），两实例分流：钩子行 hooks:true + 命令行 commands:true。入口子路径 dsh-lean-router/router 需 package.json exports 增补（共享文件，由 master 集成）。",
};

/** 插件名（cordis loader 诊断用）。 */
export const name = "lean-router-router";

/** 依赖的宿主服务：agents（ctx.on 事件）、systemPrompt（动态 context）、commands、skills。 */
export const inject = ["agents", "systemPrompt", "commands", "skills"];

/** 从用户消息 content 里提取纯文本（防御嵌套与字符串 content）。 */
function messageText(message) {
  if (!message || typeof message !== "object") return "";
  const payload = message.message && typeof message.message === "object" ? message.message : message;
  const content = Array.isArray(payload.content) ? payload.content : [];
  return content.map((block) => (typeof block === "string" ? block : block?.text ?? "")).join(" ");
}

/** 会话是否继承自父会话（子代理/fork）：继承历史则跳过路由（社区实测 #5）。 */
function isInherited(agent) {
  return agent?.session?.parentSession !== undefined && agent.session.parentSession !== null;
}

/** 读取 agent 的路由状态；未路由返回 null。 */
function stateOf(states, agent) {
  return states.get(agent) ?? null;
}

/**
 * 捕获并更新路由状态。
 * - 只认 message.source.kind === 'user'（插件注入/工具结果不触发）。
 * - 显式 [router] 指令优先；band=auto 清除覆盖回退自动。
 * - 无指令且未路由时按关键词分类（首轮捕获）。
 * - 已路由时保持路径承诺：关键词不改带，仅更新轮次。
 * @returns {boolean} 是否发生带变更
 */
function capture(states, agent, message, turn, skipInherited) {
  if (!message || message.source?.kind !== "user") return false;
  if (skipInherited && isInherited(agent)) return false;
  const text = messageText(message);
  const previous = stateOf(states, agent);
  const directive = parseRouterDirective(text);
  if (directive !== null) {
    const band = directive.band === "auto" ? null : directive.band;
    const next = { band, task: directive.task ?? previous?.task ?? null, turn };
    states.set(agent, next);
    return previous === null ? band !== null : previous.band !== band;
  }
  if (previous === null) {
    states.set(agent, { band: classifyTask(text), task: null, turn });
    return true;
  }
  if (previous.turn !== turn) states.set(agent, { ...previous, turn });
  return false;
}

/**
 * 渲染该 agent 当前应渲染的近场引导文本（含任务回显与勤勉自检；未路由返回空串）。
 * 票 09 加法：第 4 参 gateHint 为每轮门控的 hint 文本（lib/gate-runner.js）；空串/
 * 缺省不追加，近场文本与现状逐字符一致；非空时按行续接在勤勉自检之后。
 */
function guideTextFor(states, agent, diligenceEvery, gateHint) {
  const state = stateOf(states, agent);
  if (state === null || state.band === null) return "";
  const band = BANDS[state.band];
  if (!band) return "";
  let text = band.guideText;
  if (state.task) text += "\n" + TASK_ECHO_PREFIX + state.task;
  if (diligenceEvery > 0 && Number.isSafeInteger(state.turn) && state.turn > 0 && state.turn % diligenceEvery === 0) {
    text += "\n" + diligenceReminder(state.turn);
  }
  if (typeof gateHint === "string" && gateHint.length > 0) text += "\n" + gateHint;
  return text;
}

/** 校验插件 options（未知键报错；仿宿主 plan-mode resolveConfig 的失败尽早原则）。 */
function resolveOptions(options) {
  const cfg = options ?? {};
  const unknown = Object.keys(cfg).filter(
    (key) => !["diligenceEvery", "hooks", "commands", "guideOrder", "skipInherited", "audit", "auditPath", "weightsPath", "gate"].includes(key)
  );
  if (unknown.length > 0) throw new Error("lean-router-router has unknown option(s): " + unknown.join(", "));
  const diligenceEvery = cfg.diligenceEvery ?? DEFAULT_DILIGENCE_EVERY;
  if (!Number.isSafeInteger(diligenceEvery) || diligenceEvery < 0) throw new Error("lean-router-router: diligenceEvery must be a non-negative safe integer");
  if (cfg.auditPath !== undefined && (typeof cfg.auditPath !== "string" || cfg.auditPath.length === 0)) {
    throw new Error("lean-router-router: auditPath must be a non-empty string");
  }
  if (cfg.weightsPath !== undefined && (typeof cfg.weightsPath !== "string" || cfg.weightsPath.length === 0)) {
    throw new Error("lean-router-router: weightsPath must be a non-empty string");
  }
  return {
    diligenceEvery,
    hooks: cfg.hooks !== false,
    commands: cfg.commands !== false,
    guideOrder: cfg.guideOrder ?? 220,
    skipInherited: cfg.skipInherited !== false,
    // 票 07：审计落盘默认关（master 集成在 patch 行加 audit: true + 可选 auditPath；
    // 关闭 = 零行为变化，既有断言不受影响）。weightsPath 仅作 /lean-audit weights 展示。
    audit: cfg.audit === true,
    auditPath: cfg.auditPath ?? null,
    weightsPath: cfg.weightsPath ?? null,
    // 票 09：每轮门控默认关（master 集成在 patch 钩子行加 gate: true）；关闭 = 近场
    // 文本与现状逐字符一致、round() 不执行、不发审计（约束台账 3 零副作用锚点）。
    gate: cfg.gate === true,
  };
}

/** /band 命令 handler 的共享实现（测试可直调）。 */
function executeBandCommand(states, invocation) {
  const agent = invocation?.agent;
  if (!agent) return { kind: "error", text: "/band has no active agent to route." };
  const raw = (invocation.rawInput ?? "").trim();
  const state = stateOf(states, agent);
  if (raw.length === 0) {
    const band = state?.band ?? null;
    return {
      kind: "success",
      text:
        "Router band: " +
        (band ?? "auto (unset - classifies on next user message)") +
        "\n" +
        (state?.task ? TASK_ECHO_PREFIX + state.task + "\n" : "") +
        "Usage: /band [spec|react|weak|auto] [task <one line>]\n" +
        "Bands: spec = inspect-and-plan (narrow, read-first); react = hands-on production (wide, write-first); weak = model-routed (self-classify).",
    };
  }
  const tokens = raw.split(/[ \t]+/);
  const head = tokens[0].toLowerCase();
  if (!DIRECTIVE_BAND_IDS.includes(head)) {
    return { kind: "error", text: "Unknown band '" + tokens[0] + "'. Usage: /band [spec|react|weak|auto] [task <one line>]" };
  }
  const rest = tokens.slice(1).join(" ").trim();
  let taskArg;
  if (rest.length > 0) {
    const m = /^task[ \t]*=[ \t]*(.+)$/.exec(rest) ?? null;
    taskArg = m !== null ? m[1].trim() : rest.replace(/^task[ \t]+/i, "").trim();
  }
  const band = head === "auto" ? null : head;
  const turn = state?.turn ?? 0;
  states.set(agent, { band, task: taskArg ?? state?.task ?? null, turn });
  return {
    kind: "success",
    text: "Router band set to " + (band ?? "auto") + "." + (taskArg ? "\n" + TASK_ECHO_PREFIX + taskArg : ""),
  };
}

/**
 * 票 07 加法接线：audit:true 时把 sink 挂上 skillgate 共享审计通道
 * （决策流 -> JSONL；默认路径 <homedir>/.dsh/lean-router/audit.jsonl）。
 * 返回 { channel, sink, unsubscribe }；测试可直调（传 auditPath 覆盖到临时目录）。
 * 幂等护栏：patch 两行实例若都开 audit，同一解析路径只挂一次 sink
 * （重复订阅会把每条决策双写进同一 JSONL，统计翻倍）；unsubscribe 会清掉注册。
 */
const wiredAuditPaths = new Map();

function setupAudit(options) {
  const key = options?.auditPath ?? "__default__";
  const existing = wiredAuditPaths.get(key);
  if (existing) return existing;
  const channel = getAuditChannel();
  const auditPath = options?.auditPath ?? null;
  const handle = wireAuditSink(channel, auditPath ? { path: auditPath } : undefined);
  const wired = {
    channel,
    sink: handle.sink,
    unsubscribe: () => {
      handle.unsubscribe();
      wiredAuditPaths.delete(key);
    },
  };
  wiredAuditPaths.set(key, wired);
  return wired;
}

/** /skill 命令 handler 的共享实现（skills 服务注入；测试可直调假 skills）。 */
async function executeSkillCommand(ctx, invocation) {
  const agent = invocation?.agent;
  if (!agent) return { kind: "error", text: "/skill has no active agent to list skills for." };
  const raw = (invocation.rawInput ?? "").trim();
  const options = { scope: agent, signal: invocation.signal };
  try {
    if (raw.length === 0) {
      const skills = await ctx.skills.list(options);
      const lines = skills.map((s) => {
        const flags = [s.invocation?.modelInvocable ? "model" : null, s.invocation?.userInvocable ? "user" : null].filter(Boolean).join("+") || "off";
        return s.name + " [" + flags + "] - " + (s.description ?? "");
      });
      return { kind: "success", text: (lines.length === 0 ? "No skills registered." : lines.join("\n")) + "\nUsage: /skill <name>" };
    }
    const skill = await ctx.skills.get(raw, options);
    if (skill === undefined) return { kind: "error", text: "Unknown skill: " + raw };
    const flags = [skill.invocation?.modelInvocable ? "model" : null, skill.invocation?.userInvocable ? "user" : null].filter(Boolean).join("+") || "off";
    return {
      kind: "success",
      text:
        skill.name + " [" + flags + "]\n" +
        (skill.description ?? "") + "\n" +
        "provider: " + (skill.provider ?? "-") + "  source: " + (skill.source ?? "-") +
        (skill.resourceBase?.kind === "directory" ? "\nbase: " + skill.resourceBase.path : ""),
    };
  } catch (error) {
    return { kind: "error", text: "Skill lookup failed: " + (error instanceof Error ? error.message : String(error)) };
  }
}

/**
 * 路由层插件入口（cordis）。
 * options 分流（patch 两实例复用同一入口模块）：
 * - hooks:    首轮捕获 + 近场引导 + 勤勉自检（默认 true）
 * - commands: /band /skill 注册（默认 true）
 * - diligenceEvery: 勤勉自检轮距，0 关闭（默认 10）
 * - guideOrder: 引导 context 排位（默认 220，避开宿主 CONTEXT_ORDERS 100-210）
 * - skipInherited: 子代理/fork 继承会话跳过路由（默认 true）
 * - gate: 每轮门控开关（票 09；默认 false。true 时 pre-step 近场求值调 skillgate.round()，
 *   hint 追加进近场文本、决策发共享审计通道；关闭 = 一切不变）
 */
export function apply(ctx, options) {
  const cfg = resolveOptions(options);
  /** agent 会话作用域路由状态（不污染全局）。 */
  const states = new WeakMap();

  // 票 09 加法接线：gate:true 时 pre-step 每轮门控（设计说明 §9.3）——claimed 捕获
  // 当轮用户消息并异步热读权重/观察 dsActive，近场 text 同步 round() 出 hint 追加进
  // 引导文本，决策经共享审计通道发出（commands 行实例 audit:true 已挂 sink 落盘）。
  // gate 默认关：runner 不创建，text 与现状逐字符一致（约束台账 3）。
  const gateRunner =
    cfg.hooks && cfg.gate
      ? createGateRunner({ weightsPath: cfg.weightsPath ?? undefined, skills: ctx.skills ?? null })
      : null;

  if (cfg.hooks) {
    ctx.on("agent/inbox/claimed", async ({ agent, message, turn }) => {
      capture(states, agent, message, turn, cfg.skipInherited);
      if (
        gateRunner !== null &&
        message &&
        message.source?.kind === "user" &&
        !(cfg.skipInherited && isInherited(agent))
      ) {
        try {
          await gateRunner.capture(agent, messageText(message), turn);
        } catch {} // 门控永不破坏路由管线（与审计错误策略同原则）
      }
    });
    ctx.systemPrompt.context({
      name: GUIDE_CONTEXT_NAME,
      order: cfg.guideOrder,
      text: (assembly) => {
        const agent = assembly?.agent;
        if (agent === undefined || (cfg.skipInherited && isInherited(agent))) return "";
        const hint = gateRunner !== null ? gateRunner.hintFor(agent, stateOf(states, agent)?.band ?? null) : "";
        return guideTextFor(states, agent, cfg.diligenceEvery, hint);
      },
    });
  }

  // 票 07 加法接线：审计落盘（audit:true 才挂 sink；决策流 = skillgate 共享通道）。
  if (cfg.audit) {
    setupAudit({ auditPath: cfg.auditPath });
  }

  if (cfg.commands) {
    ctx.commands.register({
      name: "band",
      description: "View or switch the thinking-chain routing band (spec/react/weak/auto)",
      input: { hint: "[spec|react|weak|auto] [task <one line>]" },
      handler: (invocation) => executeBandCommand(states, invocation),
    });
    ctx.commands.register({
      name: "skill",
      description: "List available skills or show one skill's invocation policy",
      input: { hint: "[name]" },
      handler: (invocation) => executeSkillCommand(ctx, invocation),
    });
    // 票 07 加法接线：/lean-audit 双入口之一（命令；实现放 lib/audit-commands.js，
    // 数据源 = 审计 JSONL 回放，不新增内存态）。ui/go.json 面板按钮是另一入口。
    ctx.commands.register({
      name: "lean-audit",
      description: "Show recent skill-gate audit decisions, hit statistics and manual weights",
      input: { hint: "[scores|stats|weights] [N]" },
      handler: (invocation) =>
        executeAuditCommand(invocation, {
          auditPath: cfg.auditPath ?? defaultAuditPath(),
          weightsPath: cfg.weightsPath,
        }),
    });
  }
}

/** 测试与集成内用的内部实现出口（不进公开契约文档）。 */
export const internals = { capture, guideTextFor, executeBandCommand, executeSkillCommand, executeAuditCommand, messageText, resolveOptions, setupAudit };
