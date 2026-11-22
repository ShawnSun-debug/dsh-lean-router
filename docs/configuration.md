# 配置参考（configuration）

> 三块：**门控权重**、**审计**、**命令与环境变量**。所有配置经 patch 行 config 传入，未知键一律报错（失败尽早）。英文版：[configuration.en.md](./configuration.en.md)。

## 门控权重（lib/skillgate.js）

默认门控配置在 `DEFAULT_GATE_CONFIG`（skillgate.js L43-59），经 `resolveGateConfig` 校验（L64-98，未知键抛错）：

| 键 | 默认 | 说明 |
|---|---|---|
| autoScore | 2 | score ≥ autoScore → auto（近场自动挂载） |
| hintScore | 1 | hintScore ≤ score < autoScore → hint（近场提示）；约束 autoScore ≥ hintScore |
| tokenBudget | 8000 | 注入估算 token 软上限，超了把低分 auto 降 hint（个数不设上限） |
| charsPerToken | 4 | token 估算分母（约 4 字符/token） |
| maxTaskTextChars | 4000 | 参与打分的任务文本截断长度 |
| sceneMap | react: engineering+2/process+1；spec: engineering+2/research+1；weak: {} | 信号 A：路由带 → 场景加分 |
| complexBoost | engineering: 1 | isComplexTask 时叠加 |
| arbitration | engineering prefer ds；process prefer mattpocock | ds-* 场景裁决表 |

打分公式：`score = scenePoints + complexBoost + 命中关键词个数`（每个命中关键词 +1，按个数不按出现次数，skillgate.js L124-153）。

裁决只降档不改 invocation：ds-* 技能活跃时，`prefer: "ds"` 场景里的 mattpocock 技能 auto→hint（L161-178）。

软降级：`degrade` 按得分升序（同分按名字序，确定性）把 auto 降为 hint，直到估算 ≤ tokenBudget（L203-222）。**8k 软降级是 v1 现状**。

门控配置传入路径：`makeProvider({ gateConfig })`（skill-provider.js L138）——patch 行 `skill-lean-router` 的 options 即 `lib/index.js apply(ctx, options)` 的 options（目前仅 `rank`；gateConfig 全键可配，改动走 patch 行 config）。

## 审计（audit 路径）

- 格式版本：每条审计带 `v: 1`（`AUDIT_FORMAT_VERSION`，skillgate.js L26；格式变更必须升版本）。
- 通道：`createAuditChannel({ capacity })`——内存环形缓冲（默认 256 条）+ `push/entries/drain/subscribe`（L250-279）。**不落盘**。
- 注入：`makeProvider({ audit })`（skill-provider.js L117 注释：审计通道经 makeProvider 注入，票 07 消费）。
- 条目内容（`round()`，L313-328）：`v / ts / kind:"skillgate-round" / turn / task{band,complex,head} / config{autoScore,hintScore,tokenBudget,charsPerToken} / dsActive / scores(31 全量得分+信号) / decision(放行集合+裁决+降级+estTokens) / estimateText`；decision.mode 恒为 `"fallback-cached-list"`（L311）。
- **audit 面板（票 07）进行中**：审计流 JSONL 落盘（skillgate 决策流接 sink）与 `ui/go.json` 面板卡片（决策行 + 全量得分表折叠 + token 对比 + 黄条）属于票 07 的在飞工作，v1 文档不作承诺。

## 命令与环境变量

### npm scripts（package.json）

| 命令 | 作用 |
|---|---|
| npm test | node --test test/（20 个测试文件） |
| npm run build | 重拼 cordis.patch.yml（base + 4 分片固定顺序） |
| npm run drift | assets/skills 副本与 ~/.dsh/skills 漂移检查（warn-only） |
| npm run doctor | 7 项结构自检（见下） |
| npm run verify | build --check（cordis.patch.yml 反向逐字节一致）+ doctor |

doctor 7 项：package.name、package.engines.dsh、cordis.patch.yml 存在、patch 含预设行、manifest 31 技能、assets/skills 目录数 31、矩阵计数 13/10/8（scripts/doctor.mjs L12-24）。

### 会话命令

| 命令 | 层 | 说明 |
|---|---|---|
| /band | router | 查看/切换路由带；`/band spec`、`/band auto`、`/band react task <一行>` |
| /skill | router | 列出技能与 [model/user] 开关；`/skill <name>` 看详情（provider/source/资源目录） |
| /compact | lean | 手动触发上下文压缩 |

### 首条用户消息指令

~~~text
[router] band=spec|react|weak|auto [task=<一行>]
~~~

显式指令优先于关键词分类（人在回路）；`auto` 清除覆盖回退自动。

### 环境变量

| 变量 | 作用 |
|---|---|
| DSH_DELIVERY_GATE=0 | 强制关交付门 |
| DSH_DELIVERY_GATE=1 | config.enabled 缺省时强制开 |
| DSH_LEAN_ROUTER_CONCURRENCY=0 | 关并发标记（兼容 DSH_FLASH_PRESETS_CONCURRENCY=0） |

## 插件行 config 一览（patch 行 → 模块）

| patch 行 id | name | config 键 | 默认 |
|---|---|---|---|
| lean-router-router | dsh-lean-router/router | diligenceEvery / hooks / commands / guideOrder / skipInherited | 10 / true / false / 220 / true（router.js L134-147） |
| lean-router-commands | dsh-lean-router/router | 同上 | 10 / false / true / 220 / true |
| lean-delivery-gate | dsh-lean-router/lean/delivery-gate | enabled / scripts / maxRounds / timeoutMs / tailChars | false / [verify.ps1,verify.sh] / 2 / 900000 / 1200（delivery-gate.js L191） |
| lean-concurrency | dsh-lean-router/lean/tool-concurrency | toolConcurrency{enabled, tools, sweepMs} | true / [glob,grep] / 500 |
| toolface | dsh-lean-router/toolface | hiddenPrefixes / metaTools / runToolName / guard / sdkSection / debug / searchLimit / maxDescriptionChars / maxParallelSubCalls / nativeScope / nativeTools / hiddenTools | ['mcp__'] / 四 meta / code_run / true / true / true / 8 / 240 / 10 / true / [] / []（frag-preset.patch.yml L236-263 显式全列） |

工具面 config 校验：normalizeConfig（rules.js L88-125，metaTools 少于 2 个整表回落默认）。

## exports 子路径（package.json）

`.` / `./package.json` / `./router` / `./toolface` / `./lean/delivery-gate` / `./lean/tool-concurrency`——四个功能子路径分别对应 router 两实例与两个加料件插件行的 `name` 字段（`dsh-lean-router/router` 等）。
