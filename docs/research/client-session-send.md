# 客户端插件能否主动向当前会话发消息 / 执行斜杠命令

研究票：GitHub issue #4（wayfinder）。分支：`research/client-session-send`。

## 1. 一句话结论

**能直接开跑。** dsh 0.2.2-rc.5 的客户端插件有两套官方缝：

- 发一条**普通用户消息**：`ctx.conversation.send(text)`（`IConversation.send`），固定 `queue` 投递；
- 在**当前会话**发消息/提命令：slot 组件 props 里的 `inputActions.setDraft() + submit()`，以及 `ctx.remote.commands.execute(sessionId, line, attachments)` 直接执行宿主 `/name` 斜杠命令。

连续发多条是可行的，但**没有内置串联/去重**：每条 `send()` 只是往 next-turn 队列里排一个 pending turn，编排（等第 1 步跑完再发第 2 步）要插件自己做。

## 2. 来源与方法（信任级别）

- 主要来源：**DSH 自身产物**（`D:\Deepseek Harness\resources\app.asar`，包版本 `0.2.2-rc.5`，见 `dsh/package.json:4`），逐个包解出 `src/**/*.ts` 原文阅读。下文 `pkg:` 前缀指 `dsh/node_modules/@deepseek-ai/<pkg>`。
- 辅助来源：本仓库自身的命令注册实现（`lib/router.js`），用来交叉验证宿主 `ctx.commands.register` 缝。
- asar 内文件不能直接 `rg`（路径不可遍历），用自写 asar 解析脚本按 header 解出后再读，未改动任何安装文件。

## 3. 能力清单

| 能力 | 有/无 | 证据 | 限制 |
| --- | --- | --- | --- |
| 客户端插件向「调用方作用域的会话」发一条用户消息 | **有** | `pkg:dsh-client-ui-conversation/src/client/service.ts:53`（`send(text): Promise<void>`，"Send a prompt into the caller scope's session (queued turn)"）；实现 `:209-213` → `session.prompt([{type:'text',text}], 'queue')` | 需要**会话作用域** ctx；固定 queue 模式，不能指定 steer |
| 同一能力的对外入口 | **有** | `pkg:dsh-client-ui-conversation/src/client/index.ts:109-116`（`Context.conversation: IConversation`） | `IConversation` 只有 `input / blocks / send / updateQueue / cancel / loadOlder`（`service.ts:40-71`） |
| 预填输入框 | **有** | `pkg:.../src/client/contract/input.ts:195`（`SessionInput.setDraft(text)`）；`:282`（`InputActions.setDraft`） | 只改草稿，不发送 |
| 提交输入框 = 发一条消息（走完整 composer 管线） | **有** | `input.ts:206`（`SessionInput.submit(mode?, source?)`）；`:292`（`InputActions.submit()`）；slot props `contract/slots.ts:395-402`（`SessionStandardProps.inputActions`） | 受 submit plane 状态机约束（见 §5） |
| 程序化执行一条**斜杠命令** | **有** | `pkg:dsh-client-ui-commands/src/client/service.ts:423`（`this.ctx.remote.commands.execute(session.sessionId, line, attachments)`）；远程契约 `pkg:dsh-commands/lib/typert.remote-client.js:65,138`（`service: 'commands'`，参数依次 `sessionId: string`、`line: string`、附件数组） | 需要 `inject: ['remote.commands', ...]`（同文件 `client/index.ts:52`）；line 带前导 `/`，宿主 `parseCommand` 解析（`pkg:dsh-commands/src/index.ts:125`） |
| 命令的宿主注册缝（服务端 `/name`） | **有** | `pkg:dsh-commands/src/index.ts:285`（`register(definition)`）、`:361`（`execute(...)`）；本仓库用法 `lib/router.js:381,387,395` | 这是**注册**，不是客户端主动触发；两者不是一回事 |
| 客户端自有命令（不落宿主目录） | **有** | `pkg:dsh-client-ui-commands/src/client/contract.ts:101-114`（`CommandContribution`）、`:140-147`（`ctx.commandUi.register / decorate / dismiss`） | 只出现在 `/` 菜单与 chip，不等于「能发消息」 |
| 会话作用域内的新会话预置草稿 | **有** | `input.ts:238`（`SessionInputResolver.requestDraftInitialization(binding, {prompt, whenDraftExists})`）、`:241-253` | 只对「已 retained 但尚未发布」的会话，用于导航前预置 |
| 节流 / 去重 | **无证据** | 发送路径 `service.ts:209-213` 只有一个 `prompt(..., 'queue')`；未在 send/composer 路径发现限流、去重、幂等键 | 连点 N 次 = 队列里 N 条，需插件自己防抖 |

## 4. 连续发多条（工作流 2–4 步）可行性与坑

**可行，语义是「排队」而不是「打断」。**

- 投递模式词汇表只有两种：`queue | steer`（`pkg:.../src/submission-settings.ts:12`，默认 `queue`，`:18`）；`service.ts:211` 里 `send()` **写死 `'queue'`**。
- 忙碌时的模式判定在 `pkg:.../src/client/input/submission-policy.ts:34-38`：不在 running 或传输不支持 steer 时一律 `queue`。
- 排队后的消息进入 next-turn 收件箱，`InputState.queue` 直接暴露 `InboxState['next-turn']`（`input.ts:325`），UI 侧有 QueueDock（`src/client/queue/QueueDock.tsx`）；队列项可被编辑/删除/Steer：`IConversation.updateQueue(itemId, action)`（`service.ts:60`）。

坑（按风险排序）：

1. **编排要自己写**：`send()` 返回的是「宿主已接受」而不是「这一轮跑完」（`service.ts:203-212` 的注释与实现；composer 的 `default-sink` 也是同样语义，`input.ts:397-403`）。4 步工作流必须在插件里等 turn 结束再发下一步，否则 4 条会同时进队列，模型侧看到的顺序虽然保序，但「前一步的产物」不会体现在后一步的提示里。
2. **composer 路径只有一个在飞槽**：`input.ts:328-336` 明确「Command and message attempts hold the single frozen in-flight slot」——连续两次 `inputActions.submit()` 不会并行，第二次在冻结槽释放前进不来；且 `InputState.phase` 会依次经过 `adjudicating/claimed/submitting/sending`（`input.ts:306-326`）。
3. **不要混用两条路**：`send()` 完全绕开 composer，不产生 `commit-draft` 效果；`submit()` 会在发送被接受后清空草稿并切断撤销历史（`input.ts:405-412`）。用 `submit()` 时用户正在写的草稿会被清掉，用 `send()` 则不会。
4. **焦点**：程序化发送不会自动抢焦点，`SessionInput.focus()`（`input.ts:222`）是显式把焦点还给 composer 的唯一口子；发送期间编辑器只读（`input.ts:313-319`）。
5. **失败回滚**：`send()` 的失败会 reject 并在会话快照的 `promptError` 上留痕（`service.ts:203-212`）；composer 路径失败会把草稿恢复回去。工作流编排需要自己接这个 rejection。

## 5. 若走「点一下就跑」的推荐落地顺序

1. **首选**：在已有的 `conversation.session.header.utilities` slot 里，用 props 的 `inputActions.setDraft(promptText)` + `inputActions.submit()` 发一步；或用 `ctx.remote.commands.execute(sessionId, '/code-review', [])` 直接跑宿主命令（前提：技能确实注册成了宿主命令，见 §6 未取得来源）。
2. **次选**：会话作用域的 `ctx.conversation.send(promptText)`，不改用户草稿，适合「后台排一步」。
3. **兜底（无需改上游）**：`inputActions.setDraft()` 只预填不发送，等价今天「填进输入框等人确认」的现状。
4. **改上游？不需要。** 本次取证范围内，发消息、提命令、预填、排队、取消（`cancel()`，`service.ts:65`）、读队列都在既有公开缝上；唯一缺的是「一次提交一串步骤并等每步结束」的编排器，那属于插件自己的逻辑，不是 dsh 缺 API。

## 6. 未取得来源 / 未验证

- **技能与斜杠命令的对应关系**：本次未在 `dsh-*` 包里找到「技能自动注册为 `/skill-name` 宿主命令」的证据。本仓库自己的 `/skill` 是列出技能（`lib/router.js:13-14`），不是运行技能。工作流每一步到底是「发一段自然语言让 agent 调 skill 工具」还是「执行 `/xxx` 命令」，需要在票里另定。
- **运行期验证**：以上全部为源码取证，没有在 GUI 里真点一次按钮观察发送/焦点/草稿行为（本次任务限定只读 + 分支写文档，未跑运行期实验）。
- **去重的否定证据**：只能说「在 send/composer 路径里没找到节流/去重实现」，不能断言 dsh 全局不存在（如宿主的 prompt 入队侧可能有 requestId 幂等，未取证）。
- **面板按钮的作用域**：`send()` 要求会话作用域 ctx，本次未确认「顶栏 utilities slot 的 props 是否直接给出会话作用域 ctx」，只确认它给了 `inputActions`（`contract/slots.ts:395-402`）。若阶段 3 用 `send()` 而非 `inputActions`，需要先解这一层。

## 7. 关键证据索引

| 主题 | 位置 |
| --- | --- |
| `ctx.conversation` 服务面 | `pkg:dsh-client-ui-conversation/src/client/index.ts:109-116`；`service.ts:40-71` |
| `send()` 实现（queue 写死） | `pkg:dsh-client-ui-conversation/src/client/service.ts:203-213` |
| `SessionInput` / `SessionInputResolver` / `InputActions` | `pkg:dsh-client-ui-conversation/src/client/contract/input.ts:184-293` |
| 提交状态机与在飞槽 | `input.ts:306-336`、`:394-412` |
| queue/steer 词汇与默认值 | `pkg:dsh-client-ui-conversation/src/submission-settings.ts:12,18`；`src/client/input/submission-policy.ts:34-38` |
| slot 标准 props（含 inputActions） | `pkg:dsh-client-ui-conversation/src/client/contract/slots.ts:395-411`、`:259-260` |
| 斜杠命令远程执行 | `pkg:dsh-client-ui-commands/src/client/service.ts:403,423`；`pkg:dsh-commands/lib/typert.remote-client.js:65,138` |
| 宿主命令注册/执行/解析 | `pkg:dsh-commands/src/index.ts:125,285,361`；`src/types.ts:57-66,105` |
| 客户端命令贡献与装饰 | `pkg:dsh-client-ui-commands/src/client/contract.ts:101-147` |
| 本仓库现有命令缝用法 | `lib/router.js:70,381,387,395` |

> 路径说明：`pkg:` = `D:\Deepseek Harness\resources\app.asar\dsh\node_modules\@deepseek-ai\<pkg>`（asar 直读，版本 0.2.2-rc.5）。
