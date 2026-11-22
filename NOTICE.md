# NOTICE

本包（dsh-lean-router）站在四个上游的肩膀上，均按 MIT 或其声明的许可条款再分发。本表是**贡献映射表**：上游 → 贡献到本包的层 → 本包中的承载文件。各上游的 LICENSE 全文保留在其原仓库；以下仅摘录 MIT 声明的版权行（非全文）。

## 四上游致谢表

| 上游 | 版本 / 基线 | 贡献到本包的层 | 本包承载位置 | 许可（版权行摘录） |
|---|---|---|---|---|
| dsh-flash-presets（LarryE135） | 0.3.2 | lean 四机制（轮次压缩/输出裁剪/关插件/行为纪律）、plan-mode v1、delivery-gate、glob/grep 并发标记、preset 双档形态 | lib/lean/*（compaction/pruner/disabled/persona-text/plan-mode/delivery-gate/tool-concurrency）、presets/base/frag-lean.patch.yml | MIT — Copyright (c) 2026 LarryE135 |
| dsh-codemode（dsh-codemode contributors） | 0.3.0，main @ f9758ec | toolface 掩蔽接缝（ToolExecutor describe/execute）、code_run 传输与并发池、meta 发现 4 工具、三视图 scope 归因、retention 双清理 | lib/toolface/*（8 模块 file-for-file vendored，适配点以注释标注）、presets/base/frag-toolface.patch.yml | MIT — Copyright (c) 2026 dsh-codemode contributors |
| dsh-routing-suite（yjh051108） | 0.3.3（@dsh-external/dsh-super-injector） | 思考链路由**思想**（行为带分类、近场引导、反稀释勤勉自检的轻量化）——只移植实测结论，未搬运其旧线代码 | lib/router.js、lib/bands.js（实现重写，头部注明思想来源） | MIT — Copyright (c) 2026 yjh051108 |
| mattpocock skills | 31 个技能正文 | skills 数据源与内置副本兜底、门控层评分数据 | assets/skills/（31 目录）、assets/skills.matrix.json、skills.manifest.json | MIT（沿用既有 NOTICE 口径；正文经主人引入本地 ~/.dsh/skills，本包以内置副本作 vendored fallback） |

## 逐文件 vendored 映射（摘要）

- **lib/lean/compaction.js / pruner.js**：flash-presets `flash-lean-ptc-v3.patch.yml` 的口径照抄（lean 档 L121-133；balance 同值）+ 宿主判据镜像（dsh-compaction-basic L15/17/63/124-147；dsh-compaction-tool-result-pruner L8-27/91-124）——纯函数端口，执行归宿主。
- **lib/lean/persona-text.js**：flash lean 13 条规则与 prefix 原文（flash-lean-ptc-v3.patch.yml L15-60）+ balance 3 条（flash-lean-ptc-v3-balance.patch.yml L13-18）；本包增补 3 软门与自检钩；规则 7 删去 PTC-only 句（唯一实质差异）。
- **lib/lean/plan-mode.js**：flash-lean-ptc-v3.patch.yml L93-107 逐行照抄（vendored）。
- **lib/lean/delivery-gate.js / tool-concurrency.js**：flash-presets 0.3.2 lib/delivery-gate.js / lib/tool-concurrency.js 逐段移植（0.3.2 版），适配点：动态 import、手写校验、插件名改 `lean-delivery-gate` / `lean-concurrency`、Symbol 键空间改本包。
- **lib/lean/disabled.js**：flash-lean-ptc-v3.patch.yml L155-202 的 6 行 disabled 清单照抄。
- **lib/toolface/**（8 模块）：upstream dsh-codemode 0.3.0 lib/{index,rules,executor,discovery,scope,pool,retention,transport}.js，file-for-file vendored @ f9758ec；适配：插件名/日志前缀改本包、native executor 依赖动态 import + 安装提示 stub、Symbol 键与 TAG 标注。
- **lib/router.js / lib/bands.js**：routing-suite 思想移植（非代码）；关键实测结论（三带 persona 非连续、V4.1 Flash 阈值型最优解）已在 bands.js L1-7 头注注明。
- **assets/skills/**：mattpocock 31 技能正文副本（tier bundled 兜底；一级来源仍是 ~/.dsh/skills 同名目录）。

按 MIT 要求，各上游的版权与许可声明随再分发保留；对本包的修改（适配点）均在文件头部注明，未删除上游署名信息。
