# 架构总览（architecture）

> 六层一图：**lean → toolface → router → skillgate → audit → panel**，全部收敛在一张 cordis 插件卡（一个预设 + 少量顶层行）。中文为主，英文版是 [architecture.en.md](./architecture.en.md)。

## 六层图

~~~text
┌─────────────────────────────────────────────────────────────────────┐
│                        DSH 宿主（engines >=0.2.1-rc.5 <0.2.3-0）      │
├─────────────────────────────────────────────────────────────────────┤
│ 预设 preset-lean-router（frag-preset.patch.yml 并集快照 = 唯一生效行） │
│                                                                     │
│  ① lean 层（票 03）     compaction 组 + delegation 组 + persona      │
│     - 机制1 轮次压缩      thresholdRatio 0.25 / retainTokens 20000    │
│     - 机制2 输出裁剪      8192/4096/1024（host 执行）                 │
│     - 机制3 关 6 插件     delegation 组 + 顶层 tool-plugin-manager    │
│     - 机制4 行为纪律      lean 13 条 + 3 软门 + 自检钩 / balance 3 条  │
│     - 加料 交付门         lean-delivery-gate（enabled:false, 2 轮）    │
│     - 加料 并发标记       lean-concurrency（glob/grep isConcurrencySafe）│
│  ② toolface 层（票 04）  dsh-lean-router/toolface                    │
│     - 遮蔽 ['mcp__'] + 预设外全部；code_run 传输；meta 4 工具          │
│     - executor：describe() 掩蔽 + execute() 拒绝直呼                  │
│  ③ router 层（票 05）    两实例 lean-router-router / lean-router-commands │
│     - 首轮捕获 [router] band=…；三带近场引导；/band /skill            │
│  ④ skillgate 层（票 06） skill-lean-router provider + 每轮门控        │
│     - 31 技能全量打分 → 分档 → ds-* 裁决 → 8k 软降 → 近场渲染         │
│  ⑤ audit（票 07 在飞）   内存环形缓冲（256 条）+ 订阅通道             │
│  ⑥ panel（票 07 在飞）   ui/go.json 面板卡片（进行中，未验收）         │
└─────────────────────────────────────────────────────────────────────┘
~~~

### ① lean 层（lib/lean/，参数 + 纯函数端口；执行归宿主插件）

- **机制 1 轮次压缩**：`lib/lean/compaction.js` L20-25 给出口径 `thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1, auto: true`（照抄 flash 实测）；真实压缩由宿主 `@deepseek-ai/dsh-compaction-basic` 执行。host 默认是 0.8（1M 窗口 = 800k 才触发），lean 取 0.25 = 250k 触发；2026-11-09 实测 109 个运行峰值中位 20k、最大 126k——这颗旋钮目前是安全网而非降本手段（cordis.patch.yml L197-200 注释原文，frag-lean.patch.yml L147-150 同文）。
- **机制 2 工具输出裁剪**：`lib/lean/pruner.js` L22-26 口径 `thresholdChars: 8192, headChars: 4096, tailChars: 1024`；保留头（结构）+ 尾（结论），中段替换为固定 marker（`PRUNE_MARKER`，L19）。执行归宿主 `dsh-compaction-tool-result-pruner`；`pruneText()` 是同判据纯函数端口。
- **机制 3 关 6 插件**：`lib/lean/disabled.js` L16-23 清单 = `tool-subagent-codex`、`tool-subagent-claude-code`、`workflow-ptc`、`tool-workflow`、`tool-ralph`、`tool-plugin-manager`；`disabled: true` 行不加载，工具 schema 不进系统提示。
- **机制 4 行为纪律**：`lib/lean/persona-text.js`——lean 档 13 条硬规则 + 3 软门（CLARIFY→PLAN→DELIVER）+ 自检钩（勤勉 ~每 10 轮 / 合上书）；balance 档 3 条。规则 7 删去 flash 的 "run_code is the only tool"（本包是 native+code_run 面），其余逐条照抄。
- **plan-mode v1**：`lib/lean/plan-mode.js` 逐行照抄 flash（L93-107）；末段 PTC `run_code` 句**保留 flash 原文**（本包裁定，见 changelog）。
- **加料 · 交付门**：`lib/lean/delivery-gate.js`——工作区有 verify.ps1/verify.sh 时回合收尾自动验收；失败把尾部输出 steer 回灌，同会话最多 `maxRounds`（默认 2）次；两次最小间隔 `MIN_GAP_MS = 15000`（L55）；默认关（`enabled: false`，`DSH_DELIVERY_GATE=0/1` 环境变量可强控）；缺宿主 `dsh-llm` 包时脚本照跑、回灌显式跳过。
- **加料 · 并发标记**：`lib/lean/tool-concurrency.js`——给 glob/grep 的已注册定义补 `isConcurrencySafe = () => true`，让原生多调用真正并行；500ms 快扫（前 60s）→ 5s 兜底；`DSH_LEAN_ROUTER_CONCURRENCY=0`（兼容 `DSH_FLASH_PRESETS_CONCURRENCY=0`）关闭。

### ② toolface 层（lib/toolface/，vendored codemode 0.3.0 @ f9758ec）

四个职责（lib/toolface/index.js L17-27）：注册发现工具、注册 `code_run` 传输、安装遮蔽 executor、供应 Code Mode 说明段。

- **遮蔽规则**：`rules.js` L16 `DEFAULT_HIDDEN_PREFIXES = ['mcp__']`；L19 四个 meta 工具 `code_tools_list / code_tools_search / code_tools_describe / code_debug`；L45 `DEFAULT_RUN_TOOL_NAME = 'code_run'`（`run_code` 是 DSH 保留名，注册表拒绝注册）；L69 `maxParallelSubCalls: 10`。另有 scope 规则（`nativeScope: true`）：预设 scope 之外（全局层 MCP/bundle、agent 层工具集）一律遮蔽。
- **三视图归因**：`scope.js` L87-113 用注册表公开的 `get(name, scope)` 解析 global/preset/agent 三个名字集合，判定「这个工具是不是本预设的」；无 scope 标签时归因惰性、只按名规则遮蔽。
- **executor 接缝**：`executor.js` L124-188——`describe()` 先按 `isMaskedName` 过滤再交给原生 executor（模型请求面 = 预设组合 + 传输工具）；`execute()` 对模型直呼被遮蔽名**派发前**拒绝并提示 `code_tools_search`（L226-228）；`code_run` 本身永远放行（L222）。程序子调用经 signal 上的 `Symbol.for('dsh-codemode.nested')` 标记 + `:ptc:` 调用号双保险放行（L92-97）。
- **传输**：`transport.js`——`code_run` 工具把 TypeScript 程序交给 `ptcRuntime` 服务执行；子调用经注册表公开 `execute()` 走完整管线（校验/策略/审批），并发由 `pool.js` 有序池（parallel 上限 10，exclusive 障碍）复现；程序结束 `abandon()+drain()` 防迟到子调用（L317-323）。
- **retention**：`retention.js`——retained REPL 环境按 (agent, provider) 记账，双清理层（agent-scope effect + 插件卸载 dispose）让泄漏不可表达。
- **缺依赖 stub**：见 [quickstart.md](./quickstart.md)「stub 引导行为」。

### ③ router 层（lib/router.js + lib/bands.js）

- **三带**：`bands.js` L10 `BAND_IDS = ["spec","react","weak"]`。spec=inspect-and-plan（读向窄面）、react=hands-on-production（写向宽面）、weak=model-routed（唯一内路由窗口，few-shot 分类指令）。思想移植 routing-suite 实测（V4.1 Flash：neutral + classify few-shot + 三锚 = 路由 96%、单任务 100%），**实现重写、未搬其代码**。
- **显式指令**：`bands.js` L114-124 解析 `[router] band=<spec|react|weak|auto> [task=…]`；`auto` 清除覆盖回退自动。
- **首轮捕获**：`router.js` L234 只认 `agent/inbox/claimed` 且 `message.source.kind === 'user'`；已路由后保持路径承诺（关键词不改带）。
- **近场引导**：`router.js` L237-245 注册 dynamic context `lean-router:guide`（order 220）；同一带内文本恒定 → 宿主判等零写 → 不污染缓存。不走 pre-step append（那会 durable 写历史）。
- **勤勉自检**：`diligenceEvery` 默认 10（L36）；轮次号入文，非整除轮文本不变。
- **命令**：`/band`、`/skill`（L249-260）；预设内两实例分流：`lean-router-router`（hooks:true, commands:false, diligenceEvery:10）+ `lean-router-commands`（hooks:false, commands:true）（frag-router.patch.yml）。
- **继承会话**：`skipInherited` 默认 true——子代理/fork 继承历史则跳过路由。

### ④ skillgate 层（lib/skillgate.js + lib/skill-provider.js）

- **provider**：`skill-provider.js` L22 `DEFAULT_RANK = 350`（压过 ~/.dsh/skills 的 400，接管同名技能 invocation 开关）。两级来源：同名技能优先 `~/.dsh/skills`（tier user），缺失回 `assets/skills` 副本（tier bundled）；invocation 一律按 `assets/skills.matrix.json`（model/user 主人拍板）。
- **门控关闭 = 一切不变**：`list()` 默认返回全量 31 技能；门控只在调用方显式传 `list({ leanGate: state })` 时生效（L141-147）。
- **每轮管线**（`skillgate.js` L286-331）：`scoreSkills`（31 全量打分：信号 A 场景映射 + complexBoost + 信号 B 关键词逐个 +1）→ `classifyTiers`（`autoScore 2`/`hintScore 1` 分档，L44-45）→ `arbitrate`（ds-* 活跃时 engineering 场景 mattpocock 技能 auto→hint，L55-58）→ `degrade`（注入估算超 `tokenBudget 8000`（L46）时低分 auto→hint，个数不设上限）→ `renderAdmission`（英文近场文本，`lean-router:skills` 通道）→ audit 留痕。
- **缓存回退**：宿主 `SkillRegistry.collect()` 按 (cwd, scopeChain, revision) 缓存，`provider.list()` 只在未命中时被调——每轮门控因此走注入缝而非重调 list，审计条目标注 `mode: "fallback-cached-list"`（L311）。
- **审计**：`AUDIT_FORMAT_VERSION = 1`（L26）；`createAuditChannel`（L250-279）为内存环形缓冲（默认 256 条）+ 订阅通道，**不落盘**——面板消费归票 07。

### ⑤ audit + ⑥ panel（票 07，进行中）

- audit 侧：skillgate 决策流接 sink、审计流 JSONL 落盘为票 07 的在飞工作；本包 v1 代码里的审计通道是内存环形缓冲（上述）。
- panel 侧：`ui/go.json` 面板卡片（决策行 + 全量得分表折叠 + token 对比 + 黄条）**进行中，未验收**；本票（08）不修改 `ui/**`。

## 预设行与 patch 装配

- `scripts/build-bundle.mjs` 按 HEADER + `presets/base/lean-router.patch.yml` + `frag-lean → frag-toolface → frag-router → frag-preset` 顺序拼出根 `cordis.patch.yml`（847 行）；`npm run build -- --check` 反向逐字节校验。
- **frag-preset.patch.yml 是唯一生效 preset 行**（master 集成产物，scripts/integrate-preset.mjs 生成）：cordis patch 对 preset 行是键级整体替换，frag-lean/frag-toolface 的同 id 覆写互相清场，frag-preset 把 base 12 行 + lean 行 + toolface 行收敛为并集快照排在最后。其 lean persona suffix 末段已替换为 ROUTER_PROMPT（ Routing: before acting on any new task, classify it…）。
- **balance 行**（frag-lean insert）3 条纪律，v1 **不拼路由指令**（suffix 末行是占位注释）。
- 预设之外还有 4 个顶层行：`lean-delivery-gate`（enabled:false, maxRounds:2）、`lean-concurrency`（enabled:true）、`lean-router-router`、`lean-router-commands`。

## 目录索引

| 路径 | 内容 |
|---|---|
| lib/index.js | cordis 插件入口（skill provider 挂载，rank 350） |
| lib/lean/ | lean 层 8 模块（参数/纯函数/插件对象） |
| lib/toolface/ | toolface 层 8 模块（vendored codemode） |
| lib/router.js, lib/bands.js | 路由层 |
| lib/skillgate.js, lib/skill-provider.js | 门控与 provider |
| presets/base/ | 1 模板 + 4 分片（frag-lean/frag-toolface/frag-router/frag-preset） |
| scripts/ | build-bundle / check-drift / doctor / integrate-preset / install / verify |
| assets/skills/ + skills.matrix.json + skills.manifest.json | 31 技能内置副本与双开矩阵 |
| test/ | 20 个测试文件 |
| docs/ | 双语文档（本目录）+ 4 篇中文设计说明（上游票产出，保留中文） |
| ui/ | 票 07 面板（进行中，本票未动） |
