# Changelog

> English version of [changelog.md](./changelog.md). Versions follow package.json (currently 1.0.3).

## 1.0.3 (2026-11-22)

- Fix (fatal on a real host): the preset's plugins list wrongly carried the **host-level service plugin** `ptc-runtime` (`@deepseek-ai/dsh-ptc-runtime-node`). A preset activates in its own scope, so mounting that service twice fails → `agentPresets.register` throws → the whole `preset-lean-router` is never registered (observed: only balance was listed). The host already mounts the row in `dsh-base/cordis.patch.yml` L407-408, and `code_run`'s `ctx.get('ptcRuntime')` resolves upward, so the preset must not declare it.
- Change: the `frag-preset` union drops from 22 to 21 rows (overrides 20 + toolface); `cordis.patch.yml` rebuilt.
- Add: `integration-preset` and `patch-yaml` now assert `ptc-runtime` never appears inside a preset.

## 1.0.2 (2026-11-22)

- Fix (fatal on a real host): `lib/lean/tool-concurrency.js` had `apply()` return a plain object; cordis validates an apply's return value as an effect and accepts only a dispose function / null / undefined / thenable, so the host threw `Invalid effect` — the plugin showed as "error" and the `preset-lean-router` row declared after it in the same overlay was never registered (only balance appeared in the preset list).
- Add: one "apply's return value must satisfy the cordis effect contract" assertion in each of the `tool-concurrency` / `delivery-gate` / `router` / `toolface` suites.

## 1.0.1 (2026-11-22)

- Fix: `cordis.patch.yml` had a mis-indented `ptc-runtime` row (dsh refused to parse the overlay; installs rolled back).
- Fix: `npm test` uses `node --test "test/*.test.mjs"` (directory argument breaks on Node 24).
- Add: regression test parses every patch with js-yaml and the `!!js` tag, matching dsh's overlay loader.
- Chore: js-yaml added as a devDependency; version references bumped.

## v1.0.0 (2026-11-21)

All six layers of one plugin card have landed (tickets 02-06 delivered + master integration); the audit panel (ticket 07) is in flight and the real installer (ticket 09) is pending.

### Added

- **Lean layer, four mechanisms** (ticket 03, lib/lean/): turn compaction (thresholdRatio 0.25 / retainTokens 20000 / retries 1 / auto), output pruning (8192/4096/1024 + marker), six disabled plugins (the disabled list), the dual-tier discipline persona (lean 13 rules + 3 soft gates + self-check hooks / balance 3 rules); add-ons delivery-gate (off by default, 2 rounds) and the glob/grep concurrency marker (on by default).
- **plan-mode v1 folded in** (lib/lean/plan-mode.js): a line-for-line copy of flash L93-107.
- **Toolface layer** (ticket 04, lib/toolface/): vendored dsh-codemode 0.3.0 (main @ f9758ec), 8 modules file-for-file with adaptation points annotated; masking of ['mcp__'] + everything outside the preset, the code_run transport, four meta tools, direct-call denial, retention dual cleanup, maxParallelSubCalls 10.
- **Router layer** (ticket 05, lib/router.js + lib/bands.js): spec/react/weak bands, the [router] explicit directive, keyword auto-classification, near-field guides (lean-router:guide, order 220), the diligence self-check (every 10 turns), /band and /skill commands, inherited-session skip.
- **Skillgate layer** (ticket 06, lib/skillgate.js + lib/skill-provider.js): per-turn scoring of all 31 skills (scenario mapping + keyword dual signals), autoScore 2 / hintScore 1 tiering, ds-* scene arbitration, tokenBudget 8000 soft degradation, near-field rendering, the in-memory audit ring buffer, the rank-350 provider, two-tier source resolution.
- **31 bundled skill copies** (assets/skills/ + skills.matrix.json + skills.manifest.json): the owner-decided model/user matrix (13 both / 10 model-only / 8 user-only).
- **Build & checks** (scripts/): build-bundle (base + 4 fragments into cordis.patch.yml), check-drift (warn-only), doctor (7 checks), integrate-preset (generates the frag-preset union snapshot), verify (build --check + doctor), install (prints install steps).
- **Four exports subpaths** (package.json): ./router, ./toolface, ./lean/delivery-gate, ./lean/tool-concurrency.
- **Bilingual docs** (this directory + README.md/README.en.md/NOTICE.md): the five topics bilingual and the four-upstream acknowledgment table (ticket 08).

### Rulings (recorded as v1 facts)

- **The frag-preset union snapshot is the sole effective preset row**: cordis patches replace preset rows as whole keys, so the same-id overrides in frag-lean/frag-toolface wipe each other; scripts/integrate-preset.mjs generates the union snapshot and is declared last in FRAGMENTS.
- **The balance preset row carries no routing directive for now**: the lean row's suffix already has ROUTER_PROMPT spliced in; the balance row keeps the placeholder comment line.
- **The plan-mode PTC sentence keeps the flash wording**: the trailing "Under programmatic tool mode ... run_code" sentence is unchanged (master ruling: run_code remains the built-in PTC transport).
- **Gating runs through the injection seam instead of re-calling list()**: when the host SkillRegistry.collect() cache is serving, audits are labeled mode "fallback-cached-list".
- **8k soft degradation**: tokenBudget 8000 with no count cap — only a total-volume soft guard.

### Engine and dependencies

- engines: `>=0.2.1-rc.5 <0.2.3-0` (measured baseline 0.2.2-rc.5).
- dependencies: `@deepseek-ai/dsh-tool-executor-native ^0.2.2-alpha.3` — when missing, the executor degrades to an install-hint stub (describe throws / execute rejects), never silent.

### In flight (not promised by this release)

- Ticket 07: persisting the audit JSONL, the ui/go.json panel card (decision rows + score table + token comparison + warning banner), hit statistics + manual weight configuration.
- Ticket 09: the real installer, fixture-path notes, --uninstall rollback.
