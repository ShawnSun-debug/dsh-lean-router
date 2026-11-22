// dsh-lean-router - 技能门控层（票 06）
//
// 结论先行（宿主 dsh-skill/lib/index.js 实读）：SkillRegistry.collect() 按
// (cwd, scopeChain, revision) 缓存 catalog（L265-297），provider.list() 只在缓存
// 未命中时被调用（L350，collectLayer -> listLayerCandidates）。因此"每轮门控"
// 不能依赖 list() 被重新调用 —— 本层按回退方案实现：provider.list() 恒返回
// 全量 31 技能（全量可见），每轮打分/挂载/近场提示由本模块在注入缝执行，
// 审计里标注 mode: "fallback-cached-list"（缓存降级）。
//
// 每轮管线（门控只在显式传入状态时生效；无状态 = 门控关闭 = 一切不变）：
//   scoreSkills -> arbitrate(ds-* 裁决) -> decide(阈值分档) -> degrade(>8k 软降)
//   -> renderAdmission(近场文本) -> audit（每轮 31 技能全打分、得分+信号全留痕）。
//
// 约束锚点：
// - 裁决只影响放行集合（auto->hint 降档），永不改 invocation 开关。
// - 仅 model-invocable 技能可进 auto/hint（模型通道）；user-only 技能仍全量
//   可见、走 /skill 人工点名，不受门控影响。
// - 软降级：只设总量软保险（tokenBudget，默认 8000），降级个数不设上限；
//   被降级的是"低分"技能（得分升序，再按名字序保证确定性）。
// - 本模块除 bands.js 外仅依赖 node 内建（票 07 加法：权重文件读取），纯 node 可测；
//   审计默认只进内存环形缓冲 + 订阅通道（票 07 面板消费），落盘经 lib/audit-sink.js
//   的 sink 订阅接线（getAuditChannel 共享单例 + wireAuditSink），默认不落盘。

import { classifyTask, isComplexTask } from "./bands.js";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** 审计条目格式版本（写入每条审计的 v 字段；格式变更必须升版本，见设计说明）。 */
export const AUDIT_FORMAT_VERSION = 1;

/**
 * 近场技能通道的 dynamic context 建议名（接线由 master 集成）：
 * 与 lib/router.js 的 GUIDE_CONTEXT_NAME 同通道类型（ctx.systemPrompt.context），
 * 同一带内文本恒定 = 零写入、缓存友好；挂载集合变化时文本才变化。
 */
export const GATE_CONTEXT_NAME = "lean-router:skills";

/**
 * 默认门控配置（全部可配；resolveGateConfig 校验后使用）。
 * - sceneMap: 信号 A（分类标签映射）：路由带 -> 场景 -> 加分。
 * - complexBoost: isComplexTask 时对场景的额外加分（深度任务偏工程）。
 * - arbitration: ds-* 场景裁决表（数据驱动可配）。prefer: "ds" = 该场景下
 *   ds-* 活跃时 mattpocock 技能从 auto 降档到 hint；"mattpocock" = 不降档；
 *   未列出的场景 = passThrough（不裁决）。
 */
export const DEFAULT_GATE_CONFIG = {
  autoScore: 2,
  hintScore: 1,
  tokenBudget: 8000,
  charsPerToken: 4,
  maxTaskTextChars: 4000,
  sceneMap: {
    react: { engineering: 2, process: 1 },
    spec: { engineering: 2, research: 1 },
    weak: {},
  },
  complexBoost: { engineering: 1 },
  arbitration: [
    { scene: "engineering", prefer: "ds" },
    { scene: "process", prefer: "mattpocock" },
  ],
};

const ARBITRATION_PREFERS = new Set(["ds", "mattpocock"]);

/** 校验并补全门控配置；未知键报错（失败尽早）。 */
export function resolveGateConfig(partial) {
  const cfg = partial ?? {};
  const unknown = Object.keys(cfg).filter(
    (key) => !["autoScore", "hintScore", "tokenBudget", "charsPerToken", "maxTaskTextChars", "sceneMap", "complexBoost", "arbitration"].includes(key)
  );
  if (unknown.length > 0) throw new Error("skillgate: unknown option(s): " + unknown.join(", "));
  const autoScore = cfg.autoScore ?? DEFAULT_GATE_CONFIG.autoScore;
  const hintScore = cfg.hintScore ?? DEFAULT_GATE_CONFIG.hintScore;
  const tokenBudget = cfg.tokenBudget ?? DEFAULT_GATE_CONFIG.tokenBudget;
  const charsPerToken = cfg.charsPerToken ?? DEFAULT_GATE_CONFIG.charsPerToken;
  const maxTaskTextChars = cfg.maxTaskTextChars ?? DEFAULT_GATE_CONFIG.maxTaskTextChars;
  if (!Number.isFinite(autoScore) || !Number.isFinite(hintScore) || hintScore > autoScore) {
    throw new Error("skillgate: require autoScore >= hintScore (finite numbers)");
  }
  if (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0) throw new Error("skillgate: tokenBudget must be a positive safe integer");
  if (!Number.isSafeInteger(charsPerToken) || charsPerToken <= 0) throw new Error("skillgate: charsPerToken must be a positive safe integer");
  if (!Number.isSafeInteger(maxTaskTextChars) || maxTaskTextChars <= 0) throw new Error("skillgate: maxTaskTextChars must be a positive safe integer");
  const sceneMap = cfg.sceneMap ?? DEFAULT_GATE_CONFIG.sceneMap;
  for (const band of Object.keys(sceneMap)) {
    if (!["react", "spec", "weak"].includes(band)) throw new Error("skillgate: sceneMap band must be react|spec|weak");
    for (const [scene, points] of Object.entries(sceneMap[band])) {
      if (!Number.isFinite(points)) throw new Error("skillgate: sceneMap points must be finite numbers");
    }
  }
  const complexBoost = cfg.complexBoost ?? DEFAULT_GATE_CONFIG.complexBoost;
  for (const [scene, points] of Object.entries(complexBoost)) {
    if (!Number.isFinite(points)) throw new Error("skillgate: complexBoost points must be finite numbers");
  }
  const arbitration = cfg.arbitration ?? DEFAULT_GATE_CONFIG.arbitration;
  for (const rule of arbitration) {
    if (typeof rule.scene !== "string" || rule.scene.length === 0) throw new Error("skillgate: arbitration rule needs a scene");
    if (!ARBITRATION_PREFERS.has(rule.prefer)) throw new Error("skillgate: arbitration prefer must be ds|mattpocock");
  }
  return { autoScore, hintScore, tokenBudget, charsPerToken, maxTaskTextChars, sceneMap, complexBoost, arbitration };
}

/** 估算注入文本 token（保守整数；charsPerToken 默认 4 = 约 4 字符/token）。 */
export function estimateTokens(text, config) {
  const chars = typeof text === "string" ? text.length : 0;
  return chars === 0 ? 0 : Math.max(1, Math.ceil(chars / config.charsPerToken));
}

/** 门控是否激活：只在显式传入含非空 taskText 的状态时为 true（无状态 = 关）。 */
export function isGateActive(state) {
  return (
    state !== null &&
    typeof state === "object" &&
    typeof state.taskText === "string" &&
    state.taskText.length > 0
  );
}

/**
 * 信号 A+B 全量打分：对传入 catalog 的每个技能都打一遍（31 个全打，主人定案）。
 * - 信号 A（分类标签映射）：bands.classifyTask 得路由带 -> sceneMap[band][场景] 加分；
 *   isComplexTask 再叠加 complexBoost[场景]。
 * - 信号 B（关键词命中）：矩阵 keywords（数据源即主人的拍板文件）逐个
 *   大小写不敏感匹配任务文本；命中即 +1（按关键词个数计，不按出现次数）。
 * catalog 行：{ name, scenario?, keywords?, model, user }（provider.catalogRows 的形状）。
 */
export function scoreSkills(taskText, catalog, config) {
  const text = typeof taskText === "string" ? taskText.slice(0, config.maxTaskTextChars) : "";
  const band = typeof text === "string" && text.length > 0 ? classifyTask(text) : "weak";
  const complex = isComplexTask(text);
  const scenePoints = config.sceneMap[band] ?? {};
  const rows = catalog instanceof Map ? [...catalog.values()] : catalog;
  const scores = [];
  for (const row of rows) {
    const scene = row.scenario ?? "process";
    const categoryPoints = scenePoints[scene] ?? 0;
    const boost = complex ? (config.complexBoost[scene] ?? 0) : 0;
    const keywords = Array.isArray(row.keywords) ? row.keywords : [];
    const hit = [];
    for (const keyword of keywords) {
      if (typeof keyword === "string" && keyword.length > 0 && text.toLowerCase().includes(keyword.toLowerCase())) hit.push(keyword);
    }
    const score = categoryPoints + boost + hit.length;
    scores.push({
      name: row.name,
      score,
      signals: {
        category: { band, scene, points: categoryPoints + boost, complex },
        keywords: hit,
      },
      model: row.model !== false,
      user: row.user !== false,
    });
  }
  return { band, complex, scores };
}

/**
 * ds-* 场景裁决（约束 1）：数据驱动表逐条应用；prefer=ds 且 ds-* 活跃
 * （dsActive 非空）时，该场景的 mattpocock 技能从 auto 降档到 hint；
 * prefer=mattpocock 与 passThrough 场景不降档。裁决只改放行档位，
 * 永不改 invocation（调用方传入的档位表被复制后修改）。
 */
export function arbitrate(tiers, catalog, config, dsActive) {
  const next = new Map(tiers);
  const applied = [];
  const active = Array.isArray(dsActive) && dsActive.some((name) => typeof name === "string" && name.startsWith("ds-"));
  if (!active) return { tiers: next, applied };
  const rows = catalog instanceof Map ? [...catalog.values()] : catalog;
  const sceneOf = new Map(rows.map((row) => [row.name, row.scenario ?? "process"]));
  for (const rule of config.arbitration) {
    if (rule.prefer !== "ds") continue;
    for (const [name, tier] of next) {
      if (tier === "auto" && sceneOf.get(name) === rule.scene) {
        next.set(name, "hint");
        applied.push({ name, from: "auto", to: "hint", reason: "scene=" + rule.scene + " prefers ds (ds-* active)" });
      }
    }
  }
  return { tiers: next, applied };
}

/**
 * 阈值分档（信号分 -> 放行集合）：只考虑 model-invocable 技能；
 * score >= autoScore -> auto；hintScore <= score < autoScore -> hint；其余 off。
 */
export function classifyTiers(scores, config) {
  const tiers = new Map();
  for (const s of scores) {
    if (!s.model) {
      tiers.set(s.name, "off");
      continue;
    }
    if (s.score >= config.autoScore) tiers.set(s.name, "auto");
    else if (s.score >= config.hintScore) tiers.set(s.name, "hint");
    else tiers.set(s.name, "off");
  }
  return tiers;
}

/**
 * 软降级（约束 8）：注入估算 token 超过 tokenBudget 时，把"低分"auto 技能
 * 降为 hint（得分升序、名字序次之，确定性），直到估算 <= 预算。
 * 个数不设上限 —— 只有总量软保险。invocation 不变。
 */
export function degrade(autoNames, hintNames, scoredByName, renderText, config) {
  const auto = [...autoNames];
  const hint = [...hintNames];
  const degraded = [];
  let estTokens = estimateTokens(renderText(auto, hint), config);
  const scoreOf = new Map(scoredByName.map((s) => [s.name, s.score]));
  while (estTokens > config.tokenBudget && auto.length > 0) {
    let pick = 0;
    for (let i = 1; i < auto.length; i += 1) {
      const a = scoreOf.get(auto[i]) ?? 0;
      const b = scoreOf.get(auto[pick]) ?? 0;
      if (a < b || (a === b && auto[i] < auto[pick])) pick = i;
    }
    const [name] = auto.splice(pick, 1);
    hint.push(name);
    degraded.push({ name, from: "auto", to: "hint" });
    estTokens = estimateTokens(renderText(auto, hint), config);
  }
  return { auto, hint, degraded, estTokens };
}

/**
 * 渲染近场技能通道文本（高置信挂载 + 低置信提示；同一决策下文本恒定，
 * 宿主 dynamic context 判等即零写入）。model-facing 文本用英文。
 */
export function renderAdmission(decision, catalog, options) {
  const rows = catalog instanceof Map ? [...catalog.values()] : catalog;
  const byName = new Map(rows.map((row) => [row.name, row]));
  const desc = (name) => {
    const row = byName.get(name);
    return row && typeof row.description === "string" ? row.description.replace(/\s+/g, " ").trim() : "";
  };
  const lines = [];
  lines.push("Skill gate (turn " + (options?.turn ?? 0) + ", band=" + decision.band + (decision.complex ? ", complex" : "") + "):");
  if (decision.auto.length > 0) {
    lines.push("High-confidence skills for this task - load each now with the skill tool before working:");
    for (const name of decision.auto) lines.push("- " + name + " [auto]: " + desc(name));
  }
  if (decision.hint.length > 0) {
    lines.push("Possible matches (invoke only if clearly relevant):");
    for (const name of decision.hint) lines.push("- " + name + ": " + desc(name));
  }
  if (decision.auto.length === 0 && decision.hint.length === 0) lines.push("No skill clearly matches this task.");
  return lines.join("\n");
}

/** 内存审计通道：环形缓冲 + 订阅（票 07 面板消费）；不落盘。 */
export function createAuditChannel(options) {
  const capacity = typeof options?.capacity === "number" && options.capacity > 0 ? Math.floor(options.capacity) : 256;
  const buffer = [];
  const subscribers = new Set();
  let seq = 0;
  return {
    push(entry) {
      seq += 1;
      const stamped = { seq, ...entry };
      buffer.push(stamped);
      if (buffer.length > capacity) buffer.shift();
      for (const fn of subscribers) {
        try {
          fn(stamped);
        } catch {}
      }
      return stamped;
    },
    entries() {
      return [...buffer];
    },
    drain() {
      return buffer.splice(0, buffer.length);
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}

// ---- 票 07 加法接线：模块级共享审计通道（决策流 -> sink 的唯一接缝） ----
// 语义不变：round()/makeProvider({ audit }) 的显式通道优先；本单例只给接线方
// （lib/router.js apply 的 audit 行 + master 集成的近场调用）对齐同一条决策流，
// sink（lib/audit-sink.js）经 wireAuditSink(channel) 挂上来。缺省不创建、不推送。
let sharedAuditChannel = null;

/** 模块级共享审计通道（懒建单例）：接线方与门控调用方用它复用同一条决策流。 */
export function getAuditChannel() {
  if (sharedAuditChannel === null) sharedAuditChannel = createAuditChannel();
  return sharedAuditChannel;
}

/**
 * 单轮门控管线：打分（31 全量）-> 阈值分档 -> ds-* 裁决 -> 软降级 -> 渲染 -> 审计。
 * 返回 { active, decision?, auditEntry? }；未激活时不产出决策也不写审计。
 * tier 来源顺序：classifyTiers（阈值）-> arbitrate（裁决降档）-> degrade（软降）。
 */
export function round(state, catalog, config, audit) {
  if (!isGateActive(state)) return { active: false };
  const scored = scoreSkills(state.taskText, catalog, config);
  const scoredByName = scored.scores;
  let tiers = classifyTiers(scoredByName, config);
  const arbitration = arbitrate(tiers, catalog, config, state.dsActive);
  tiers = arbitration.tiers;
  const autoAll = [...tiers].filter(([, tier]) => tier === "auto").map(([name]) => name);
  const hintAll = [...tiers].filter(([, tier]) => tier === "hint").map(([name]) => name);
  const renderText = (auto, hint) =>
    renderAdmission(
      { band: scored.band, complex: scored.complex, auto, hint },
      catalog,
      { turn: state.turn ?? 0 }
    );
  const result = degrade(autoAll, hintAll, scoredByName, renderText, config);
  const decision = {
    band: scored.band,
    complex: scored.complex,
    auto: result.auto,
    hint: result.hint.sort(),
    arbitrations: arbitration.applied,
    degradations: result.degraded,
    estTokens: result.estTokens,
    budgetTokens: config.tokenBudget,
    mode: "fallback-cached-list",
  };
  const entry = {
    v: AUDIT_FORMAT_VERSION,
    ts: new Date().toISOString(),
    kind: "skillgate-round",
    turn: state.turn ?? null,
    task: { band: scored.band, complex: scored.complex, head: state.taskText.slice(0, 120) },
    config: { autoScore: config.autoScore, hintScore: config.hintScore, tokenBudget: config.tokenBudget, charsPerToken: config.charsPerToken },
    dsActive: Array.isArray(state.dsActive) ? [...state.dsActive] : [],
    scores: scoredByName,
    decision,
    estimateText: renderAdmission(
      { band: scored.band, complex: scored.complex, auto: decision.auto, hint: decision.hint },
      catalog,
      { turn: state.turn ?? 0 }
    ),
  };
  const stamped = audit ? audit.push(entry) : null;
  return { active: true, decision, auditEntry: stamped ?? entry };
}

// ---- 票 07 加法：手动权重文件（assets/gating.weights.json；约束台账 3） ----
// schema = resolveGateConfig 的可配子集（场景加分 sceneMap/complexBoost、阈值
// autoScore/hintScore、软降线 tokenBudget/charsPerToken），缺省值 = 当前硬编码
// （DEFAULT_GATE_CONFIG）。文件缺失 -> status "default"（回退默认，属正常）；
// 存在但 JSON 损坏/版本不符/含未知键/值非法 -> status "fallback"（回退默认并把
// 原因带回给 /lean-audit weights 展示，门控行为不中断）。权重只影响放行集合
// （阈值/场景加分/软降线），不改 invocation（矩阵语义原样）。
const WEIGHTS_URL = new URL("../assets/gating.weights.json", import.meta.url);

/** 权重文件缺省路径（包内 assets/gating.weights.json；可用参数覆盖以便测试）。 */
export function gateWeightsFile() {
  return fileURLToPath(WEIGHTS_URL);
}

/** 读取手动权重并解析为完整门控配置；永远返回可用 config（失败即回退默认）。 */
export async function loadGateWeights(path) {
  const source = typeof path === "string" && path.length > 0 ? path : fileURLToPath(WEIGHTS_URL);
  let text;
  try {
    text = await readFile(source, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { status: "default", error: null, config: resolveGateConfig(), source };
    }
    return { status: "fallback", error: "read failed: " + String(error?.message ?? error), config: resolveGateConfig(), source };
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    return { status: "fallback", error: "invalid JSON: " + String(error?.message ?? error), config: resolveGateConfig(), source };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { status: "fallback", error: "weights must be a JSON object", config: resolveGateConfig(), source };
  }
  if (parsed.version !== undefined && parsed.version !== 1) {
    return { status: "fallback", error: "unsupported weights version: " + String(parsed.version), config: resolveGateConfig(), source };
  }
  const partial = { ...parsed };
  delete partial.version;
  try {
    return { status: "loaded", error: null, config: resolveGateConfig(partial), source };
  } catch (error) {
    return { status: "fallback", error: "invalid weights: " + String(error?.message ?? error), config: resolveGateConfig(), source };
  }
}

/** 测试与集成内用的内部实现出口（不进公开契约文档）。 */
export const internals = { DEFAULT_GATE_CONFIG, ARBITRATION_PREFERS, loadGateWeights, gateWeightsFile };
