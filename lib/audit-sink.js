// dsh-lean-router - 审计落盘 sink（票 07）
//
// 结论先行：审计通道（lib/skillgate.js createAuditChannel）默认只在内存环形缓冲
// + 订阅；本模块把决策流接成 JSONL 文件——追加写、5MB 轮转、目录懒建、错误全吞
// （审计永不破坏门控管线）。默认路径 <homedir>/.dsh/lean-router/audit.jsonl，
// 经 patch 行 config.auditPath 可配（接线由 master 集成，见 docs/面板-设计说明.md）。
//
// 纯 node 可测（node:fs/node:os/node:path 内建）；每条决策一行 JSON（v=1 格式，
// 含通道盖章的 seq）；轮转单代：audit.jsonl -> audit.jsonl.1（覆盖旧 .1）。
// 回放（面板数据源 = 面板读文件）只读当前文件，轮转历史不并入（口径见设计说明）。

import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

/** 默认轮转阈值：5MB（约束台账：追加写、5MB 轮转）。 */
export const DEFAULT_AUDIT_MAX_BYTES = 5 * 1024 * 1024;

/** 默认落盘路径：<homedir>/.dsh/lean-router/audit.jsonl（patch 行 config.auditPath 可配）。 */
export function defaultAuditPath() {
  return join(homedir(), ".dsh", "lean-router", "audit.jsonl");
}

function normalizeOptions(options) {
  const path =
    typeof options?.path === "string" && options.path.length > 0
      ? options.path
      : defaultAuditPath();
  const maxBytes =
    typeof options?.maxBytes === "number" && Number.isSafeInteger(options.maxBytes) && options.maxBytes > 0
      ? options.maxBytes
      : DEFAULT_AUDIT_MAX_BYTES;
  return { path, maxBytes };
}

/**
 * 审计 sink：订阅函数形态（channel.subscribe(sink.entry) 兼容）+ 回放读取。
 * 写失败只计数不抛错（门控管线安全）；目录懒建；当前文件达到 maxBytes 先轮转再写。
 */
export function createAuditSink(options) {
  const { path, maxBytes } = normalizeOptions(options);
  const stats = { lines: 0, bytes: 0, rotations: 0, errors: 0 };
  let dirReady = false;

  function ensureDir() {
    if (dirReady) return;
    mkdirSync(dirname(path), { recursive: true });
    dirReady = true;
  }

  function rotateIfNeeded() {
    let size = 0;
    try {
      size = statSync(path).size;
    } catch {
      return; // 文件尚不存在：无需轮转
    }
    if (size < maxBytes) return;
    try {
      renameSync(path, path + ".1");
      stats.rotations += 1;
      dirReady = true;
    } catch {
      // rename 失败（Windows 占用等）：放弃本轮轮转，继续追加（审计不中断）。
    }
  }

  function entry(stamped) {
    let line;
    try {
      line = JSON.stringify(stamped);
    } catch {
      stats.errors += 1;
      return;
    }
    if (typeof line !== "string") {
      stats.errors += 1;
      return;
    }
    try {
      ensureDir();
      rotateIfNeeded();
      appendFileSync(path, line + "\n", "utf8");
      stats.lines += 1;
      stats.bytes += Buffer.byteLength(line + "\n", "utf8");
    } catch {
      stats.errors += 1;
      dirReady = false; // 目录可能被外移：下次写入重试懒建
    }
  }

  return {
    entry,
    path,
    maxBytes,
    stats: () => ({ ...stats }),
  };
}

/** 把 sink 接上审计通道（加法接线）；返回 { sink, unsubscribe }。 */
export function wireAuditSink(channel, options) {
  const sink = createAuditSink(options);
  const unsubscribe = channel.subscribe(sink.entry);
  return { sink, unsubscribe };
}

/**
 * 回放（审计流回放的数据源）：读 JSONL 为条目数组，容忍坏行（跳过并计数）。
 * limit 取最新的 N 条（文件尾部向头部）；轮转文件（*.1）不并入回放。
 */
export function readAuditEntries(path, options) {
  const limit =
    typeof options?.limit === "number" && Number.isSafeInteger(options.limit) && options.limit > 0
      ? options.limit
      : Infinity;
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return { entries: [], skipped: 0, missing: true };
    return { entries: [], skipped: 0, missing: false, error: String(error?.message ?? error) };
  }
  const lines = text.split("\n");
  const out = [];
  let skipped = 0;
  for (let i = lines.length - 1; i >= 0 && out.length < limit; i -= 1) {
    const raw = lines[i];
    if (raw.trim().length === 0) continue;
    try {
      out.push(JSON.parse(raw));
    } catch {
      skipped += 1;
    }
  }
  out.reverse();
  return { entries: out, skipped, missing: false };
}
