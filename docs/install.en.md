# Install · dsh-lean-router

> English companion of [install.md](./install.md). Release steps live in [release-checklist.en.md](./release-checklist.en.md).

## Option 1: global npm install + DSH mount (recommended)

```powershell
npm i -g dsh-lean-router
dsh plugin install dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"
```

## Option 2: local tarball (offline / pre-release self-test)

```powershell
npm pack                                  # produces dsh-lean-router-1.0.0.tgz
npm i -g .\dsh-lean-router-1.0.0.tgz
dsh plugin install dsh-lean-router
```

Import smoke (no conversation needed):

```powershell
node -e "const m=require('dsh-lean-router'); console.log(Object.keys(m))"
# => [ 'apply', 'inject', 'name' ]
```

## Option 3: in-repo development

```powershell
git clone https://github.com/ShawnSun-Debug/dsh-lean-router.git
cd dsh-lean-router
npm test          # 200 tests / 199 pass / 1 skipped (host yaml-asar unreadable)
npm run doctor    # 7 PASS
npm run build     # generate bundle (cordis.patch.yml)
```

## Uninstall

```powershell
dsh plugin uninstall dsh-lean-router
npm uninstall -g dsh-lean-router
dsh --dump-config | Select-String "skill-lean-router"   # expect no output
```

## Requirements

| Item | Value |
|---|---|
| Node.js | 24 (CI baseline; 22.12+ locally for `require` of ESM packages) |
| DSH | `>=0.2.1-rc.5 <0.2.3-0` (`package.json#engines.dsh`) |
| Platform | Windows / macOS / Linux (CI verifies ubuntu-latest) |

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `ERR_PACKAGE_PATH_NOT_EXPORTED` | Subpath not in the `exports` allowlist (e.g. `dsh-lean-router/lean/persona-text`) | Use exported entries: `.`, `./router`, `./toolface`, `./lean/delivery-gate`, `./lean/tool-concurrency`, `./package.json` |
| Plugin missing from `--dump-config` | Not installed via `dsh plugin install`, or profile disabled | Reinstall and check profile config |
| 1 skipped test | Host yaml-asar unreadable (known limitation, static assertions cover it) | Nothing to do |
