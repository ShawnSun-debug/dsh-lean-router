# 快速上手（quickstart）

> 本包 **dsh-lean-router** 是一张 DeepSeek Harness（DSH）cordis 插件卡：lean 省 token × 思考链路由 × `code_run` 工具遮蔽 × mattpocock 31 技能自动调用，四个机制合并在一个预设里。中文为第一语言，本篇的英文版是 [quickstart.en.md](./quickstart.en.md)（本包双语文档采用「中文默认 + 英文 .en.md 独立文件」方案）。

## 前置条件

- DSH `>=0.2.1-rc.5 <0.2.3-0`（实测基线 0.2.2-rc.5；见 package.json engines 字段）。
- 本包未发布到 npm，先走本地 link 安装（下文）。DSH 处于 developer preview，版本越界将以 engines 闸 + doctor 自检 + warn 黄条应对，不做静默降级。

## 安装

### 路径 A：本地 link（当前推荐）

~~~powershell
dsh plugin --profile desktop add "link:D:\path\to\dsh-lean-router"
~~~

重启 DSH 后，新会话在预设列表选择 **Lean router**（lean 档）或 **Lean router (balance)**（弱约束精简档）。

### 路径 B：npm 安装（发布后可用）

~~~powershell
dsh plugin --profile desktop add npm:dsh-lean-router@1.0.2
~~~

（两条路径与 scripts/install.mjs 输出的说明一致；真安装器、认领边界与 `--uninstall` 回滚归票 09。）

### 缺依赖时的 stub 引导行为

本包依赖 `@deepseek-ai/dsh-tool-executor-native`（package.json dependencies）。若该依赖未随包解析（如手动复制目录安装），工具遮蔽层不会静默坏掉：executor 会退化为安装提示 stub——首次调用 `describe` 直接抛出含安装指引的错误（lib/toolface/executor.js L57-63），错误信息为：

> dsh-lean-router/toolface requires the dependency "@deepseek-ai/dsh-tool-executor-native". Install dsh-lean-router together with its dependencies (dsh plugin add resolves them) or upgrade the package; ...

手动补装：在该包目录 `npm install`，或用 `dsh plugin add` 重装以让宿主解析依赖树（fixture 路径注意事项票 09 补）。

## 首次使用

1. 新会话选择预设：**Lean router**（13 条纪律 + 3 软门 + 路由）或 **Lean router (balance)**（3 条纪律，v1 暂不含路由指令）。
2. 可选显式路由指令（写在首条真实用户消息里）：

   ~~~text
   [router] band=spec
   [router] band=react task=把首页拆成组件
   [router] band=auto
   ~~~

   band 含义见 [architecture.md](./architecture.md)「三带」。省略指令时按关键词自动分类，平票归 `weak`（模型自分类）。
3. 常用命令：
   - `/band`：查看或切换路由带（spec/react/weak/auto）。
   - `/skill`：列出可用技能与 invocation 开关；`/skill <name>` 看单个技能。
   - `/compact`：手动触发上下文压缩（compaction 组）。
4. 工具遮蔽是自动的：模型工具列表只出现预设自有工具 + `code_run`；MCP 与预设外插件工具在 `code_run` 程序内用 `tools.code_tools_search(...)` 发现后调用。直呼被遮蔽名会被拒绝并提示先搜索。

## 体检

~~~powershell
node scripts/doctor.mjs   # 7 项结构自检（包名/engines/patch/预设行/manifest 31/目录 31/矩阵 13-10-8）；build --check 反向一致为第 8 道把关
npm run verify            # build --check（cordis.patch.yml 反向逐字节一致）+ doctor
npm test                  # node --test test/（20 个测试文件）
~~~

## 术语表（全包统一）

| 术语 | 含义 |
|---|---|
| lean | 省 token 的四机制总称（轮次压缩/输出裁剪/关插件/行为纪律），外加两个加料件（交付门/并发标记） |
| 遮蔽（masking） | 把预设不拥有的工具从模型请求面隐藏，程序内仍可调用（toolface 层） |
| 路由（routing） | 把任务分到三条行为带并在近场注入对应引导（router 层） |
| 门控（gating） | 每轮对 31 技能全量打分、只放行高分技能进近场通道（skillgate 层） |
| 带（band） | spec（inspect-and-plan）/ react（hands-on-production）/ weak（model-routed）三带 |
| 近场引导 | 通过 dynamic context 注入的固定文本：同一带内文本恒定、宿主判等零写入 |

## 已知 v1 现状（如实标注，勿当承诺）

- **audit 面板进行中**（票 07 在飞）：门控审计通道（内存环形缓冲 + 订阅）已就绪，面板 UI 未验收。
- balance 预设行暂不含路由指令（v1 裁定）。
- plan-mode 政策段保留 flash 原文（含 PTC `run_code` 句）。
- 门控每轮评分走注入缝而非重新调 `list()`：宿主 `SkillRegistry.collect()` 缓存生效时审计标注 `mode: "fallback-cached-list"`。

详见 [architecture.md](./architecture.md)、[configuration.md](./configuration.md)、[changelog.md](./changelog.md)。
