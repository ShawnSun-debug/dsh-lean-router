# 安装 · dsh-lean-router

> 中文先行，英文版见 [install.en.md](./install.en.md)。发布清单见 [release-checklist.md](./release-checklist.md)。

## 方式一：npm 全局安装 + DSH 挂载（推荐）

```powershell
npm i -g dsh-lean-router
dsh plugin install dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"
```

## 方式二：本地 tarball 安装（离线 / 首发前自测）

```powershell
npm pack                                  # 产出 dsh-lean-router-1.0.0.tgz
npm i -g .\dsh-lean-router-1.0.0.tgz
dsh plugin install dsh-lean-router
```

冒烟命令（不启动对话，只验证包能导入）：

```powershell
node -e "const m=require('dsh-lean-router'); console.log(Object.keys(m))"
# => [ 'apply', 'inject', 'name' ]
```

## 方式三：仓库内联调（开发）

```powershell
git clone https://github.com/ShawnSun-Debug/dsh-lean-router.git
cd dsh-lean-router
npm test          # 200 tests / 199 pass / 1 skipped（宿主 yaml-asar 不可读）
npm run doctor    # 7 PASS
npm run build     # 生成 bundle（cordis.patch.yml）
```

## 卸载

```powershell
dsh plugin uninstall dsh-lean-router
npm uninstall -g dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"   # 期望无输出
```

## 要求

| 项 | 值 |
|---|---|
| Node.js | 24（CI 口径；本地 22.12+ 起支持 `require` ESM 包） |
| DSH | `>=0.2.1-rc.5 <0.2.3-0`（`package.json#engines.dsh`） |
| 平台 | Windows / macOS / Linux（CI 在 ubuntu-latest 验证） |

## 排错

| 现象 | 原因 | 处理 |
|---|---|---|
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | 用了未在 `exports` 白名单里的子路径（如 `dsh-lean-router/lean/persona-text`） | 改用已导出的入口：`.`、`./router`、`./toolface`、`./lean/delivery-gate`、`./lean/tool-concurrency`、`./package.json` |
| `--dump-config` 查不到插件 | 未 `dsh plugin install` 或 profile 未启用 | 重新 install 并检查 profile 配置 |
| 测试 1 skipped | 宿主 yaml-asar 不可读（已知限制，静态断言已覆盖） | 无需处理 |
