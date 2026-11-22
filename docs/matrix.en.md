# Skill matrix

> The model/user invocation matrix for the 31 mattpocock skills; source of truth is `assets/skills.matrix.json` (decided by the owner item by item: 6 batches, 33 questions, decided_at 2026-11-20). Chinese original: [matrix.md](./matrix.md).

## Sources and how to read it

- **Matrix**: assets/skills.matrix.json — 31 rows with name / dir / model / user / scenario / scenarioZh / keywords / note. keywords are empty for now (`keywords_policy: "先空着，实测后再填"` = "left empty, filled after measurement"); once filled, gate signal B (keyword hits) activates.
- **Manifest**: skills.manifest.json — the shipping snapshot of the same 31 rows (doctor checks its length is 31).
- **Invocation flags are independent of the source tier** (skill-provider.js L85-88): whether a skill comes from ~/.dsh/skills (tier user) or the assets/skills copies (tier bundled), model/user always follow this matrix.
- The gate only admits model-invocable skills into auto/hint (skillgate.js L187-189); user-only skills remain fully visible and are invoked manually via /skill.
- Counts: **13 both / 10 model-only / 8 user-only** (the value checked by doctor's 7th item).

## The 31 skills (alphabetical)

| # | Skill | Scenario | Invocation | Note (owner's wording) |
|---|---|---|---|---|
| 1 | ask-matt | meta | user-only | 技能路由器与本插件路由层重叠，主人点名才用 |
| 2 | chief-of-staff | process | model+user |  |
| 3 | code-review | engineering | model+user |  |
| 4 | codebase-design | engineering | model+user |  |
| 5 | diagnosing-bugs | engineering | model-only | 主人选仅模型 |
| 6 | domain-modeling | engineering | model-only | 主人选仅模型 |
| 7 | grilling | meta | user-only | 重交互，主人点名才用 |
| 8 | handoff | process | model+user |  |
| 9 | implement | engineering | model+user |  |
| 10 | improve-codebase-architecture | engineering | model+user |  |
| 11 | loop-me | meta | user-only | 重交互，主人点名才用 |
| 12 | pr | process | model+user |  |
| 13 | prototype | engineering | user-only | 主人选仅手动 |
| 14 | research | research | model+user |  |
| 15 | retro | process | user-only | 主人选仅手动 |
| 16 | setup-matt-pocock-skills | setup | model-only | 主人理由：会话开始即在，仅模型 |
| 17 | setup-ts-deep-modules | engineering | model-only | 主人选仅模型 |
| 18 | software-factory | process | model-only | 主人选仅模型 |
| 19 | tdd | engineering | model-only | 主人选仅模型 |
| 20 | teach | teaching | user-only | 主人选仅手动 |
| 21 | to-questionnaire | process | model-only | 主人选仅模型 |
| 22 | to-spec | process | model+user |  |
| 23 | to-tickets | process | model+user |  |
| 24 | triage | process | model+user |  |
| 25 | wait-what | meta | user-only | 主人选仅手动 |
| 26 | wayfinder | process | model+user |  |
| 27 | wizard | process | user-only | 主人选仅手动 |
| 28 | writing-beats | writing | model+user |  |
| 29 | writing-for-agents | writing | model-only | 主人选仅模型 |
| 30 | writing-fragments | writing | model-only | 主人选仅模型 |
| 31 | writing-shape | writing | model-only |  |

## Scenario vocabulary

engineering / process / research / meta / setup / teaching / writing. Gate signal A awards points per scenario via sceneMap (see [configuration.en.md](./configuration.en.md)).

## Relation to the provider and the gate

- lib/skill-provider.js treats the matrix as the single source of truth for invocation (`model: row.model !== false`), with the rank-350 semantics unchanged.
- lib/skillgate.js scores all 31 rows every turn (all 31 scored, owner's decision); model skills outside the admitted set stay in list()'s full catalog — gating only affects the near-field channel.
- The 31 directories of this table are exactly the bundled copies under assets/skills/ (doctor's 6th check counts 31).
