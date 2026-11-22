// dsh-lean-router - cordis 插件入口（骨架，票 02）
// 票 04/05/06 将在此追加：executor 遮蔽、路由钩子（inbox/pre-step）、技能评分门控、审计。
import { makeProvider } from "./skill-provider.js";
import { getAuditChannel } from "./skillgate.js";

export const name = "skill-lean-router";
export const inject = ["skills"];

export function apply(ctx, options) {
  const cfg = options ?? {};
  const rank = typeof cfg.rank === "number" ? cfg.rank : 350;
  // master 集成（票 07 §9.2）：provider 挂共享审计通道（skillgate 决策流单例）。
  ctx.skills.registerProvider(() => makeProvider({ rank, audit: getAuditChannel() }));
}
