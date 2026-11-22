// dsh-lean-router 票 05 —— 思考链路由层假 ctx 集成单测（宿主纯 node --test 可跑）
// 断言面（约束台账 acceptance 3）：首轮捕获 / [router] 解析 / 改档 / 近场引导注入 / 勤勉轮次。
import test from "node:test";
import assert from "node:assert/strict";

import { BANDS, GUIDE_CONTEXT_NAME, internals, apply } from "../lib/router.js";

const { capture, guideTextFor, executeBandCommand, executeSkillCommand } = internals;

/** 最小假 ctx：on / systemPrompt.context / commands.register / skills 全部可观测。 */
function makeCtx(skills) {
  const handlers = new Map();
  const contexts = new Map();
  const commands = new Map();
  const ctx = {
    on(type, handler) {
      if (!handlers.has(type)) handlers.set(type, []);
      handlers.get(type).push(handler);
      return () => {};
    },
    systemPrompt: {
      context(def) {
        contexts.set(def.name, def);
        return () => {};
      },
    },
    commands: {
      register(def) {
        commands.set(def.name, def);
        return () => {};
      },
    },
    skills,
  };
  return { ctx, handlers, contexts, commands };
}

function fakeSkills() {
  return {
    async list() {
      return [
        { name: "tdd", description: "Test-driven development", invocation: { modelInvocable: true, userInvocable: false } },
        { name: "retro", description: "Retrospective", invocation: { modelInvocable: false, userInvocable: true } },
      ];
    },
    async get(name) {
      if (name !== "tdd") return undefined;
      return {
        name: "tdd",
        description: "Test-driven development",
        invocation: { modelInvocable: true, userInvocable: false },
        provider: "lean-router",
        source: "bundled",
        resourceBase: { kind: "directory", path: "/skills/tdd" },
      };
    },
  };
}

async function emitClaimed(ctx, handlers, agent, message, turn) {
  for (const handler of handlers.get("agent/inbox/claimed") ?? []) await handler({ agent, message, turn });
}

const userMessage = (text) => ({ source: { kind: "user" }, content: [{ type: "text", text }] });
const agentA = { session: {} };
const agentB = { session: {} };

async function routedSetup(options) {
  const { ctx, handlers, contexts, commands } = makeCtx(fakeSkills());
  assert.equal(apply(ctx, options), undefined, 'apply must not return a plain object (cordis "Invalid effect")');
  return { ctx, handlers, contexts, commands };
}

test("apply 默认注册 hooks 与 commands", async () => {
  const { handlers, contexts, commands } = await routedSetup({});
  assert.ok(handlers.has("agent/inbox/claimed"));
  assert.ok(contexts.has(GUIDE_CONTEXT_NAME));
  assert.ok(commands.has("band"));
  assert.ok(commands.has("skill"));
});

test("options 分流：hooks:false 只留命令；commands:false 只留钩子", async () => {
  const a = await routedSetup({ hooks: false });
  assert.ok(!a.handlers.has("agent/inbox/claimed"));
  assert.ok(!a.contexts.has(GUIDE_CONTEXT_NAME));
  assert.ok(a.commands.has("band"));
  const b = await routedSetup({ commands: false });
  assert.ok(b.handlers.has("agent/inbox/claimed"));
  assert.ok(!b.commands.has("band"));
  assert.ok(!b.commands.has("skill"));
});

test("resolveOptions：未知键报错、diligenceEvery 校验", async () => {
  assert.throws(() => internals.resolveOptions({ nope: 1 }), /unknown option/i);
  assert.throws(() => internals.resolveOptions({ diligenceEvery: -1 }), /diligenceEvery/);
  assert.equal(internals.resolveOptions({}).diligenceEvery, 10);
});

test("首轮捕获：只认 source.kind === user；build 词首轮即 react", async () => {
  const { ctx, handlers, contexts } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  // 插件注入的消息不触发（kind != user）
  await emitClaimed(ctx, handlers, agentA, { source: { kind: "plugin" }, content: [{ type: "text", text: "开发新功能" }] }, 1);
  assert.equal(text({ agent: agentA }), "");
  // 真实用户消息：build 证据 -> react 引导
  await emitClaimed(ctx, handlers, agentA, userMessage("帮我开发一个贪吃蛇游戏"), 1);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText);
});

test("[router] 指令解析优先：band=spec + task 回显进引导文本", async () => {
  const { ctx, handlers, contexts } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(ctx, handlers, agentA, userMessage("[router] band=spec task=修复登录超时"), 1);
  const guide = text({ agent: agentA });
  assert.ok(guide.startsWith(BANDS.spec.guideText));
  assert.ok(guide.includes("Task: 修复登录超时"));
});

test("近场引导注入：同状态文本恒定（缓存友好），auto/未路由为空串", async () => {
  const { ctx, handlers, contexts } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(ctx, handlers, agentA, userMessage("开发新工具"), 2);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText);
  await emitClaimed(ctx, handlers, agentA, userMessage("继续"), 3);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText, "同带不同轮文本恒定");
  // band=auto：显式回退未路由 -> 空串（不渲染、零写入）
  await emitClaimed(ctx, handlers, agentB, userMessage("[router] band=auto"), 1);
  assert.equal(text({ agent: agentB }), "");
  // 无 agent 的装配上下文：空串
  assert.equal(text({}), "");
});

test("勤勉轮次：每 10 轮追加自检文本，其余轮零变化", async () => {
  const { ctx, handlers, contexts } = await routedSetup({ diligenceEvery: 10 });
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(ctx, handlers, agentA, userMessage("开发新工具"), 9);
  const turn9 = text({ agent: agentA });
  assert.ok(!turn9.includes("Diligence"), "第 9 轮无自检");
  await emitClaimed(ctx, handlers, agentA, userMessage("继续"), 10);
  const turn10 = text({ agent: agentA });
  assert.ok(turn10.startsWith(BANDS.react.guideText));
  assert.ok(turn10.includes("Diligence self-check (turn 10)"), "第 10 轮追加自检");
  await emitClaimed(ctx, handlers, agentA, userMessage("继续"), 11);
  const turn11 = text({ agent: agentA });
  assert.ok(!turn11.includes("Diligence"), "第 11 轮回落（文本与第 9 轮一致）");
  assert.equal(turn11, turn9);
});

test("diligenceEvery: 0 关闭勤勉自检", async () => {
  const { ctx, handlers, contexts } = await routedSetup({ diligenceEvery: 0 });
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(ctx, handlers, agentA, userMessage("开发新工具"), 20);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText);
});

test("路径承诺：已路由后关键词不改带；显式 [router] 指令仍可改带", async () => {
  const { ctx, handlers, contexts } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(ctx, handlers, agentA, userMessage("开发新工具"), 1);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText);
  // fix 关键词消息：不改带
  await emitClaimed(ctx, handlers, agentA, userMessage("顺手修复一下报错"), 2);
  assert.equal(text({ agent: agentA }), BANDS.react.guideText);
  // 显式指令：改带
  await emitClaimed(ctx, handlers, agentA, userMessage("[router] band=spec"), 3);
  assert.ok(text({ agent: agentA }).startsWith(BANDS.spec.guideText));
});

test("子代理/继承会话跳过路由（skipInherited 默认 true，可关）", async () => {
  const { ctx, handlers, contexts } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  const child = { session: { parentSession: "session-parent" } };
  await emitClaimed(ctx, handlers, child, userMessage("开发新工具"), 1);
  assert.equal(text({ agent: child }), "");
  const open = await routedSetup({ skipInherited: false });
  const openText = open.contexts.get(GUIDE_CONTEXT_NAME).text;
  await emitClaimed(open.ctx, open.handlers, child, userMessage("开发新工具"), 1);
  assert.equal(openText({ agent: child }), BANDS.react.guideText);
});

test("/band：显示/改档/auto 回退/非法值报错", async () => {
  const { ctx, handlers, contexts, commands } = await routedSetup({});
  const text = contexts.get(GUIDE_CONTEXT_NAME).text;
  const band = commands.get("band");
  // 无参显示
  const shown = band.handler({ agent: agentA, rawInput: "" });
  assert.equal(shown.kind, "success");
  assert.ok(shown.text.includes("auto (unset"));
  // 改档
  const set = band.handler({ agent: agentA, rawInput: "react task = 发布 MVP" });
  assert.equal(set.kind, "success");
  assert.ok(set.text.includes("react"));
  assert.ok(set.text.includes("Task: 发布 MVP"));
  assert.equal(text({ agent: agentA }), BANDS.react.guideText + "\nTask: 发布 MVP");
  // auto 回退
  const back = band.handler({ agent: agentA, rawInput: "auto" });
  assert.equal(back.kind, "success");
  assert.equal(text({ agent: agentA }), "");
  // 非法值
  const bad = band.handler({ agent: agentA, rawInput: "mixed" });
  assert.equal(bad.kind, "error");
  // 无 agent
  assert.equal(band.handler({}).kind, "error");
});

test("/skill：列表与详情走 skills 服务，未知技能报错", async () => {
  const { ctx, commands } = await routedSetup({});
  const skill = commands.get("skill");
  const list = await skill.handler({ agent: agentA, rawInput: "" });
  assert.equal(list.kind, "success");
  assert.ok(list.text.includes("tdd [model]"));
  assert.ok(list.text.includes("retro [user]"));
  const detail = await skill.handler({ agent: agentA, rawInput: "tdd" });
  assert.equal(detail.kind, "success");
  assert.ok(detail.text.includes("provider: lean-router"));
  assert.ok(detail.text.includes("/skills/tdd"));
  const unknown = await skill.handler({ agent: agentA, rawInput: "nope" });
  assert.equal(unknown.kind, "error");
  const noAgent = await skill.handler({});
  assert.equal(noAgent.kind, "error");
});

test("capture/guideTextFor 内部实现直调（状态隔离：两个 agent 互不影响）", () => {
  const states = new WeakMap();
  const changedA = capture(states, agentA, userMessage("修复报错"), 1, true);
  assert.equal(changedA, true);
  assert.equal(guideTextFor(states, agentA, 10), BANDS.spec.guideText);
  assert.equal(guideTextFor(states, agentB, 10), "");
  // 非 user 消息不触发
  assert.equal(capture(states, agentB, { source: { kind: "tool" } }, 1, true), false);
  assert.equal(guideTextFor(states, agentB, 10), "");
});

test("messageText：防御嵌套 message 形状与字符串 content", () => {
  assert.equal(internals.messageText(userMessage("hello")), "hello");
  assert.equal(internals.messageText({ source: { kind: "user" }, message: { content: [{ type: "text", text: "nested" }] } }), "nested");
  assert.equal(internals.messageText({ source: { kind: "user" }, content: ["plain"] }), "plain");
  assert.equal(internals.messageText(null), "");
});
