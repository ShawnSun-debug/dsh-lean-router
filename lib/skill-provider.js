// dsh-lean-router - skill provider（票 06 升级；票 02 骨架向后兼容）
// 两级来源：同名技能优先读 ~/.dsh/skills（tier "user"），缺失时用 assets/skills
// 副本兜底（tier "bundled"）；invocation 一律按 assets/skills.matrix.json
// （model/user 开关是主人拍板，不受来源层级影响）；rank 350 语义不变。
// frontmatter 自解析，不依赖宿主扫描（宿主已知坑：只扫一层、冒号丢行）。
//
// 门控（票 06）：本 provider 的 list() 默认返回全量 31 技能（门控关闭 =
// 无路由状态 = 一切不变，满足票 02 scaffold 断言）；门控只在调用方显式传入
// list({ leanGate: state }) 参数时生效（约束：门控经显式状态/参数生效）。
// 宿主实测结论：SkillRegistry.collect() 缓存 per (cwd, scopeChain, revision)
// （dsh-skill/lib/index.js L265-297），provider.list() 仅缓存未命中时调用
// （同文件 L350）—— 因此"每轮门控"走 lib/skillgate.js 的 round() 近场通道，
// 不依赖 list() 的重新调用；审计标注 mode "fallback-cached-list"。

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { isGateActive, round as gateRound, resolveGateConfig } from "./skillgate.js";

export const PROVIDER_NAME = "lean-router";
export const DEFAULT_RANK = 350; // 压过 ~/.dsh/skills(400)，让本包接管同名技能的 invocation 开关
const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SKILLS_DIR = join(ROOT, "assets", "skills");

/** 一级来源目录（同名技能优先；可被 makeProvider({ userSkillsDir }) 覆盖以便测试）。 */
export function defaultUserSkillsDir() {
  return join(homedir(), ".dsh", "skills");
}

function parseFrontmatter(text) {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  if (!match) return {};
  const fields = {};
  for (const raw of match[1].split(/\r?\n/)) {
    const at = raw.indexOf(":");
    if (at <= 0) continue;
    const key = raw.slice(0, at).trim();
    if (key) fields[key] = raw.slice(at + 1).trim().replace(/^["']/, "").replace(/["']$/, "");
  }
  return fields;
}

/** 剥 frontmatter 取正文（自解析；正文保持原样）。 */
function stripFrontmatter(text) {
  return text.replace(/^\uFEFF?---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

let catalogPromise;
/**
 * 加载 31 技能目录（两级来源解析 + 矩阵 invocation）。带进程内缓存；
 * 传 userSkillsDir 覆盖时按 key 缓存，测试互不串扰。
 * 行形状：{ name, description, dir, model, user, scenario, keywords, tier, path }。
 */
async function loadCatalog(userSkillsDir) {
  const key = userSkillsDir ?? "";
  if (!catalogPromise) catalogPromise = new Map();
  if (catalogPromise.has(key)) return catalogPromise.get(key);
  const promise = (async () => {
    let matrix = { skills: [] };
    try { matrix = JSON.parse(await readFile(join(ROOT, "assets", "skills.matrix.json"), "utf8")); } catch {}
    const byDir = new Map(matrix.skills.map(s => [s.dir, s]));
    const userRoot = userSkillsDir ?? defaultUserSkillsDir();
    const entries = await readdir(SKILLS_DIR, { withFileTypes: true });
    const catalog = new Map();
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const row = byDir.get(entry.name) ?? {};
      // 两级来源：一级 = ~/.dsh/skills 同名技能；缺失/不可读时回退 assets 副本。
      let body;
      let tier = "bundled";
      let path = join(SKILLS_DIR, entry.name, "SKILL.md");
      try {
        body = await readFile(join(userRoot, entry.name, "SKILL.md"), "utf8");
        tier = "user";
        path = join(userRoot, entry.name, "SKILL.md");
      } catch {
        try { body = await readFile(path, "utf8"); } catch { continue; }
      }
      const f = parseFrontmatter(body);
      catalog.set(entry.name, {
        name: f.name || entry.name,
        description: f.description || "",
        dir: entry.name,
        // invocation 一律按矩阵（model/user 开关）；frontmatter 不参与 invocation。
        model: row.model !== false,
        user: row.user !== false,
        scenario: row.scenario ?? "process",
        keywords: Array.isArray(row.keywords) ? row.keywords : [],
        tier,
        path,
      });
    }
    return catalog;
  })();
  catalogPromise.set(key, promise);
  promise.catch(() => catalogPromise.delete(key));
  return promise;
}

function toCandidate(s, rank) {
  return {
    name: s.name,
    description: s.description,
    invocation: { modelInvocable: s.model, userInvocable: s.user },
    provider: PROVIDER_NAME,
    source: s.tier === "user" ? "user" : "bundled",
    resourceBase: { kind: "directory", path: join(s.path, "..") },
    rank,
    locator: new URL("../assets/skills/" + s.dir + "/SKILL.md", import.meta.url),
  };
}

/**
 * 门控显式生效路径：list({ leanGate: state }) 时用 skillgate.round() 出
 * 放行集合（auto+hint，仅 model-invocable），过滤全量候选；invocation 与
 * rank 原样保留。审计通道经 makeProvider({ audit }) 注入（票 07 消费）。
 */
function applyLeanGate(candidates, gateState, catalogRows, gateConfig, audit, rank) {
  const outcome = gateRound(gateState, catalogRows, gateConfig, audit);
  if (!outcome.active) return candidates;
  const admitted = new Set([...outcome.decision.auto, ...outcome.decision.hint]);
  const rows = catalogRows instanceof Map ? [...catalogRows.values()] : catalogRows;
  const byName = new Map(rows.map((row) => [row.name, row]));
  return candidates.filter((candidate) => {
    const row = byName.get(candidate.name);
    if (!row) return false;
    // gate 出口仍按 invocation 过滤（模型通道）；非 model 技能从不进放行集合。
    return admitted.has(candidate.name) && candidate.invocation.modelInvocable === true;
  });
}

export function makeProvider(options) {
  const opts = options ?? {};
  const rank = typeof opts.rank === "number" ? opts.rank : DEFAULT_RANK;
  const userSkillsDir = typeof opts.userSkillsDir === "string" ? opts.userSkillsDir : undefined;
  const audit = opts.audit ?? null;
  const gateConfig = resolveGateConfig(opts.gateConfig);
  return {
    name: PROVIDER_NAME,
    async list(listOptions) {
      const catalog = await loadCatalog(userSkillsDir);
      const candidates = [...catalog.values()].map(s => toCandidate(s, rank));
      const gateState = (listOptions ?? {}).leanGate;
      if (gateState === undefined) return candidates;
      return applyLeanGate(candidates, gateState, catalog, gateConfig, audit, rank);
    },
    async get(candidate) {
      const catalog = await loadCatalog(userSkillsDir);
      const skill = [...catalog.values()].find(e => e.name === candidate.name);
      if (!skill) throw new Error("unknown lean-router skill: " + candidate.name);
      const body = await readFile(skill.path, "utf8");
      return {
        name: skill.name,
        description: skill.description,
        invocation: { modelInvocable: skill.model, userInvocable: skill.user },
        provider: PROVIDER_NAME,
        source: skill.tier === "user" ? "user" : "bundled",
        resourceBase: { kind: "directory", path: join(skill.path, "..") },
        content: stripFrontmatter(body),
      };
    },
  };
}

/** 测试与集成内用的内部实现出口（不进公开契约文档）。 */
export const internals = { loadCatalog, parseFrontmatter, isGateActive, defaultUserSkillsDir };
