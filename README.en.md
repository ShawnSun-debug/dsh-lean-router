# dsh-lean-router

[![CI](https://github.com/ShawnSun-Debug/dsh-lean-router/actions/workflows/ci.yml/badge.svg)](https://github.com/ShawnSun-Debug/dsh-lean-router/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE) [![Node](https://img.shields.io/badge/node-24-brightgreen.svg)](https://nodejs.org)

A DeepSeek Harness (DSH) cordis plugin tuned for DeepSeek V4.1 Flash: **one plugin card** fusing six layers — the lean token-saving four mechanisms (flash-presets measured tuning), `code_run` tool masking (the codemode seam), thinking-chain routing across three bands (routing-suite ideas), gated auto-invocation of 31 mattpocock skills, an audit channel and a (in-progress) panel.

> This package documents bilingually with the **"Chinese default + English `.en.md` files"** scheme: Chinese is the first language (README.md and docs/*.md), English lives in same-directory `.en.md` files (this file ↔ [README.md](./README.md)). All three upstream projects follow the same "Chinese README + README.en.md" convention.

> Status: **v1.0.4 published** (npm: [dsh-lean-router](https://www.npmjs.com/package/dsh-lean-router) · GitHub Release [v1.0.4](https://github.com/ShawnSun-debug/dsh-lean-router/releases/tag/v1.0.4) · CI green; real-machine DSH profile install smoke record: [docs/release-checklist.md](docs/release-checklist.md)).

## Layers at a glance

| Layer | Modules | One line |
|---|---|---|
| lean (ticket 03) | lib/lean/ | turn compaction 0.25/20000 · output pruning 8192/4096/1024 · six disabled plugins · dual-tier discipline (lean 13 + 3 soft gates / balance 3) + delivery gate + glob/grep concurrency marking |
| toolface (ticket 04) | lib/toolface/ | tools outside the preset (MCP etc.) are hidden from the request surface, discovered via `code_tools_search` inside programs; the `code_run` transport |
| router (ticket 05) | lib/router.js · lib/bands.js | spec/react/weak bands + the `[router] band=` directive + near-field guides (zero-write) + /band /skill |
| skillgate (ticket 06) | lib/skillgate.js · lib/skill-provider.js | scores all 31 skills per turn -> tier -> ds-* arbitration -> 8k soft degrade -> near-field mount/hint |
| audit (ticket 07, in flight) | audit channel in lib/skillgate.js | in-memory ring buffer (256) + subscription; JSONL persistence and the ui panel are in flight |
| panel (ticket 07, in flight) | ui/ | panel card (decision rows + score table + token comparison + banner), **not accepted yet** |

## Target DSH

engines: `>=0.2.1-rc.5 <0.2.3-0` (measured baseline 0.2.2-rc.5). DSH is in developer preview; breaking changes are handled by the engines gate + the doctor self-check + a warn banner, never by silent degradation.

## Install

Not published yet; start with a local link (both paths in [docs/quickstart.en.md](docs/quickstart.en.md)):

~~~powershell
dsh plugin --profile desktop add "link:D:\path\to\dsh-lean-router"
# once published: dsh plugin --profile desktop add npm:dsh-lean-router@1.0.4
~~~

The package depends on `@deepseek-ai/dsh-tool-executor-native`; if missing, the masking layer fails loudly — the executor stub throws an error with install guidance on the first `describe` (lib/toolface/executor.js L57-63). Follow it with `npm install` or re-add via `dsh plugin add`.

## Quick start

1. Restart DSH, pick the **Lean router** preset (or **Lean router (balance)**) for new sessions.
2. Optional: start the first message with `[router] band=spec|react|weak|auto [task=<one line>]`.
3. Commands: `/band` to view/switch the band, `/skill` to list skills, `/compact` for manual compaction.
4. Health check: `node scripts/doctor.mjs` (7 checks) -> `npm run verify` (includes the build --check reversal check; 8 gates together with doctor) -> `npm test`.

## Documentation

Five topics bilingual (Chinese default, `*.en.md` in English):

| Topic | Chinese | English |
|---|---|---|
| Quickstart | [docs/quickstart.md](docs/quickstart.md) | [docs/quickstart.en.md](docs/quickstart.en.md) |
| Architecture | [docs/architecture.md](docs/architecture.md) | [docs/architecture.en.md](docs/architecture.en.md) |
| Configuration | [docs/configuration.md](docs/configuration.md) | [docs/configuration.en.md](docs/configuration.en.md) |
| Skill matrix | [docs/matrix.md](docs/matrix.md) | [docs/matrix.en.md](docs/matrix.en.md) |
| Changelog | [docs/changelog.md](docs/changelog.md) | [docs/changelog.en.md](docs/changelog.en.md) |

The 4 Chinese design notes from earlier tickets stay in docs/: [routing](docs/路由-设计说明.md) · [skill gating](docs/技能门控-设计说明.md) · [tool masking wiring](docs/工具遮蔽-接线说明.md) · [disabled-plugin review](docs/复核-关插件清单.md).

## v1 status (stated honestly)

- **Audit panel in flight** (ticket 07): the audit channel is ready; the `ui/go.json` panel is not accepted yet.
- **The balance preset row carries no routing directive** (v1 ruling; the lean row already has ROUTER_PROMPT spliced in).
- **The plan-mode section keeps the flash wording verbatim** (including the PTC `run_code` sentence).
- **Gate fallback mode**: when the host skill-registry cache is serving, per-turn gating runs through the injection seam and audits are labeled `mode: "fallback-cached-list"`.
- **8k soft degradation**: when the gate injection estimate exceeds `tokenBudget 8000`, low-score skills drop a tier with no count cap.
- **Sole effective preset row**: the frag-preset.patch.yml union snapshot is the only effective preset row (cordis patches replace preset rows as whole keys).

## License and acknowledgments

MIT, see [LICENSE](LICENSE). The four-upstream contribution map and license statements are in [NOTICE.md](NOTICE.md): dsh-flash-presets (LarryE135) · dsh-codemode (dsh-codemode contributors) · dsh-routing-suite (yjh051108) · mattpocock skills (the 31 skill bodies).
