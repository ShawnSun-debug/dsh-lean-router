
## 执行记录（2026-11-22）

- ✅ npm publish `dsh-lean-router@1.0.0` 完成（bypass-2FA granular token；`npm view dsh-lean-router@1.0.0` 可验）
- ✅ `git push` 完成（远程 `ShawnSun-debug/dsh-lean-router`，main @ d3ffe1d 起）
- ✅ GitHub Release `v1.0.0` 已创建
- ✅ CI 首轮修复（`npm test` 改用 `node --test "test/*.test.mjs"`，目录参数在 Node 24 不可用）后 green
- ⚠️ registry 上残留 npm 自动生成的占位版本 `0.0.0-stage`（latest 已指向 1.0.0；需网页+OTP 才能删除，可忽略）
- ⏳ 剩余人工项：DSH profile 真机安装冒烟（见下文第 93/103 行附近命令）

# 发布清单 · dsh-lean-router v1.0.0

> 本文件只列**主人手动执行**的动作。负责发布票的子对话**不得**执行 `npm publish` / `npm login` / `git push`（台账 constraints 3、forbidden 4）。
> 中文先行，英文版见 [release-checklist.en.md](./release-checklist.en.md)。

包名：`dsh-lean-router` · 版本：`1.0.0` · 仓库：https://github.com/ShawnSun-Debug/dsh-lean-router

## 0. 发布前预检（已由子对话核实，可复跑）

| 检查 | 命令 | 通过判据 |
|---|---|---|
| 全仓测试 | `npm test` | `tests 200 / pass 199 / fail 0 / skipped 1`（1 skip = 宿主 yaml-asar 不可读，已知限制） |
| 体检 | `npm run doctor` | 7 PASS |
| 构建一致性 | `npm run build -- --check` | PASS，无重写 |
| 漂移 | `npm run drift` | 无漂移 |
| CI YAML | `python -c "import yaml; yaml.safe_load(open(r'.github/workflows/ci.yml', encoding='utf-8')); print('YAML_OK')"` | 打印 `YAML_OK` |
| 打包冒烟 | `npm pack` → 临时目录 `npm i <tgz>` → `node -e "require('dsh-lean-router')"` | 安装成功且导入返回 3 个导出 |

> **发布前需主人确认名称**：`npm view dsh-lean-router version` 实测可连通 registry 并返回 `E404 Not found`，说明该名当前**未被发布**；正式 publish 前请再确认一次（避免同名抢注或私有 scope 归属问题）。

## 1. npm 登录（手动）

```powershell
npm login          # 浏览器/一次性密码走 npm 官方流程
npm whoami         # 验证：打印你的 npm 用户名
npm config get registry   # 期望 https://registry.npmjs.org/
```

**验证**：`npm whoami` 输出用户名且退出码 0。

## 2. 发布到 npm（手动，不可逆）

```powershell
cd "D:\Agent Workspace\dsh-lean-router"
npm test                    # 发布前最后一道闸：必须 200/199/0/1
npm pack --dry-run          # 先看一眼 inclusions 是否只含 lib/presets/assets/ui/docs/scripts/test/清单文件
npm publish                 # 首发不需要 --tag；后续预发用 npm publish --tag next
```

**验证**：

```powershell
npm view dsh-lean-router version                 # 期望 1.0.0
npm view dsh-lean-router dist.tarball            # 返回 https://registry.npmjs.org/dsh-lean-router/-/dsh-lean-router-1.0.0.tgz
```

**回滚**（72 小时内可 unpublish）：`npm unpublish dsh-lean-router@1.0.0`；更稳的是发补丁版 1.0.1 并 `npm deprecate dsh-lean-router@1.0.0 "msg"`。

## 3. 建远端并推送（手动）

git 仓库已在本地初始化并完成首发提交（见 `git log`）。远端需主人手动推送：

```powershell
cd "D:\Agent Workspace\dsh-lean-router"
git remote add origin https://github.com/ShawnSun-Debug/dsh-lean-router.git
git branch -M main
git push -u origin main
```

**验证**：

```powershell
git remote -v                                   # origin 指向上述地址
git ls-remote --heads origin main               # 返回 main 的 SHA
git log --oneline -1                            # 与远端 HEAD 一致
```

推送后 GitHub Actions 会自动跑 `.github/workflows/ci.yml`（ubuntu-latest + node 24 + npm install + npm test）。

**验证 CI**：仓库 Actions 页首个 run 绿；或 `gh run list --workflow=ci.yml --limit 1`。

## 4. 打 tag 并建 GitHub Release（手动）

```powershell
git tag -a v1.0.0 -m "dsh-lean-router v1.0.0"
git push origin v1.0.0
gh release create v1.0.0 --title "v1.0.0" --notes-file docs/changelog.md   # 或网页端创建
```

**验证**：

```powershell
git tag -l "v1.0.0"                             # 打印 v1.0.0
gh release view v1.0.0                          # 标题/正文与 v1.0.0 一致
```

## 5. DSH profile 真机安装冒烟（手动）

在真实 DSH 用户环境里验证「装得上、卸得净、配置装得对」：

```powershell
# 5.1 安装
dsh plugin install dsh-lean-router
# 或：npm i -g dsh-lean-router 后按 DSH 文档挂到 profile

# 5.2 装配检查（不启动对话，只看配置合成结果）
dsh --dump-config | Select-String "skill-lean-router|dsh-lean-router"

# 5.3 卸载
dsh plugin uninstall dsh-lean-router

# 5.4 卸载后确认无残留
dsh --dump-config | Select-String "skill-lean-router"   # 期望无输出
```

**验证判据**：
1. 安装命令退出码 0；
2. `--dump-config` 输出里能查到本插件（plugin 名 `skill-lean-router`）；
3. 卸载后 `--dump-config` 不再出现该插件，且 profile 配置目录无残留文件；
4. 期间**不重启**正在运行的 DSH 应用、不写 `~/.dsh`（如必须，由主人手动执行）。

## 6. 发布后

- 按 `docs/changelog.md` 校对 Release 正文；
- README 徽章里若需 npm 版本徽章，可在发布后追加；
- 记录首发版本号与 tarball shasum 到项目日志。

## 附：本仓库发布相关的界定

- 只发布 `package.json#files` 白名单内容（lib/ presets/ assets/ ui/ docs/ scripts/ test/ + 清单与 LICENSE/NOTICE/README）；
- `fixtures/`、`node_modules/`、`.git/`、`.github/` 不随包发布（见 `.npmignore`）；
- 宿主仓库 `D:\Deepseek Harness` 与 engineer-mode / engineer-lean 预设不在发布范围内，禁止触碰。
