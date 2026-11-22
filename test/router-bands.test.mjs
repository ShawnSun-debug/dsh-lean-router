// dsh-lean-router 票 05 —— 三带配置表与解析纯函数单测（宿主纯 node --test 可跑）
import test from "node:test";
import assert from "node:assert/strict";

import {
  BANDS,
  BAND_IDS,
  DIRECTIVE_BAND_IDS,
  TASK_ECHO_PREFIX,
  classifyTask,
  diligenceReminder,
  isComplexTask,
  parseRouterDirective,
} from "../lib/bands.js";

test("BANDS 三带形状：id/label/personaText/guideText 齐备且工具面宽窄标记符合实测", () => {
  assert.deepEqual([...Object.keys(BANDS)].sort(), [...BAND_IDS].sort());
  for (const id of BAND_IDS) {
    const band = BANDS[id];
    assert.equal(band.id, id);
    assert.equal(typeof band.label, "string");
    assert.ok(band.label.length > 0, id + " label");
    assert.equal(typeof band.personaText, "string");
    assert.ok(band.personaText.length > 20, id + " personaText 非空");
    assert.equal(typeof band.guideText, "string");
    assert.ok(band.guideText.startsWith("Near-field guide"), id + " guideText 固定前缀");
    assert.ok(/Recall/.test(band.personaText), id + " persona 含回顾锚");
    assert.ok(/Converge/.test(band.personaText), id + " persona 含收敛锚");
    assert.ok(/drift/.test(band.personaText), id + " persona 含反跑题锚");
  }
  assert.equal(BANDS.react.toolsWide, true);
  assert.equal(BANDS.spec.toolsWide, false);
  assert.equal(BANDS.weak.toolsWide, false);
});

test("classifyTask：build -> react，fix -> spec，平票/无匹配/空 -> weak", () => {
  assert.equal(classifyTask("帮我开发一个新的贪吃蛇网页游戏"), "react");
  assert.equal(classifyTask("Create a new CLI tool from scratch"), "react");
  assert.equal(classifyTask("修复登录页 500 报错"), "spec");
  assert.equal(classifyTask("排查登录页为什么崩溃"), "spec");
  assert.equal(classifyTask("看看这个"), "weak");
  assert.equal(classifyTask(""), "weak");
});

test("classifyTask 混合证据：计数占优者赢，平票 weak", () => {
  assert.equal(classifyTask("开发一个新工具并实现脚本生成网页"), "react");
  assert.equal(classifyTask("修一下再开发"), "weak");
});

test("parseRouterDirective：解析 [router] band/task 指令，auto/大小写/无指令均正确", () => {
  assert.deepEqual(parseRouterDirective("[router] band=spec task=修复登录超时"), { band: "spec", task: "修复登录超时" });
  assert.deepEqual(parseRouterDirective("[router] band=REACT"), { band: "react" });
  assert.deepEqual(parseRouterDirective("[router] band=auto"), { band: "auto" });
  assert.deepEqual(parseRouterDirective("[router]band=weak"), { band: "weak" });
  assert.equal(parseRouterDirective("普通消息没有指令"), null);
  assert.equal(parseRouterDirective(null), null);
  assert.equal(parseRouterDirective("[router] band=mixed"), null);
});

test("isComplexTask：长文本或架构词为复杂任务", () => {
  assert.equal(isComplexTask("hello"), false);
  assert.equal(isComplexTask("x".repeat(121)), true);
  assert.equal(isComplexTask("重构整个模块"), true);
  assert.equal(isComplexTask("system architecture"), true);
});

test("diligenceReminder：固定句式含轮次号", () => {
  const r = diligenceReminder(30);
  assert.ok(r.includes("Diligence self-check (turn 30)"));
  assert.ok(r.includes("deliverable"));
  assert.notEqual(diligenceReminder(10), diligenceReminder(20));
});

test("DIRECTIVE_BAND_IDS = 三带 + auto", () => {
  assert.deepEqual([...DIRECTIVE_BAND_IDS].sort(), ["auto", "react", "spec", "weak"]);
  assert.equal(TASK_ECHO_PREFIX, "Task: ");
});
