# 变更记录（changelog）

> 中文为主，英文版：[changelog.en.md](./changelog.en.md)。版本号遵循 package.json（当前 1.0.0）。

## v1.0.0（2026-11-21）

一张插件卡六个层全部落地（票 02–06 交付 + master 集成），audit 面板（票 07）进行中、真安装器（票 09）待做。

### 新增

- **lean 层四机制**（票 03，lib/lean/）：轮次压缩（thresholdRatio 0.25 / retainTokens 20000 / retries 1 / auto）、工具输出裁剪（8192/4096/1024 + marker）、关 6 插件（disabled 清单）、行为纪律双档（lean 13 条 + 3 软门 + 自检钩 / balance 3 条）；加料件 delivery-gate（默认关，2 轮）与 glob/grep 并发标记（默认开）。
- **plan-mode v1 并入**（lib/lean/plan-mode.js）：逐行照抄 flash L93-107。
- **toolface 层**（票 04，lib/toolface/）：vendored dsh-codemode 0.3.0（main @ f9758ec）8 模块 file-for-file，适配点以注释标明；遮蔽 ['mcp__'] + 预设外全部、code_run 传输、meta 4 工具、直呼拒绝、retention 双清理、maxParallelSubCalls 10。
- **router 层**（票 05，lib/router.js + lib/bands.js）：spec/react/weak 三带、[router] 显式指令、关键词自动分类、近场引导（lean-router:guide，order 220）、勤勉自检（每 10 轮）、/band 与 /skill 命令、继承会话跳过。
- **skillgate 层**（票 06，lib/skillgate.js + lib/skill-provider.js）：31 技能全量每轮打分（场景映射 + 关键词双信号）、autoScore 2 / hintScore 1 分档、ds-* 场景裁决、tokenBudget 8000 软降级、近场渲染、内存审计环形缓冲、rank 350 provider、两级来源解析。
- **31 技能内置副本**（assets/skills/ + skills.matrix.json + skills.manifest.json）：主人逐条拍板的双开矩阵（13 双开 / 10 仅模型 / 8 仅用户）。
- **构建与自检**（scripts/）：build-bundle（base + 4 分片拼 cordis.patch.yml）、check-drift（warn-only）、doctor（7 项）、integrate-preset（生成 frag-preset 并集快照）、verify（build --check + doctor）、install（安装说明输出）。
- **exports 四子路径**（package.json）：./router、./toolface、./lean/delivery-gate、./lean/tool-concurrency。
- **双语文档**（本目录 + README.md/README.en.md/NOTICE.md）：五主题双语与四上游致谢表（票 08）。

### 裁定（v1 如实记录）

- **frag-preset 并集快照 = 唯一生效 preset 行**：cordis patch 对 preset 行键级整体替换，frag-lean/frag-toolface 同 id 覆写互相清场；scripts/integrate-preset.mjs 生成并集快照、排在 FRAGMENTS 最后。
- **balance 预设行暂不含路由指令**：lean 行 suffix 已拼接 ROUTER_PROMPT，balance 行末行保留占位注释。
- **plan-mode PTC 句保留 flash 原文**：末段 "Under programmatic tool mode ... run_code" 不改（master 裁定：run_code 仍为内置 PTC 传输）。
- **门控走注入缝而非重调 list()**：宿主 SkillRegistry.collect() 缓存生效时审计标注 mode "fallback-cached-list"。
- **8k 软降级**：tokenBudget 8000，降级个数不设上限，只设总量软保险。
- **四篇中文设计说明保持中文（v1）**：docs/复核-关插件清单.md、工具遮蔽-接线说明.md、技能门控-设计说明.md、路由-设计说明.md 为内部工程文档；英文用户读 README.en.md 与 docs 五主题。
- **ptc-runtime 服务行由 master 补挂**：codemode 上游补丁不带此行，而 code_run 的 transport 依赖 ctx.get('ptcRuntime')（lib/toolface/transport.js:221-224）；按宿主 dsh-base/cordis.patch.yml L407-408 同款行挂进并集快照（frag-preset 22 行，scripts/integrate-preset.mjs EXTRA_ROWS）。

### 引擎与依赖

- engines：`>=0.2.1-rc.5 <0.2.3-0`（实测基线 0.2.2-rc.5）。
- dependencies：`@deepseek-ai/dsh-tool-executor-native ^0.2.2-alpha.3`——缺失时 executor 退化为安装提示 stub（describe 抛错 / execute 拒绝），不静默。

### 进行中（不在本版承诺内）

- 票 07：审计流 JSONL 落盘、ui/go.json 面板卡片（决策行 + 得分表 + token 对比 + 黄条）、命中统计 + 手动权重配置。
- 票 09：真安装器、fixture 路径注意事项、--uninstall 回滚。
