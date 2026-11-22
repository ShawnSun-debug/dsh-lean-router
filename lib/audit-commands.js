// dsh-lean-router - 审计命令与命中统计（票 07）
//
// /lean-audit 的实现本体（lib/router.js 命令分发处加法接线注册；handler 可测试直调）。
// 数据源 = 审计 JSONL 回放（lib/audit-sink.js 的 readAuditEntries），不新增内存态
// （约束台账 1：来源 = 审计流回放）。落盘路径与权重文件路径由接线方注入（context）。
//
// 输出四要素（与 ui/go.json 面板按钮同源）：
//   决策行      —— 最近 N 条 skillgate-round 的单行摘要（turn/band/auto/hint/tokens）
//   得分表折叠  —— 默认只展开最新一条的 Top5；/lean-audit scores [N] 展开全量得分行
//   token 对比  —— 最新决策 estTokens / budgetTokens（charsPerToken 注明）
//   黄条        —— 超预算 / 有软降级 / 回放坏行 / 权重回退时输出 ⚠ 告警段，否则不出现
//
// 纯 node 可测；本模块不写文件、不改 invocation。

import { readAuditEntries, defaultAuditPath } from "./audit-sink.js";
import { loadGateWeights } from "./skillgate.js";

/** 默认显示的最近决策条数（/lean-audit [N] 可改，1..100）。 */
export const DEFAULT_RECENT = 10;
/** 得分表折叠视图默认展开的 Top 行数。 */
export const SCORE_TABLE_TOP = 5;
/** 统计回放单文件条数上限（防异常大文件；轮转已把当前文件压在 5MB）。 */
export const REPLAY_MAX_ENTRIES = 2000;

const VIEWS = ["scores", "stats", "weights"];

/** 解析 /lean-audit 参数：[scores|stats|weights] [N]（纯数字 = summary 的条数）。 */
export function parseAuditArgs(raw) {
  const tokens = typeof raw === "string" ? raw.trim().split(/[ \t]+/).filter(Boolean) : [];
  let view = "summary";
  let count = null;
  let rest = tokens;
  if (tokens.length > 0 && VIEWS.includes(tokens[0])) {
    view = tokens[0];
    rest = tokens.slice(1);
  }
  if (rest.length > 0) {
    const joined = rest.join(" ");
    if (!/^\d+$/.test(joined)) throw new Error("usage: /lean-audit [scores|stats|weights] [N]");
    count = parseInt(joined, 10);
  }
  if (view === "scores" && count === null) count = 1;
  if (view === "summary" && count === null) count = DEFAULT_RECENT;
  if (count !== null && (count < 1 || count > 100)) throw new Error("/lean-audit N must be 1..100");
  return { view, count };
}

/** 决策行（决策要素）：#序 turn band auto/hint tokens；complex 加 * 标记。 */
export function formatDecisionLine(entry, index) {
  const d = entry.decision ?? {};
  const num = String(index).padStart(2, "0");
  const band = (d.band ?? "?") + (entry.task?.complex === true ? "*" : "");
  return (
    "#" + num +
    " turn=" + String(entry.turn ?? "-") +
    " band=" + band +
    " auto=" + (Array.isArray(d.auto) ? d.auto.length : 0) +
    " hint=" + (Array.isArray(d.hint) ? d.hint.length : 0) +
    " tokens=" + (d.estTokens ?? "?") + "/" + (d.budgetTokens ?? "?")
  );
}

/** token 对比行（最新一条）；无条目返回 null。 */
export function formatTokenLine(entry) {
  const d = entry?.decision;
  if (!d) return null;
  const cpt = entry.config?.charsPerToken ?? 4;
  return (
    "Token (turn " + String(entry.turn ?? "-") + "): est " + (d.estTokens ?? "?") +
    " / budget " + (d.budgetTokens ?? "?") + " tokens (charsPerToken=" + cpt + ")" +
    (d.estTokens > d.budgetTokens ? "  OVER" : "  within")
  );
}

/** 得分行归一：一条审计的 scores -> 展示行（档位来自 decision）。 */
export function scoreRows(entry) {
  const auto = new Set(Array.isArray(entry?.decision?.auto) ? entry.decision.auto : []);
  const hint = new Set(Array.isArray(entry?.decision?.hint) ? entry.decision.hint : []);
  return (Array.isArray(entry?.scores) ? entry.scores : []).map((s) => ({
    name: s?.name ?? "?",
    score: typeof s?.score === "number" ? s.score : 0,
    tier: auto.has(s?.name) ? "auto" : hint.has(s?.name) ? "hint" : "off",
    scene: s?.signals?.category?.scene ?? "process",
    keywords: Array.isArray(s?.signals?.keywords) ? s.signals.keywords : [],
    model: s?.model === true,
    user: s?.user === true,
    points: s?.signals?.category?.points ?? 0,
    complex: s?.signals?.category?.complex === true,
  }));
}

function padEnd(text, width) {
  const s = String(text);
  return s.length >= width ? s : s + " ".repeat(width - s.length);
}
function padStart(text, width) {
  const s = String(text);
  return s.length >= width ? s : " ".repeat(width - s.length) + s;
}

/** 全量得分表文本（展开视图；按分数降序、名字序次之）。 */
export function renderScoreTable(entry) {
  const rows = scoreRows(entry).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const lines = [];
  lines.push(
    "Score table turn=" + String(entry?.turn ?? "-") + " band=" + (entry?.decision?.band ?? "?") +
    " (" + rows.length + " skills):"
  );
  lines.push(padEnd("skill", 20) + padStart("score", 6) + "  " + padEnd("tier", 6) + padEnd("scene", 12) + padEnd("kw", 14) + "m/u");
  for (const r of rows) {
    lines.push(
      padEnd(r.name, 20) + padStart(r.score, 6) + "  " +
      padEnd(r.tier, 6) + padEnd(r.scene, 12) +
      padEnd(r.keywords.length === 0 ? "-" : r.keywords.join(","), 14) +
      (r.model ? "m" : "-") + (r.user ? "u" : "-")
    );
  }
  return lines.join("\n");
}

/** 折叠视图：Top K 行摘要 + 展开提示。 */
export function renderScoreCollapsed(entry) {
  const rows = scoreRows(entry).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const total = rows.length;
  const top = rows.slice(0, SCORE_TABLE_TOP);
  const lines = ["Score table (collapsed, top " + top.length + " of " + total + "; /lean-audit scores to expand):"];
  for (const r of top) {
    lines.push("  " + padEnd(r.name, 20) + padStart(r.score, 3) + " " + r.tier);
  }
  return lines.join("\n");
}

/** 命中统计：按技能×场景聚合（约束台账 1），纯函数、只吃回放条目。 */
export function aggregateStats(entries) {
  const rows = new Map();
  for (const entry of entries) {
    if (!entry || entry.kind !== "skillgate-round" || !Array.isArray(entry.scores)) continue;
    const autoSet = new Set(Array.isArray(entry.decision?.auto) ? entry.decision.auto : []);
    const hintSet = new Set(Array.isArray(entry.decision?.hint) ? entry.decision.hint : []);
    const degraded = Array.isArray(entry.decision?.degradations) ? entry.decision.degradations : [];
    for (const s of entry.scores) {
      if (typeof s?.name !== "string") continue;
      let row = rows.get(s.name);
      if (!row) {
        row = { name: s.name, scene: s?.signals?.category?.scene ?? "process", rounds: 0, hits: 0, auto: 0, hint: 0, degraded: 0 };
        rows.set(s.name, row);
      }
      row.rounds += 1;
      if (Array.isArray(s?.signals?.keywords) && s.signals.keywords.length > 0) row.hits += 1;
      if (autoSet.has(s.name)) row.auto += 1;
      if (hintSet.has(s.name)) row.hint += 1;
      if (degraded.some((d) => d?.name === s.name)) row.degraded += 1;
    }
  }
  return [...rows.values()].sort(
    (a, b) => (b.hits + b.auto + b.hint) - (a.hits + a.auto + a.hint) || a.name.localeCompare(b.name)
  );
}

/** 命中统计表文本。 */
export function renderStatsTable(rows, rounds) {
  const lines = [];
  lines.push("Hit stats (per skill x scene, from " + rounds + " replayed round(s)):");
  lines.push(
    padEnd("skill", 20) + padEnd("scene", 12) +
    padStart("rounds", 7) + padStart("hits", 6) + padStart("auto", 6) + padStart("hint", 6) + padStart("degraded", 9)
  );
  for (const r of rows) {
    lines.push(
      padEnd(r.name, 20) + padEnd(r.scene, 12) +
      padStart(r.rounds, 7) + padStart(r.hits, 6) + padStart(r.auto, 6) + padStart(r.hint, 6) + padStart(r.degraded, 9)
    );
  }
  return lines.join("\n");
}

/** 黄条：超预算 / 软降级 / 回放坏行 / 权重回退；仅在有问题时返回行（无则无黄条）。 */
export function collectWarnings(entries, replay, weights) {
  const bars = [];
  for (const e of entries) {
    const d = e.decision;
    if (!d) continue;
    if (d.estTokens > d.budgetTokens) {
      bars.push("⚠ turn " + String(e.turn ?? "?") + ": token est " + d.estTokens + " > budget " + d.budgetTokens);
    }
    const dg = Array.isArray(d.degradations) ? d.degradations.length : 0;
    if (dg > 0) bars.push("⚠ turn " + String(e.turn ?? "?") + ": " + dg + " skill(s) soft-degraded to hint");
  }
  if (replay && replay.skipped > 0) {
    bars.push("⚠ replay skipped " + replay.skipped + " malformed line(s)");
  }
  if (weights && weights.error) {
    bars.push("⚠ weights " + weights.status + ": " + weights.error + " (defaults in effect)");
  }
  return bars;
}

function renderBanner(bars) {
  return bars.length === 0 ? "" : bars.join("\n") + "\n";
}

/** 手动权重展示（/lean-audit weights）。 */
export function renderWeights(weights) {
  const c = weights.config;
  const lines = [];
  lines.push("Gate weights [" + weights.status + "] - source: " + weights.source);
  if (weights.error) lines.push("error: " + weights.error);
  lines.push(
    "autoScore=" + c.autoScore + " hintScore=" + c.hintScore +
    " tokenBudget=" + c.tokenBudget + " charsPerToken=" + c.charsPerToken +
    " maxTaskTextChars=" + c.maxTaskTextChars
  );
  for (const band of ["react", "spec", "weak"]) {
    const m = Object.entries(c.sceneMap[band] ?? {}).map(([k, v]) => k + "=" + v).join(" ") || "(none)";
    lines.push("sceneMap." + band + ": " + m);
  }
  lines.push("complexBoost: " + (Object.entries(c.complexBoost).map(([k, v]) => k + "=" + v).join(" ") || "(none)"));
  lines.push("arbitration: " + c.arbitration.map((r) => r.scene + "->" + r.prefer).join(", "));
  lines.push("Edit assets/gating.weights.json (gateConfig subset; scene bonus / thresholds / soft-degrade line).");
  lines.push("Missing or invalid file falls back to the hardcoded defaults; weights never change invocation.");
  return lines.join("\n");
}

function emptyStateText(auditPath) {
  return (
    "No audit entries yet at " + auditPath + "\n" +
    "The audit file appears once the gate wiring runs (master integration): skillgate round -> getAuditChannel -> wireAuditSink.\n" +
    "See docs/面板-设计说明.md for the wiring."
  );
}

/** 汇总视图（默认）：黄条 -> 决策行 -> token 对比 -> 得分表折叠 -> 命中统计。 */
export function renderSummaryView(entries, count, replay, auditPath) {
  if (entries.length === 0) return emptyStateText(auditPath);
  const recent = entries.slice(-count);
  const bars = collectWarnings(recent, replay, null);
  const lines = [];
  const banner = renderBanner(bars);
  if (banner) lines.push(banner.trimEnd());
  lines.push("Lean audit - replayed from " + auditPath + " (" + entries.length + " round(s) in file, showing last " + recent.length + ")");
  lines.push("Decisions (newest last):");
  for (let i = 0; i < recent.length; i += 1) lines.push(formatDecisionLine(recent[i], i + 1));
  const token = formatTokenLine(entries[entries.length - 1]);
  if (token) lines.push(token);
  lines.push(renderScoreCollapsed(entries[entries.length - 1]));
  lines.push(renderStatsTable(aggregateStats(entries), entries.length));
  return lines.join("\n");
}

/** 得分表展开视图：最近 N 条的全量得分行。 */
export function renderScoresView(entries, count, auditPath) {
  if (entries.length === 0) return emptyStateText(auditPath ?? "<audit path>");
  const recent = entries.slice(-count);
  return recent.map((e) => renderScoreTable(e)).join("\n\n");
}

/** 统计视图：黄条 -> 命中统计表。 */
export function renderStatsView(entries, replay, auditPath) {
  if (entries.length === 0) return emptyStateText(auditPath ?? "<audit path>");
  const bars = collectWarnings([], replay, null);
  const lines = [];
  const banner = renderBanner(bars);
  if (banner) lines.push(banner.trimEnd());
  lines.push(renderStatsTable(aggregateStats(entries), entries.length));
  return lines.join("\n");
}

/**
 * /lean-audit handler 的共享实现（lib/router.js 注册；测试直调）。
 * context: { auditPath?, weightsPath? }；无 agent 依赖（审计是全局流）。
 */
export async function executeAuditCommand(invocation, context) {
  const auditPath = context?.auditPath ?? defaultAuditPathSafe();
  const weightsPath = context?.weightsPath ?? null;
  try {
    const { view, count } = parseAuditArgs(invocation?.rawInput ?? "");
    if (view === "weights") {
      const weights = await loadGateWeights(weightsPath ?? undefined);
      return { kind: "success", text: renderWeights(weights) };
    }
    const replay = readAuditEntries(auditPath, { limit: REPLAY_MAX_ENTRIES });
    const entries = replay.entries.filter((e) => e && e.kind === "skillgate-round");
    if (view === "stats") return { kind: "success", text: renderStatsView(entries, replay, auditPath) };
    if (view === "scores") return { kind: "success", text: renderScoresView(entries, count ?? 1, auditPath) };
    return { kind: "success", text: renderSummaryView(entries, count ?? DEFAULT_RECENT, replay, auditPath) };
  } catch (error) {
    return { kind: "error", text: "Audit command failed: " + (error instanceof Error ? error.message : String(error)) };
  }
}
