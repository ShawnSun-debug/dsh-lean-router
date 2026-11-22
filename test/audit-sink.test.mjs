// dsh-lean-router 票 07 —— 审计落盘 sink 单测（宿主纯 node --test；临时目录验证，约束台账 acceptance 5）
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAuditChannel, getAuditChannel, round, resolveGateConfig } from "../lib/skillgate.js";
import {
  createAuditSink,
  wireAuditSink,
  readAuditEntries,
  defaultAuditPath,
  DEFAULT_AUDIT_MAX_BYTES,
} from "../lib/audit-sink.js";

const CAT = [
  { name: "code-review", scenario: "engineering", keywords: [], model: true, user: true },
  { name: "tdd", scenario: "engineering", keywords: ["test"], model: true, user: false },
];

async function tempRoot() {
  return await mkdtemp(join(tmpdir(), "lean-audit-"));
}

test("默认路径与 5MB 常量（约束台账 2）", () => {
  assert.ok(defaultAuditPath().endsWith(join(".dsh", "lean-router", "audit.jsonl")));
  assert.equal(DEFAULT_AUDIT_MAX_BYTES, 5 * 1024 * 1024);
});

test("懒建目录 + 追加写：嵌套目录不存在也能落盘", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "nested", "deeper", "audit.jsonl");
    const sink = createAuditSink({ path });
    sink.entry({ v: 1, kind: "skillgate-round", turn: 1 });
    sink.entry({ v: 1, kind: "skillgate-round", turn: 2 });
    const text = await readFile(path, "utf8");
    const lines = text.split("\n").filter((l) => l.trim().length > 0);
    assert.equal(lines.length, 2);
    assert.equal(JSON.parse(lines[0]).turn, 1);
    assert.equal(sink.stats().lines, 2);
    assert.equal(sink.stats().errors, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("轮转：达到 maxBytes 先改名 .1 再追加（单代，覆盖旧 .1）", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    const big = { v: 1, kind: "skillgate-round", turn: 1, pad: "x".repeat(200) };
    const small = { v: 1, kind: "skillgate-round", turn: 2 };
    const sink = createAuditSink({ path, maxBytes: 64 });
    sink.entry(big); // > 64B：写入后文件超限
    sink.entry(small); // 触发轮转：旧文件快照 -> .1，small 进新文件
    assert.equal(sink.stats().rotations, 1);
    const rotatedLines = (await readFile(path + ".1", "utf8")).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    assert.deepEqual(rotatedLines.map((e) => e.turn), [1]);
    const current = JSON.parse(await readFile(path, "utf8"));
    assert.equal(current.turn, 2);
    // 再次超限：旧 .1 被覆盖（单代轮转；.1 = 上一文件的整快照，可含多行）
    sink.entry({ v: 1, kind: "skillgate-round", turn: 3, pad: "y".repeat(200) });
    sink.entry({ v: 1, kind: "skillgate-round", turn: 4 });
    assert.equal(sink.stats().rotations, 2);
    const again = (await readFile(path + ".1", "utf8")).split("\n").filter((l) => l.trim().length > 0).map((l) => JSON.parse(l));
    assert.deepEqual(again.map((e) => e.turn), [2, 3]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("错误全吞：目标路径被文件占用时只计数不抛错", async () => {
  const root = await tempRoot();
  try {
    const blocker = join(root, "blocker");
    await writeFile(blocker, "not a directory", "utf8");
    const sink = createAuditSink({ path: join(blocker, "sub", "audit.jsonl") });
    assert.doesNotThrow(() => sink.entry({ v: 1, kind: "skillgate-round" }));
    assert.equal(sink.stats().errors, 1);
    assert.equal(sink.stats().lines, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("回放：坏行跳过计数、limit 取最新、文件缺失标记 missing", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    await writeFile(path, '{"turn":1}\nnot-json\n{"turn":2}\n\n', "utf8");
    const all = readAuditEntries(path);
    assert.deepEqual(all.entries.map((e) => e.turn), [1, 2]);
    assert.equal(all.skipped, 1);
    assert.equal(all.missing, false);
    const last1 = readAuditEntries(path, { limit: 1 });
    assert.deepEqual(last1.entries.map((e) => e.turn), [2]);
    const missing = readAuditEntries(join(root, "nope.jsonl"));
    assert.equal(missing.missing, true);
    assert.equal(missing.entries.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("wireAuditSink：通道盖章 seq 落盘，退订后停止写入", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    const channel = createAuditChannel();
    const handle = wireAuditSink(channel, { path });
    channel.push({ v: 1, kind: "skillgate-round", turn: 1 });
    channel.push({ v: 1, kind: "skillgate-round", turn: 2 });
    handle.unsubscribe();
    channel.push({ v: 1, kind: "skillgate-round", turn: 3 });
    const entries = readAuditEntries(path).entries;
    assert.deepEqual(entries.map((e) => e.turn), [1, 2]);
    assert.equal(entries[0].seq, 1, "通道盖章 seq 进 JSONL");
    assert.equal(handle.sink.stats().lines, 2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("getAuditChannel：共享单例恒等，且独立于新建通道", () => {
  assert.equal(getAuditChannel(), getAuditChannel());
  assert.notEqual(getAuditChannel(), createAuditChannel());
});

test("决策流接 sink 端到端：round -> 共享通道 -> JSONL 可回放（验收 5）", async () => {
  const root = await tempRoot();
  try {
    const path = join(root, "audit.jsonl");
    const handle = wireAuditSink(getAuditChannel(), { path });
    const cfg = resolveGateConfig();
    const outcome = round({ taskText: "写一个游戏网页 test", turn: 1 }, CAT, cfg, getAuditChannel());
    assert.equal(outcome.active, true);
    handle.unsubscribe();
    const entries = readAuditEntries(path).entries;
    assert.equal(entries.length, 1);
    const e = entries[0];
    assert.equal(e.kind, "skillgate-round");
    assert.equal(e.v, 1);
    assert.equal(typeof e.seq, "number");
    assert.ok(Array.isArray(e.decision.auto));
    assert.ok(Array.isArray(e.scores));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
