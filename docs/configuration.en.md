# Configuration reference

> Three blocks: **gate weights**, **audit**, **commands & environment variables**. All configuration flows in through patch-row configs; unknown keys throw (fail early). Chinese original: [configuration.md](./configuration.md).

## Gate weights (lib/skillgate.js)

The default gate config lives in `DEFAULT_GATE_CONFIG` (skillgate.js L43-59), validated by `resolveGateConfig` (L64-98, unknown keys throw):

| Key | Default | Meaning |
|---|---|---|
| autoScore | 2 | score >= autoScore -> auto (near-field auto-mount) |
| hintScore | 1 | hintScore <= score < autoScore -> hint (near-field hint); requires autoScore >= hintScore |
| tokenBudget | 8000 | soft cap on the injection estimate; over-budget low-score autos drop to hint (no count cap) |
| charsPerToken | 4 | token estimate denominator (about 4 chars/token) |
| maxTaskTextChars | 4000 | truncation length of task text used for scoring |
| sceneMap | react: engineering+2/process+1; spec: engineering+2/research+1; weak: {} | Signal A: band -> scenario points |
| complexBoost | engineering: 1 | added when isComplexTask fires |
| arbitration | engineering prefer ds; process prefer mattpocock | ds-* scene arbitration table |

Score formula: `score = scenePoints + complexBoost + keyword hit count` (each matched keyword adds +1, counted per keyword not per occurrence, skillgate.js L124-153).

Arbitration only demotes tiers and never flips invocation: when ds-* skills are active, mattpocock skills in `prefer: "ds"` scenes drop auto->hint (L161-178).

Soft degradation: `degrade` demotes autos to hints in ascending score order (ties broken by name, deterministic) until the estimate fits tokenBudget (L203-222). **The 8k soft degradation is v1 behavior.**

Gate config path: `makeProvider({ gateConfig })` (skill-provider.js L138) — the `skill-lean-router` patch row's options flow into `lib/index.js apply(ctx, options)` (currently only `rank`; every gateConfig key is configurable via the patch row's config).

## Audit

- Format version: every entry carries `v: 1` (`AUDIT_FORMAT_VERSION`, skillgate.js L26; format changes must bump it).
- Channel: `createAuditChannel({ capacity })` — in-memory ring buffer (default 256 entries) with `push/entries/drain/subscribe` (L250-279). **Not persisted.**
- Injection: `makeProvider({ audit })` (skill-provider.js L117 comment: the audit channel is injected via makeProvider, consumed by ticket 07).
- Entry shape (`round()`, L313-328): `v / ts / kind:"skillgate-round" / turn / task{band,complex,head} / config{autoScore,hintScore,tokenBudget,charsPerToken} / dsActive / scores (all 31, score + signals) / decision (admitted sets + arbitrations + degradations + estTokens) / estimateText`; decision.mode is always `"fallback-cached-list"` (L311).
- **Audit panel (ticket 07) is in progress**: persisting the audit JSONL (gate decision stream to a sink) and the `ui/go.json` panel card (decision rows + collapsed full-score table + token comparison + warning banner) belong to ticket 07's in-flight work; v1 makes no promise about them.

## Commands and environment variables

### npm scripts (package.json)

| Command | Purpose |
|---|---|
| npm test | node --test test/ (20 test files) |
| npm run build | re-assemble cordis.patch.yml (base + 4 fragments in fixed order) |
| npm run drift | drift check between assets/skills copies and ~/.dsh/skills (warn-only) |
| npm run doctor | 7 structural self-checks (below) |
| npm run verify | build --check (cordis.patch.yml byte-identical regeneration) + doctor |

doctor's 7 checks: package.name, package.engines.dsh, cordis.patch.yml exists, patch contains the preset row, manifest has 31 skills, assets/skills has 31 directories, matrix counts 13/10/8 (scripts/doctor.mjs L12-24).

### Session commands

| Command | Layer | Meaning |
|---|---|---|
| /band | router | view/switch band; `/band spec`, `/band auto`, `/band react task <one line>` |
| /skill | router | list skills with [model/user] flags; `/skill <name>` for details (provider/source/resource dir) |
| /compact | lean | trigger context compaction manually |

### First user message directive

~~~text
[router] band=spec|react|weak|auto [task=<one line>]
~~~

Explicit directives take precedence over keyword classification (human in the loop); `auto` clears the override and returns to automatic.

### Environment variables

| Variable | Effect |
|---|---|
| DSH_DELIVERY_GATE=0 | force the delivery gate off |
| DSH_DELIVERY_GATE=1 | force on when config.enabled is absent |
| DSH_LEAN_ROUTER_CONCURRENCY=0 | disable concurrency marking (also accepts DSH_FLASH_PRESETS_CONCURRENCY=0) |

## Plugin-row config summary (patch row -> module)

| patch row id | name | config keys | defaults |
|---|---|---|---|
| lean-router-router | dsh-lean-router/router | diligenceEvery / hooks / commands / guideOrder / skipInherited | 10 / true / false / 220 / true (router.js L134-147) |
| lean-router-commands | dsh-lean-router/router | same keys | 10 / false / true / 220 / true |
| lean-delivery-gate | dsh-lean-router/lean/delivery-gate | enabled / scripts / maxRounds / timeoutMs / tailChars | false / [verify.ps1,verify.sh] / 2 / 900000 / 1200 (delivery-gate.js L191) |
| lean-concurrency | dsh-lean-router/lean/tool-concurrency | toolConcurrency{enabled, tools, sweepMs} | true / [glob,grep] / 500 |
| toolface | dsh-lean-router/toolface | hiddenPrefixes / metaTools / runToolName / guard / sdkSection / debug / searchLimit / maxDescriptionChars / maxParallelSubCalls / nativeScope / nativeTools / hiddenTools | ['mcp__'] / four meta / code_run / true / true / true / 8 / 240 / 10 / true / [] / [] (frag-preset.patch.yml L236-263 lists all explicitly) |

Toolface config validation: normalizeConfig (rules.js L88-125; a metaTools list shorter than 2 falls back to the defaults wholesale).

## exports subpaths (package.json)

`.` / `./package.json` / `./router` / `./toolface` / `./lean/delivery-gate` / `./lean/tool-concurrency` — the four feature subpaths back the `name` fields of the router instances and the two add-on plugin rows (`dsh-lean-router/router` etc.).
