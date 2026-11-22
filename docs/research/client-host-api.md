# 客户端插件如何读取宿主侧数据（研究结论）

- 对应 GitHub issue：#3 / wayfinder 研究票（仓库 `ShawnSun-debug/dsh-lean-router`）
- 研究日期：2026-11-19
- 分支：`research/client-host-api`
- 研究方法：主源优先 —— 只读 DSH 引擎自带的官方文档、`src/` TypeScript 源、已装参考插件的真实产物；不采信二手博客。
- 引擎版本基准：`@deepseek-ai/dsh` **0.2.2-rc.5**（`app.asar\dsh\node_modules\@deepseek-ai\dsh\package.json:5`）

## 0. 一句话答案

**dsh 客户端插件拿宿主侧数据的官方通道是 Typert Remote**：宿主插件给方法打 `@Remote`、服务继承 `TypertRemoteService`，构建期生成 `lib/typert.host.js`（宿主）与 `lib/typert.remote-client.js`（客户端贡献），客户端插件在自己的 `./client` bundle 里 `await ctx.get('remote').$mount(贡献)` 后用 `ctx.get('remote.<namespace>')` 调方法；写回宿主同样是这个通道（unary 参数 + stream uplink）。客户端是浏览器环境，**没有 fs、没有 node**，所以「共享文件」只能退化成上面这条或 HTTP 端点。这是一条**双向、带类型、有取消、有访问控制**的契约，`dsh-ops` 与 `dsh-cost-meter` 两个既有插件都按它实现。

## 1. 现状：三类数据全在宿主侧，客户端现在一无所有

| 数据 | 宿主侧来源（file:line） | 数据性质 |
|---|---|---|
| 31 技能清单与开关 | `lib/skill-provider.js:61` 读 `ROOT/assets/skills.matrix.json`；`lib/index.js:13` `ctx.skills.registerProvider(...)` 注册 | 静态包内文件（`assets/skills.matrix.json:17-18` 的 `model`/`user` 字段 = 开关） |
| 本轮命中分与依据 | `lib/skillgate.js` 内存环形审计通道；`lib/index.js:4` `getAuditChannel()` 导入 | 宿主内存实时态 |
| 历史命中统计 | `lib/audit-sink.js:11` `readAuditEntries()`；`:20-21` `defaultAuditPath()` = `<homedir>/.dsh/lean-router/audit.jsonl` | 用户级 JSONL 文件 |

客户端现状：`lib/client.js:15-20` 只有 `window.__ModuleLoader__.load({id, factory})` 骨架，`factory` 里只 `require("react")` / `require("react-dom")`，外加 `ctx.slots.register` 挂 UI —— 拿不到上表任何一类数据。

## 2. 通路清单

| # | 通路 | 可行性 | 证据（file:line） |
|---|---|---|---|
| 1 | **Typert Remote**：宿主 `@Remote`/`@RemoteScope` → `ctx.remote.<ns>` | ✅ 官方推荐，双向（unary 参数写回宿主；`@Remote({mode:'stream'})` 还带 uplink） | `dsh/docs/api-gateway.md:9`（未标记方法不进 `ctx.remote`）、`:45`、`:58`、`:60`（stream/uplink）、`:62`（`ctx.remote.<namespace>` + `$mount`）、`:94`（客户端侧由 `@deepseek-ai/dsh-api-gateway/client` 提供 `ctx.remote`）；`dsh-typert-protocol/README.md:45`（"Clients call it as a typed method through `ctx.remote`"） |
| 2 | **连接层 RPC** `ctx.connection.rpc`（裸 RPC 载体） | ⚠️ 能用，但绕开类型契约；协议包只承诺 `$mount()/$on()` | `dsh/docs/api-gateway.md:96`（Both：`dsh-client-connection` 提供 RPC 载体 / 请求关联 / 取消 / `/api` HTTP 桥）；`dsh-typert-protocol/README.md:88`（`TypertClientRemote` 只暴露 `$mount()` 和 `$on()`，事件传输对 Gateway 私有）；实例：`dsh-cost-meter/lib/client.js:10` `ctx.get('connection')?.rpc` |
| 3 | **Client Resources**：宿主浏览器侧 `ctx.resources.register({protocol, open})`，slot 组件用 props 里的 `useResource(address)` 读 | ✅ 官方，但它是**展示层**，不是新通道：provider 内部仍要调 `ctx.remote.*` 取数 | `dsh/docs/subsystems/client-resources.md:5`（`ctx.resources` + `useResource`）、`:40-47`（provider 注册示例，`yield await ctx.remote.notes.read(...)`）、`:55`（slot 组件 props 自带 `useResource`） |
| 4 | **HTTP 端点**：宿主 `ctx.webServer` 注册路由，浏览器 `fetch()` | ✅ 技术可行（core 缝），但**没有类型契约、没有访问控制**，鉴权/封装要自己做 | `dsh/docs/capability-seams.md:758`（`ctx.webServer` = core，"HTTP route registration"）、`:299`、`:637-639`（webServer 供给 client-connection / client-modules / client-hmr） |
| 5 | **构建期静态注入 / 静态资源**：`dsh.client.external` 共享模块基线；包内 `./assets/*` 由 `/plugins/<pkg>/assets/…` 提供、构建期编译成 `require.asset(...)` | ⚠️ 只能送**构建期固化**的数据；`window.__DSH_BOOT__` 由宿主组合，插件无法往里塞任意 payload | `dsh-client-modules/README.md:34`（`dsh.client` + `./client` 声明契约）、`:39`（`/plugins` 同时也发 assets、`require.asset` 形态）、`:55`（`dsh.client.external` 只接受非基线**模块请求**）、`:73`（boot graph = `WebBootEntry` 行，宿主注入）；`dsh/docs/cookbook/adding-a-settings-card.md:60`（bundle 必须是 lazy-CJS factory 格式，构建 preset 未发布） |
| 6 | **共享文件**（客户端直读磁盘） | ❌ 不可行：`./client` 跑在浏览器页面里，无 fs；文件只能由宿主读，再经 #1/#4 送出 | `dsh/docs/cookbook/adding-a-settings-card.md:60`（built `./client` 是给页面模块系统用的 lazy-CJS）、`dsh-client-modules/README.md:12`（宿主负责 compose/serve，浏览器负责 load） |

补充：宿主→客户端的**事件推送**也在 #1 里 —— 宿主装配扩展 `TypertRemoteEventSelection`，客户端用 `ctx.remote.$on(...)` 订阅（`dsh-typert-protocol/README.md:88`）。

## 3. 推荐哪条：Typert Remote（通路 #1）

理由（按重要性）：

1. **唯一带契约的通道**：类型在生成期定死、调用有访问控制（`dsh-api-gateway.md:93` 的 `dsh-api-remote-access`）、有取消（`signal: AbortSignal`，`:58`）、失败有稳定 `RemoteError` 码（`dsh-typert-protocol/README.md:73-84`）。
2. **不需要改别人的组合**：文档说应用侧只装配 `@deepseek-ai/dsh-api-remotes`（`dsh-api-gateway.md:80`），但**插件可以自己 `$mount` 自己的贡献** —— 两个参考实现都这么做：`dsh-ops/lib/client.js:1272`（`inject = ['slots','locale','remote']`）、`:1283` `await remote.$mount(runtime_contract_js_1.RUNTIME_REMOTE)`、`:1294` `ctx.get('remote.opsSettings')`；`dsh-cost-meter/lib/client.js:10` 同形（`t.$mount(ko)` → `ctx.get('remote.costMeter')`）。
3. **用 `ctx.get('remote.<ns>')` 而不是点号属性**：dsh-ops 在源码注释里写明点号属性是 traced 的，只能在注入该服务的 ctx 里读，渲染回调里读会抛（`dsh-ops/lib/client.js:1275-1277`、`:1288-1295`）。这是踩过的坑，直接照抄。
4. **`$mount` 失败必须降级**：dsh-ops 明确写「A missing remote must not blank the page」并 try/catch（`:1279-1287`）。技能面板应照此：拿不到 remote 就显示「宿主数据不可用」，不要白屏。

对照 #4（HTTP 端点）：只有在「需要非 dsh 客户端消费」时才更优；本票是纯 dsh 插件，走 HTTP 会白丢访问控制与类型。

## 4. 第 2 问：客户端能写回宿主吗？全局持久写哪里？

**能。** 同一个 #1 通道反向即可：`@Remote` unary 方法收参数写宿主（`dsh-api-gateway.md:37-45`）；stream 方法还能收客户端回传项（`RemoteStream<Out, In>` + `ctx.invocation.uplink<In>()`，`:60`）。

**持久位置（关键：不能写包内，npm 升级会整包替换 `assets/`）**：

| 方案 | 位置 | 证据 / 结论 |
|---|---|---|
| **推荐**：插件自管用户级目录 | `~/.dsh/lean-router/skills.overrides.json` | 与本仓库**已有**的审计落盘同目录：`lib/audit-sink.js:19-21` `join(homedir(), '.dsh', 'lean-router', 'audit.jsonl')`；`~/.dsh` 是引擎官方的用户数据根：`dsh-home-paths/README.md:34-39`（`resolveDshHome()` = 配置 > `$DSH_HOME` > `~/.dsh`） |
| 备选 A：引擎存储设施 | `~/.dsh/storages/<domain>/…`，经宿主 `ctx.storageDomain` | `dsh-storage/README.md:32-46`（hub + backend + domain 三行组合，`dsh-storage-json` 带 `root`）；`dsh/docs/capability-seams.md:713-714`（`ctx.storage`/`ctx.storageDomain` 为宿主侧）；真实先例：`C:\Users\charl\.dsh\storages\cost-meter\ledger.json`（本机实读） |
| 备选 B：插件 Config 字段 | `~/.dsh/profiles/<profile>/cordis.patch.yml` 的插件行 `config` | `dsh/docs/cookbook/adding-a-settings-card.md:13-27`（`Volatile` 活字段）、`:40`（保存后校验 profile patch）；适合少数旋钮，31 个开关塞 config 不合适 |

**不推荐**：`ctx.storageDomain` 只对宿主代码开放（`dsh-storage/README.md:12`），客户端无法直连，仍要先有 #1；因此对「技能开关」这种小数据，宿主 `@Remote` 方法里直接读改写 `~/.dsh/lean-router/skills.overrides.json`（原子写，参照 `dsh-atomic-write` 包名）最省事，且与 `lib/audit-sink.js` 的既有落盘位置一致。

另注：`assets/skills.matrix.json` 的 `model`/`user` 是**出厂默认值**，只读；用户覆盖必须另存 `~/.dsh/lean-router/`，读取时 `matrix`（默认）⊕ `overrides`（用户）合并 —— 与 `lib/skill-provider.js:61` 现有读取点解耦。

## 5. 落地要点（给下一张实现票）

1. 客户端 bundle 挂在**裸包名那一行**：`dsh.client` 只贴 specifier 为裸包名的 Loader 行，子路径导出的行拿不到 half（`dsh/docs/cookbook/adding-a-settings-card.md:58`）。本仓库满足：`cordis.patch.yml` 有 `- id: skill-lean-router, name: dsh-lean-router`。
2. `package.json` 的 `dsh.client` 需要 `inject` 声明依赖（如 `@deepseek-ai/dsh-api-gateway`），参考 `dsh-ops/package.json` 的 `dsh.client.inject` 五项。
3. 生成产物两份：`lib/typert.host.js`（宿主 Loader 用）+ 客户端贡献（`dsh-api-gateway.md:108-114` 的产物表）。本仓库是手写 bundle 风格，客户端贡献需要手写或引入生成器。
4. 数据形状建议：`listSkills()` → 31 条 `{name, model, user, scenario, keywords}` + `enabled` 覆盖；`getRoundScores()` → 环形通道快照；`getStats()` → `readAuditEntries(path, {limit})` 聚合（`lib/audit-sink.js:111`）。

## 6. 未取得来源 / 未验证（逐条）

1. **未取得来源**：手写一个最小可用的 `TypertRemoteContribution` 的**确切形状**。`dsh-ops` 的贡献对象压在打包后的 bundle 内（`dsh-ops/lib/client.js:2` 起的 `settings/runtime-contract.js`），官方文档只描述「生成器产出」，没有「手写契约」的规范。→ 实现票需要实测或引入 `@deepseek-ai/dsh-typert-generator`。
2. **未取得来源**：`ctx.connection.rpc` 对第三方插件的稳定性承诺。协议包只写 `TypertClientRemote` 暴露 `$mount()/$on()`（`dsh-typert-protocol/README.md:88`），而 cost-meter 直接用了 `connection.rpc` —— 属未文档化的旁路，不建议跟。
3. **未取得来源**：第三方插件用 `ctx.webServer` 注册自有路由的官方示例/许可说明。`capability-seams.md:758` 只把它列为 core 缝，标注的消费者均为引擎自身包（client-connection / client-modules / client-hmr）。
4. **未取得来源**：引擎侧 `clientBundle` tsdown 构建 preset 未作为包发布（`dsh/docs/cookbook/adding-a-settings-card.md:60` 明说在仓库外需自行复现），因此「本仓库手写 bundle 是否永远兼容」无官方承诺。
5. **未验证**：本次**没有运行任何实时调用**。所有结论来自源码/文档阅读，`$mount` + `ctx.get('remote.<ns>')` 在 dsh-lean-router 自身 bundle 里是否一次通过，需要在实现票里实测（建议先做一条 `listSkills()` 打通）。
6. **未取得来源**：`~/.dsh/lean-router/` 作为「官方约定目录」的地位 —— 目前只是本仓库自选路径（`lib/audit-sink.js:21`），引擎侧无注册；`dsh-home-paths` 只保证 `~/.dsh` 根。

## 7. 参考文件清单（本结论的证据底本）

引擎（asar 内，只读）：
- `node_modules/@deepseek-ai/dsh/docs/api-gateway.md`（客户端↔宿主 Remote 契约主文档）
- `node_modules/@deepseek-ai/dsh/docs/subsystems/client-resources.md`
- `node_modules/@deepseek-ai/dsh/docs/subsystems/client-modules.md`
- `node_modules/@deepseek-ai/dsh/docs/cookbook/adding-a-settings-card.md`
- `node_modules/@deepseek-ai/dsh/docs/capability-seams.md`
- `node_modules/@deepseek-ai/dsh-typert-protocol/README.md`
- `node_modules/@deepseek-ai/dsh-client-modules/README.md`
- `node_modules/@deepseek-ai/dsh-storage/README.md`、`dsh-home-paths/README.md`

本机已装参考实现：
- `C:\Users\charl\.dsh\profiles\desktop\node_modules\dsh-ops\lib\client.js`（`$mount` + `ctx.get('remote.<ns>')`，含踩坑注释）
- `C:\Users\charl\.dsh\profiles\desktop\node_modules\dsh-cost-meter\lib\client.js`、`package.json`（`exports['./typert']`、`dsh.client.platform: web`）
- `C:\Users\charl\.dsh\storages\cost-meter\ledger.json`（用户级持久化的真实先例）

本仓库：
- `lib/client.js`、`lib/index.js`、`lib/skill-provider.js`、`lib/skillgate.js`、`lib/audit-sink.js`、`assets/skills.matrix.json`、`package.json`、`cordis.patch.yml`

> 注：`D:\Deepseek Harness\resources\app.asar` 是 asar **归档**（不是解包目录）。PowerShell 的 `Test-Path` 与 ripgrep 都无法进入；读取需用 Electron 的 asar-patched fs（本报告用 `ELECTRON_RUN_AS_NODE=1` + `fs.readFileSync` 遍历验证）。
