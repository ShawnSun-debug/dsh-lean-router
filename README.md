# dsh-lean-router

[![CI](https://github.com/ShawnSun-Debug/dsh-lean-router/actions/workflows/ci.yml/badge.svg)](https://github.com/ShawnSun-Debug/dsh-lean-router/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](https://nodejs.org)

为 DeepSeek V4.1 Flash 调校的 DeepSeek Harness（DSH）cordis 插件：**一张插件卡**里融合六层——lean 省 token 四机制（flash-presets 实测口径）、code_run 工具遮蔽（codemode 接缝）、思考链路由三带（routing-suite 思想）、mattpocock 31 技能门控自动调用、审计通道与（进行中的）面板。

> 本包双语文档采用 **「中文默认 + 英文 `.en.md` 独立文件」** 方案：中文是第一语言（README.md 与 docs/*.md），英文版同目录 `.en.md`（本文件 ↔ [README.en.md](./README.en.md)）。三个上游项目也遵循「中文 README + README.en.md」惯例。

> 状态：**v1.0.0**（六票 02–06 全验收 + master 集成完成；audit 面板票 07 **进行中**，发布票 09 待做）。

## 功能一图

| 层 | 模块 | 一句话 |
|---|---|---|
| lean（票 03） | lib/lean/ | 轮次压缩 0.25/20000 · 输出裁剪 8192/4096/1024 · 关 6 插件 · 纪律双档（lean 13+3 软门 / balance 3）+ 交付门 + glob/grep 并发标记 |
| toolface（票 04） | lib/toolface/ | 预设外工具（MCP 等）从请求面隐藏，程序内 `code_tools_search` 发现后调用；`code_run` 传输 |
| router（票 05） | lib/router.js · lib/bands.js | spec/react/weak 三带 + `[router] band=` 显式指令 + 近场引导（零写入）+ /band /skill |
| skillgate（票 06） | lib/skillgate.js · lib/skill-provider.js | 每轮 31 技能全量打分 → 分档 → ds-* 裁决 → 8k 软降 → 近场挂载/提示 |
| audit（票 07 进行中） | lib/skillgate.js 审计通道 | 内存环形缓冲（256 条）+ 订阅；JSONL 落盘与 ui 面板在飞 |
| panel（票 07 进行中） | ui/ | 面板卡片（决策行 + 得分表 + token 对比 + 黄条），**未验收** |

## 目标 DSH

engines：`>=0.2.1-rc.5 <0.2.3-0`（实测基线 0.2.2-rc.5）。DSH 处于 developer preview，破坏性变更将以 engines 闸 + doctor 自检 + warn 黄条应对，不做静默降级。

## 安装

未发布，先本地 link（两条路径详见 [docs/quickstart.md](docs/quickstart.md)）：

~~~powershell
dsh plugin --profile desktop add "link:D:\path\to\dsh-lean-router"
# 发布后：dsh plugin --profile desktop add npm:dsh-lean-router@1.0.0
~~~

依赖 `@deepseek-ai/dsh-tool-executor-native`；缺失时工具遮蔽层不静默——executor stub 首次 `describe` 抛出含安装指引的错误（lib/toolface/executor.js L57-63），按提示 `npm install` 或用 `dsh plugin add` 重装即可。

## 快速上手

1. 重启 DSH，新会话选预设 **Lean router**（或 **Lean router (balance)**）。
2. 可选：首条消息带 `[router] band=spec|react|weak|auto [task=<一行>]`。
3. 命令：`/band` 看切带、`/skill` 列技能、`/compact` 手动压缩。
4. 体检：`node scripts/doctor.mjs`（7 项自检）→ `npm run verify`（含 build --check 反向一致，与 doctor 合计 8 道把关）→ `npm test`。

## 文档

五主题双语（中文默认，`*.en.md` 为英文版）：

| 主题 | 中文 | English |
|---|---|---|
| 快速上手 | [docs/quickstart.md](docs/quickstart.md) | [docs/quickstart.en.md](docs/quickstart.en.md) |
| 架构六层 | [docs/architecture.md](docs/architecture.md) | [docs/architecture.en.md](docs/architecture.en.md) |
| 配置参考 | [docs/configuration.md](docs/configuration.md) | [docs/configuration.en.md](docs/configuration.en.md) |
| 技能矩阵 | [docs/matrix.md](docs/matrix.md) | [docs/matrix.en.md](docs/matrix.en.md) |
| 变更记录 | [docs/changelog.md](docs/changelog.md) | [docs/changelog.en.md](docs/changelog.en.md) |

上游票产出的 4 篇中文设计说明保留在 docs/：[路由-设计说明](docs/路由-设计说明.md) · [技能门控-设计说明](docs/技能门控-设计说明.md) · [工具遮蔽-接线说明](docs/工具遮蔽-接线说明.md) · [复核-关插件清单](docs/复核-关插件清单.md)。

## v1 现状（如实标注）

- **audit 面板进行中**（票 07 在飞）：审计通道已就绪，`ui/go.json` 面板未验收。
- **balance 预设行暂不含路由指令**（v1 裁定；lean 行已拼接 ROUTER_PROMPT）。
- **plan-mode 政策段保留 flash 原文**（含 PTC `run_code` 句）。
- **门控回退模式**：宿主技能目录缓存生效时，每轮门控走注入缝，审计标注 `mode: "fallback-cached-list"`。
- **8k 软降级**：门控注入估算超 `tokenBudget 8000` 时低分技能降档，个数不设上限。
- **预设行唯一生效**：frag-preset.patch.yml 并集快照是唯一生效 preset 行（cordis patch 键级整体替换语义）。

## 许可与致谢

MIT，见 [LICENSE](LICENSE)。四上游贡献映射与许可声明见 [NOTICE.md](NOTICE.md)：dsh-flash-presets（LarryE135）· dsh-codemode（dsh-codemode contributors）· dsh-routing-suite（yjh051108）· mattpocock skills（31 技能正文）。
