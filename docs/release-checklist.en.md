# Release checklist · dsh-lean-router v1.0.0

> Owner-manual steps only. The release subagent must **never** run `npm publish`, `npm login` or `git push` (ledger constraints/forbidden).
> Chinese version: [release-checklist.md](./release-checklist.md).

Package `dsh-lean-router` · version `1.0.0` · repo https://github.com/ShawnSun-Debug/dsh-lean-router

## 0. Pre-flight (already verified, re-runnable)

| Check | Command | Pass |
|---|---|---|
| Tests | `npm test` | `tests 200 / pass 199 / fail 0 / skipped 1` |
| Doctor | `npm run doctor` | 7 PASS |
| Build | `npm run build -- --check` | PASS, no rewrite |
| Drift | `npm run drift` | no drift |
| CI YAML | `python -c "import yaml; yaml.safe_load(open(r'.github/workflows/ci.yml', encoding='utf-8')); print('YAML_OK')"` | prints `YAML_OK` |
| Pack smoke | `npm pack` → temp dir `npm i <tgz>` → `node -e "require('dsh-lean-router')"` | installs, 3 exports |

> **Confirm the name before publishing**: `npm view dsh-lean-router version` reaches the registry and returns `E404 Not found` (name currently unpublished). Re-confirm before the real publish.

## 1. npm login (manual)

```powershell
npm login
npm whoami            # verify: prints your npm username
npm config get registry
```

## 2. Publish (manual, irreversible)

```powershell
cd "D:\Agent Workspace\dsh-lean-router"
npm test              # final gate: 200/199/0/1
npm publish
```

Verify: `npm view dsh-lean-router version` → `1.0.0`; `npm view dsh-lean-router dist.tarball`.
Rollback: `npm unpublish dsh-lean-router@1.0.0` (within 72h) or `npm deprecate`.

## 3. Remote + push (manual)

```powershell
git remote add origin https://github.com/ShawnSun-Debug/dsh-lean-router.git
git branch -M main
git push -u origin main
```

Verify: `git remote -v`, `git ls-remote --heads origin main`. CI (`.github/workflows/ci.yml`) then runs on ubuntu-latest + node 24.

## 4. Tag + GitHub Release (manual)

```powershell
git tag -a v1.0.0 -m "dsh-lean-router v1.0.0"
git push origin v1.0.0
gh release create v1.0.0 --title "v1.0.0" --notes-file docs/changelog.md
```

Verify: `git tag -l "v1.0.0"`, `gh release view v1.0.0`.

## 5. DSH profile install smoke (manual)

```powershell
dsh plugin install dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"
dsh plugin uninstall dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"   # expect no output
```

Pass: install exits 0; `--dump-config` shows `skill-lean-router`; after uninstall it disappears with no leftover files. Do not restart a running DSH app.

## Scope guard

No changes to `D:\Deepseek Harness`, `lib/`, `test/`, `engineer-mode`, `engineer-lean`. Published content = `package.json#files` allowlist only.
