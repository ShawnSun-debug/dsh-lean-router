# 技能矩阵（matrix）

> 31 个 mattpocock 技能的 invocation 双开矩阵（模型可调 / 用户可调），数据源 `assets/skills.matrix.json`（主人逐条拍板：6 批 33 题，decided_at 2026-11-20）。英文版：[matrix.en.md](./matrix.en.md)。

## 数据源与读法

- **矩阵**：`assets/skills.matrix.json`——31 行，字段 name / dir / model / user / scenario / scenarioZh / keywords / note。keywords 现为空（`keywords_policy: "先空着，实测后再填"`），填上后门控信号 B（关键词命中）即生效。
- **清单**：`skills.manifest.json`——同 31 行的发布快照（doctor 校验其长度为 31）。
- **invocation 开关不受来源层级影响**（skill-provider.js L85-88）：无论技能来自 `~/.dsh/skills`（tier user）还是 `assets/skills` 副本（tier bundled），model/user 一律按本矩阵。
- 门控只放行 model-invocable 技能进 auto/hint（skillgate.js L187-189）；user-only 技能仍全量可见、走 `/skill` 人工点名。
- 计数：**13 双开 / 10 仅模型 / 8 仅用户**（doctor 第 7 项校验值）。

## 31 技能表（按字母序）

| # | 技能 | 场景 | 调用 | 备注（主人拍板原文） |
|---|---|---|---|---|
| 1 | ask-matt | 元交互·路由 | 仅用户 | 技能路由器与本插件路由层重叠，主人点名才用 |
| 2 | chief-of-staff | 流程·统筹 | 模型+用户 |  |
| 3 | code-review | 工程·评审 | 模型+用户 |  |
| 4 | codebase-design | 工程·设计 | 模型+用户 |  |
| 5 | diagnosing-bugs | 工程·诊断 | 仅模型 | 主人选仅模型 |
| 6 | domain-modeling | 工程·建模 | 仅模型 | 主人选仅模型 |
| 7 | grilling | 元交互·审讯 | 仅用户 | 重交互，主人点名才用 |
| 8 | handoff | 流程·交接 | 模型+用户 |  |
| 9 | implement | 工程·实现 | 模型+用户 |  |
| 10 | improve-codebase-architecture | 工程·体检 | 模型+用户 |  |
| 11 | loop-me | 元交互·工作流 | 仅用户 | 重交互，主人点名才用 |
| 12 | pr | 流程·PR | 模型+用户 |  |
| 13 | prototype | 工程·原型 | 仅用户 | 主人选仅手动 |
| 14 | research | 调研·取证 | 模型+用户 |  |
| 15 | retro | 流程·复盘 | 仅用户 | 主人选仅手动 |
| 16 | setup-matt-pocock-skills | 配置·初始化 | 仅模型 | 主人理由：会话开始即在，仅模型 |
| 17 | setup-ts-deep-modules | 工程·配置 | 仅模型 | 主人选仅模型 |
| 18 | software-factory | 流程·工厂 | 仅模型 | 主人选仅模型 |
| 19 | tdd | 工程·测试 | 仅模型 | 主人选仅模型 |
| 20 | teach | 教学 | 仅用户 | 主人选仅手动 |
| 21 | to-questionnaire | 流程·问卷 | 仅模型 | 主人选仅模型 |
| 22 | to-spec | 流程·定稿 | 模型+用户 |  |
| 23 | to-tickets | 流程·拆票 | 模型+用户 |  |
| 24 | triage | 流程·分诊 | 模型+用户 |  |
| 25 | wait-what | 元交互·打断 | 仅用户 | 主人选仅手动 |
| 26 | wayfinder | 流程·大规划 | 模型+用户 |  |
| 27 | wizard | 流程·向导 | 仅用户 | 主人选仅手动 |
| 28 | writing-beats | 写作·成稿 | 模型+用户 |  |
| 29 | writing-for-agents | 写作·技能文档 | 仅模型 | 主人选仅模型 |
| 30 | writing-fragments | 写作·碎片 | 仅模型 | 主人选仅模型 |
| 31 | writing-shape | 写作·打磨 | 仅模型 |  |

## 场景（scenario）词汇

engineering（工程）/ process（流程）/ research（研究）/ meta（元交互·路由）/ setup（初始化）/ teaching（教学）/ writing（写作）。门控信号 A 按 `sceneMap` 给不同场景加分（见 [configuration.md](./configuration.md)）。

## 与 provider/门控的关系

- `lib/skill-provider.js` 以矩阵为唯一 invocation 真源（`model: row.model !== false`），rank 350 语义不变。
- `lib/skillgate.js` 每轮对这 31 行全量打分（31 个全打，主人定案）；未进放行集合的 model 技能仍留在 `list()` 全量里，门控只影响近场通道。
- 本表 31 个目录即 `assets/skills/` 下的内置副本（doctor 第 6 项校验目录数 = 31）。
