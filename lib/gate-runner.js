// dsh-lean-router - pre-step 每轮门控 runner（票 09）
//
// 结论先行（宿主 0.2.2-rc.5 实读）：近场 dynamic context 的 text 函数是同步求值
// （@deepseek-ai/dsh-system-prompt lib/index.js L186-192：resolveContext 直接调用
// entry.text(context)，返回值即文本），round() 的两个异步输入（权重热读、dsActive
// 观察）无法在求值内 await —— 本模块按两段结构接线（docs/面板-设计说明.md §9.3）：
//   capture（agent/inbox/claimed，每轮真实用户消息）：taskText = 当轮用户消息，
//     并异步 refresh（loadGateWeights 热读 + ctx.skills.list 观察 dsActive）；
//   hintFor（pre-step 文本求值，同步）：skillgate.round(state, catalog, config, audit)
//     出决策，hint 追加进近场引导文本，决策经共享审计通道 getAuditChannel() 发出
//     （commands 行实例 audit:true 已挂 sink 落盘 JSONL —— 双实例共享模块级单例）。
//
// 零副作用锚点（约束台账 3/6）：
// - gate 关闭 / 无 band 状态（含 band=auto 未路由）/ 无当轮用户消息 / 目录或权重
//   未就绪 -> hint ""：近场文本与现状逐字符一致，round() 不执行、不发审计、不落盘。
// - 同一决策重复求值（同轮多步）幂等：文本恒定（宿主 deepEqualJson 零写入），
//   审计去重 = 同一 (turn, taskText, dsActive, band, auto, hint, weightsStatus)
//   只发一条；决策变化或新轮才发新条目。
// - 近场 hint = renderAdmission 输出去掉头部轮次号（同决策同带跨轮零写入、缓存
//   友好，沿用 t5 的 dynamic context 通道语义）；轮次记在审计条目 entry.turn。
//
// dsActive 观察（约束台账 2）：对 ctx.skills.list()（宿主 SkillRegistry 的权威合并
// 目录快照，含 bundled/runtime/user/project 全部来源）做 ds-* 前缀枚举。依据（实测）：
// ~/.dsh/skills 只有 mattpocock 31 技能与共享素材、无 ds-* 目录；ds-* 技能位于
// ~/.dsh/profiles/desktop/node_modules/dsh-engineer-mode/assets/skills 并经
// registerProvider 进 registry —— 只看宿主技能目录存在性必漏判，registry 快照才与
// 模型实际可见技能一致；skillgate.arbitrate 的 active 判据同为 startsWith("ds-")。

import {
  getAuditChannel,
  loadGateWeights,
  renderAdmission,
  resolveGateConfig,
  round as gateRound,
} from "./skillgate.js";
import { internals as providerInternals } from "./skill-provider.js";

/**
 * 创建每轮门控 runner（router 在 hooks 分支持有；测试可注入 audit/skills）。
 * options: { weightsPath?, skills?, audit? }
 * 返回 { capture, hintFor, snapshot }：
 * - capture(agent, taskText, turn)  每轮捕获（router 只对 user 消息调用），返回 refresh promise。
 * - hintFor(agent, band)            同步近场 hint（每次 pre-step 文本求值调用）；"" = 不追加。
 * - snapshot(agent)                 观测当前门控状态（测试/诊断用）。
 */
export function createGateRunner(options) {
  const opts = options ?? {};
  const weightsPath =
    typeof opts.weightsPath === "string" && opts.weightsPath.length > 0 ? opts.weightsPath : undefined;
  const skills = opts.skills && typeof opts.skills.list === "function" ? opts.skills : null;
  const audit = opts.audit ?? getAuditChannel();
  /** agent -> { taskText, turn, config, weightsStatus, weightsError, weightsSource, dsActive, lastAuditKey } */
  const states = new WeakMap();
  /** 已就绪的技能目录（Map）；null = 尚未就绪（约束台账 1：31 目录逐文件读只在首载做一次）。 */
  let catalogCache = null;
  let catalogPromise = null;

  // 31 技能目录逐文件读只在首载做一次：skill-provider.loadCatalog 进程内按 key 缓存，
  // 这里持有同一 promise；成功后常驻 catalogCache，失败静默（下一轮重试，
  // loadCatalog 自身会在失败时清缓存重载）。capture 会 await 它：测试与首个求值
  // 之前目录必已就绪；生产里 text 求值早于捕获落地时 hintFor 自己再调 ensureCatalog。
  function ensureCatalog() {
    if (catalogCache !== null) return Promise.resolve();
    if (catalogPromise === null) {
      catalogPromise = providerInternals.loadCatalog().then(
        (catalog) => {
          catalogCache = catalog;
        },
        () => {
          catalogPromise = null; // 失败：清句柄，下一轮 capture/hintFor 重试
        }
      );
    }
    return catalogPromise;
  }

  /**
   * dsActive 观察（约束台账 2）：ctx.skills.list() 快照 -> ds-* 前缀枚举（去重排序）。
   * 观察失败返回 []（不破坏门控管线，与审计错误策略同原则）。
   */
  async function observeDsActive(agent) {
    if (skills === null) return [];
    try {
      const summaries = await skills.list({ scope: agent });
      const names = (Array.isArray(summaries) ? summaries : [])
        .map((s) => (s && typeof s.name === "string" ? s.name : ""))
        .filter((name) => name.startsWith("ds-"));
      return [...new Set(names)].sort();
    } catch {
      return [];
    }
  }

  /** 权重热读 + dsActive 观察；loadGateWeights 每次调用都读文件 -> 改文件下一轮生效。 */
  async function refresh(agent) {
    const st = states.get(agent);
    if (!st) return null;
    const [weights, dsActive] = await Promise.all([loadGateWeights(weightsPath), observeDsActive(agent)]);
    st.config = weights.config;
    st.weightsStatus = weights.status;
    st.weightsError = weights.error;
    st.weightsSource = weights.source;
    st.dsActive = dsActive;
    return snapshotOf(st);
  }

  function snapshotOf(st) {
    return {
      taskText: st.taskText,
      turn: st.turn ?? 0,
      dsActive: [...(st.dsActive ?? [])],
      weightsStatus: st.weightsStatus ?? null,
      weightsError: st.weightsError ?? null,
      weightsSource: st.weightsSource ?? null,
    };
  }

  /**
   * 每轮捕获：taskText 取当轮用户消息（router 已过滤 kind === user 与 skipInherited），
   * 立即异步热读权重 + 观察 dsActive；求值先于 refresh 落地时用默认权重（下一轮覆盖）。
   */
  function capture(agent, taskText, turn) {
    const st = states.get(agent) ?? { dsActive: [], lastAuditKey: null };
    st.taskText = typeof taskText === "string" ? taskText : "";
    st.turn = Number.isSafeInteger(turn) ? turn : st.turn ?? 0;
    st.config = st.config ?? resolveGateConfig();
    st.weightsStatus = st.weightsStatus ?? "default";
    states.set(agent, st);
    return Promise.all([refresh(agent), ensureCatalog()]);
  }

  /**
   * 近场 hint（同步；每次 pre-step 文本求值调用一次 round）：
   * state = { taskText: 当轮用户消息, dsActive, turn }（设计说明 §9.3 规格）。
   * 返回 "" = 不追加（零副作用锚点见模块头注释）。
   */
  function hintFor(agent, band) {
    if (!band) return ""; // 无 band 状态 / band=auto 未路由：门控休眠
    const st = states.get(agent);
    if (!st || typeof st.taskText !== "string" || st.taskText.length === 0) return ""; // 尚无当轮用户消息
    if (!st.config) return ""; // 权重未就绪（首个求值早于 refresh 落地）
    ensureCatalog();
    if (catalogCache === null) return ""; // 目录未就绪：本轮不追加、不发审计
    const state = { taskText: st.taskText, dsActive: [...(st.dsActive ?? [])], turn: st.turn ?? 0 };
    const auditProxy = {
      // 审计去重：同轮同决策只发一条（决策变化/新轮才发新条目）。
      push(entry) {
        const key = JSON.stringify([
          state.turn,
          state.taskText,
          state.dsActive,
          entry && entry.task ? entry.task.band : null,
          entry && entry.decision ? entry.decision.auto : null,
          entry && entry.decision ? entry.decision.hint : null,
          st.weightsStatus ?? null,
        ]);
        if (key === st.lastAuditKey) return null;
        st.lastAuditKey = key;
        return audit.push(entry);
      },
    };
    const outcome = gateRound(state, catalogCache, st.config, auditProxy);
    if (!outcome.active || !outcome.decision) return "";
    // 近场 hint = renderAdmission 输出去掉头部轮次号（同决策同带跨轮零写入；轮次在审计 entry.turn）。
    return renderAdmission(outcome.decision, catalogCache, { turn: 0 }).replace(
      "Skill gate (turn 0, ",
      "Skill gate ("
    );
  }

  return {
    capture,
    hintFor,
    snapshot(agent) {
      const st = states.get(agent);
      return st ? snapshotOf(st) : null;
    },
  };
}
