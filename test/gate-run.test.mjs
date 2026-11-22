// test/gate-run.test.mjs - 票 09 每轮门控 runner 单测（宿主纯 node --test 可跑）
// 断言面（约束台账 acceptance 3）：每轮调用（假 ctx）/ 决策写进审计通道 / hint 行
// 格式（与 skillgate.renderAdmission 逐行同构，仅头部无轮次号）/ 权重热读（改文件
// 下一轮生效）/ dsActive 仲裁进决策 / 零副作用锚点（无 band/无 taskText 不发审计）。
import test from "node:test";
import assert from "node:assert/strict";

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAuditChannel, renderAdmission } from "../lib/skillgate.js";
import { internals as providerInternals } from "../lib/skill-provider.js";
import { createGateRunner } from "../lib/gate-runner.js";

const sampleTask = "帮我开发一个贪吃蛇游戏"; // react 带、非 complex；矩阵关键词全空 -> 纯场景分

function dsSkills() {
  return {
    async list() {
      return [
        { name: "tdd", description: "Test-driven development", invocation: { modelInvocable: true, userInvocable: false } },
        { name: "office", description: "Office workflows", invocation: { modelInvocable: true, userInvocable: true } },
        { name: "ds-tdd", description: "TDD discipline skill", invocation: { modelInvocable: true, userInvocable: true } },
        { name: "ds-mode", description: "Working style skill", invocation: { modelInvocable: true, userInvocable: true } },
      ];
    },
  };
}

// 无 ds-* 的技能目录：dsActive 为空 -> 仲裁不触发 -> engineering 场景 auto 原样保留
// （dsSkills() 的 ds-* 会让仲裁把 tdd 等 engineering auto 降 hint，auto 段不渲染，见 L110 仲裁测试）。
function plainSkills() {
  return {
    async list() {
      return [
        { name: "tdd", description: "Test-driven development", invocation: { modelInvocable: true, userInvocable: false } },
        { name: "office", description: "Office workflows", invocation: { modelInvocable: true, userInvocable: true } },
      ];
    },
  };
}

async function makeWeightsFile(dir, name, value) {
  const path = join(dir, name);
  await writeFile(path, JSON.stringify(value), "utf8");
  return path;
}

test("capture + refresh：dsActive 为 ds-* 前缀枚举（去重排序），权重自定义路径生效", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gate-run-"));
  const weightsPath = await makeWeightsFile(dir, "weights.json", { version: 1, tokenBudget: 123 });
  const runner = createGateRunner({ weightsPath, skills: dsSkills(), audit: createAuditChannel() });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  const snap = runner.snapshot(agent);
  assert.equal(snap.taskText, sampleTask);
  assert.equal(snap.turn, 1);
  assert.deepEqual(snap.dsActive, ["ds-mode", "ds-tdd"]);
  assert.equal(snap.weightsStatus, "loaded");
});

test("每轮调用 + 决策写进审计通道 + 权重热读：改文件下一轮 config 生效", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gate-run-"));
  const weightsPath = await makeWeightsFile(dir, "weights.json", { version: 1, tokenBudget: 123 });
  const channel = createAuditChannel();
  const runner = createGateRunner({ weightsPath, skills: dsSkills(), audit: channel });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  assert.ok(runner.hintFor(agent, "react").length > 0, "首轮有 hint");
  assert.equal(channel.entries().length, 1);
  assert.equal(channel.entries()[0].config.tokenBudget, 123);
  assert.equal(channel.entries()[0].turn, 1);
  assert.equal(channel.entries()[0].task.head, sampleTask);
  // 权重热读：改文件 -> 下一轮 capture+round 读到新值（loadGateWeights 每次读盘）
  await writeFile(weightsPath, JSON.stringify({ version: 1, tokenBudget: 999 }), "utf8");
  await runner.capture(agent, sampleTask, 2);
  assert.ok(runner.hintFor(agent, "react").length > 0, "次轮有 hint");
  assert.equal(channel.entries().length, 2);
  assert.equal(channel.entries()[1].turn, 2);
  assert.equal(channel.entries()[1].config.tokenBudget, 999);
});

test("hint 进近场文本：与 renderAdmission 逐行同构（仅头部省略轮次号）", async () => {
  const channel = createAuditChannel();
  const runner = createGateRunner({ skills: plainSkills(), audit: channel });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  const hint = runner.hintFor(agent, "react");
  const entry = channel.entries()[0];
  const catalog = await providerInternals.loadCatalog();
  const full = renderAdmission(
    { band: entry.decision.band, complex: entry.decision.complex, auto: entry.decision.auto, hint: entry.decision.hint },
    catalog,
    { turn: 0 }
  );
  const fullLines = full.split("\n");
  const hintLines = hint.split("\n");
  assert.equal(hintLines.length, fullLines.length);
  assert.equal(hintLines[0], "Skill gate (band=react):");
  assert.equal(fullLines[0], "Skill gate (turn 0, band=react):");
  assert.deepEqual(hintLines.slice(1), fullLines.slice(1));
  assert.ok(hint.includes("High-confidence skills for this task - load each now with the skill tool before working:"), "auto 段头");
  assert.ok(hintLines.some((l) => l.startsWith("- tdd [auto]: ")), "auto 行格式 = - name [auto]: desc");
  assert.ok(hint.includes("Possible matches (invoke only if clearly relevant):"), "hint 段头");
});

test("审计去重：同轮多步只发一条决策；新轮才发新条目", async () => {
  const channel = createAuditChannel();
  const runner = createGateRunner({ skills: dsSkills(), audit: channel });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  runner.hintFor(agent, "react");
  runner.hintFor(agent, "react");
  runner.hintFor(agent, "react");
  assert.equal(channel.entries().length, 1, "同轮重复求值不重复发审计");
  await runner.capture(agent, sampleTask, 2);
  runner.hintFor(agent, "react");
  assert.equal(channel.entries().length, 2, "新轮发新条目");
  assert.equal(channel.entries()[1].turn, 2);
});

test("dsActive 仲裁进决策：engineering 场景 auto 降 hint，原因入 arbitrations", async () => {
  const channel = createAuditChannel();
  const runner = createGateRunner({ skills: dsSkills(), audit: channel });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  runner.hintFor(agent, "react");
  const entry = channel.entries()[0];
  assert.deepEqual(entry.dsActive, ["ds-mode", "ds-tdd"]);
  assert.ok(entry.decision.arbitrations.length > 0, "有裁决记录");
  for (const a of entry.decision.arbitrations) {
    assert.equal(a.from, "auto");
    assert.equal(a.to, "hint");
    assert.ok(a.reason.includes("prefers ds"), "原因含 prefers ds");
  }
  assert.ok(!entry.decision.auto.includes("tdd"), "tdd 已被降出 auto");
  assert.ok(entry.decision.hint.includes("tdd"), "tdd 落 hint");
});

test("零副作用锚点：无 band / 无 taskText 时 hint 空串且不发审计", async () => {
  const channel = createAuditChannel();
  const runner = createGateRunner({ skills: dsSkills(), audit: channel });
  const agent = { session: {} };
  assert.equal(runner.hintFor(agent, "react"), "", "未捕获过：无 taskText");
  assert.equal(runner.hintFor(agent, null), "", "band 空：门控休眠");
  assert.equal(channel.entries().length, 0, "不发审计");
  const other = { session: {} };
  await runner.capture(other, "", 1);
  assert.equal(runner.hintFor(other, "react"), "", "空 taskText：门控休眠");
  assert.equal(channel.entries().length, 0, "仍不发审计");
});

test("权重缺省三态承接：缺文件 -> default + 默认配置；list 失败 -> dsActive 空且门控不破坏", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gate-run-"));
  const channel = createAuditChannel();
  const runner = createGateRunner({ weightsPath: join(dir, "missing.json"), skills: dsSkills(), audit: channel });
  const agent = { session: {} };
  await runner.capture(agent, sampleTask, 1);
  const snap = runner.snapshot(agent);
  assert.equal(snap.weightsStatus, "default");
  assert.equal(runner.hintFor(agent, "react").length > 0, true);
  assert.equal(channel.entries()[0].config.tokenBudget, 8000);

  const boom = { async list() { throw new Error("boom"); } };
  const channel2 = createAuditChannel();
  const runner2 = createGateRunner({ skills: boom, audit: channel2 });
  const agent2 = { session: {} };
  await runner2.capture(agent2, sampleTask, 1);
  assert.deepEqual(runner2.snapshot(agent2).dsActive, [], "观察失败回空数组");
  assert.ok(runner2.hintFor(agent2, "react").length > 0, "门控不破坏");
  assert.deepEqual(channel2.entries()[0].dsActive, []);
});
