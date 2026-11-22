# Architecture

> One diagram, six layers: **lean → toolface → router → skillgate → audit → panel**, all collapsed into a single cordis plugin card (one preset plus a few top-level rows). English version of [architecture.md](./architecture.md).

## Six-layer diagram

~~~text
┌──────────────────────────────────────────────────────────────────────┐
│                 DSH host (engines >=0.2.1-rc.5 <0.2.3-0)              │
├──────────────────────────────────────────────────────────────────────┤
│ preset preset-lean-router (frag-preset.patch.yml snapshot = sole owner)│
│                                                                      │
│  (1) lean layer (ticket 03)    compaction + delegation groups + persona│
│      - mech 1 turn compaction  thresholdRatio 0.25 / retainTokens 20000│
│      - mech 2 output pruning   8192/4096/1024 (host executes)         │
│      - mech 3 six disabled     delegation group + top tool-plugin-manager│
│      - mech 4 discipline       lean 13 rules + 3 soft gates + hooks /  │
│                                  balance 3 rules                      │
│      - add-on delivery gate    lean-delivery-gate (enabled:false, 2)   │
│      - add-on concurrency      lean-concurrency (glob/grep isConcurrencySafe)│
│  (2) toolface layer (ticket 04)  dsh-lean-router/toolface              │
│      - mask ['mcp__'] + everything outside preset scope; code_run       │
│        transport; four meta tools                                      │
│      - executor: describe() masks + execute() denies direct calls       │
│  (3) router layer (ticket 05)  two instances lean-router-router /      │
│        lean-router-commands                                            │
│      - first-turn [router] band=... capture; band near-field guides;   │
│        /band /skill                                                    │
│  (4) skillgate layer (ticket 06) skill-lean-router provider + per-turn │
│      - score all 31 -> tier -> ds-* arbitration -> 8k soft degrade ->   │
│        near-field render                                               │
│  (5) audit (ticket 07, in flight)  in-memory ring buffer (256) + subs  │
│  (6) panel (ticket 07, in flight)  ui/go.json panel card (in progress) │
└──────────────────────────────────────────────────────────────────────┘
~~~

### (1) lean layer (lib/lean/, parameters + pure-function ports; execution lives in host plugins)

- **Mech 1, turn compaction**: lib/lean/compaction.js L20-25 pins the tuning `thresholdRatio: 0.25, retainTokens: 20000, compactionRetries: 1, auto: true` (copied from the flash measurements); actual compaction is done by the host `@deepseek-ai/dsh-compaction-basic`. The host default is 0.8 (an 800k trigger on a 1M window); lean uses 0.25 = 250k. Measured 2026-11-09 over 109 runs: peak context median 20k, max 126k — this knob is currently a safety net, not the token saver (cordis.patch.yml L197-200 comment, same text at frag-lean.patch.yml L147-150).
- **Mech 2, output pruning**: lib/lean/pruner.js L22-26 pins `thresholdChars: 8192, headChars: 4096, tailChars: 1024`; keep head (structure) + tail (conclusion), replace the middle with a fixed marker (`PRUNE_MARKER`, L19). Execution belongs to the host `dsh-compaction-tool-result-pruner`; `pruneText()` is a same-criteria pure-function port.
- **Mech 3, six disabled plugins**: lib/lean/disabled.js L16-23 lists `tool-subagent-codex`, `tool-subagent-claude-code`, `workflow-ptc`, `tool-workflow`, `tool-ralph`, `tool-plugin-manager`; `disabled: true` rows do not load and their schemas never reach the system prompt.
- **Mech 4, discipline persona**: lib/lean/persona-text.js — lean tier: 13 hard rules + 3 soft gates (CLARIFY→PLAN→DELIVER) + self-check hooks (diligence ~every 10 turns / close-the-book); balance tier: 3 rules. Rule 7 drops the flash-only "run_code is the only tool" clause (this package is native+code_run); everything else is verbatim.
- **plan-mode v1**: lib/lean/plan-mode.js is a line-for-line copy of the flash section (L93-107); the trailing PTC `run_code` sentence is **kept verbatim** (v1 ruling, see changelog).
- **Add-on, delivery gate**: lib/lean/delivery-gate.js — when the workspace has verify.ps1/verify.sh, the harness runs it when a turn stops; on failure it steers back the tail output, at most `maxRounds` (default 2) times per session; at least `MIN_GAP_MS = 15000` between runs (L55); off by default (`enabled: false`; `DSH_DELIVERY_GATE=0/1` overrides); with the host `dsh-llm` package missing, scripts still run and the steer-back is explicitly skipped.
- **Add-on, concurrency marking**: lib/lean/tool-concurrency.js — adds `isConcurrencySafe = () => true` to the registered glob/grep definitions so native multi-calls truly parallelize; 500ms fast sweep (first 60s) then a 5s backstop; disable with `DSH_LEAN_ROUTER_CONCURRENCY=0` (also accepts `DSH_FLASH_PRESETS_CONCURRENCY=0`).

### (2) toolface layer (lib/toolface/, vendored codemode 0.3.0 @ f9758ec)

Four jobs (lib/toolface/index.js L17-27): register the discovery tools, register the `code_run` transport, install the masking executor, and supply the Code Mode instructions.

- **Masking rules**: rules.js L16 `DEFAULT_HIDDEN_PREFIXES = ['mcp__']`; L19 the four meta tools `code_tools_list / code_tools_search / code_tools_describe / code_debug`; L45 `DEFAULT_RUN_TOOL_NAME = 'code_run'` (`run_code` is reserved by DSH and the registry refuses to register it); L69 `maxParallelSubCalls: 10`. A second, scope-based rule (`nativeScope: true`) masks everything outside the preset scope (global MCP/bundles, per-agent tool sets).
- **Three-view attribution**: scope.js L87-113 resolves global/preset/agent name sets through the registry's public `get(name, scope)` to answer "does the preset own this tool?"; without a scope tag attribution is inert and only the name rules apply.
- **Executor seam**: executor.js L124-188 — `describe()` filters with `isMaskedName` before delegating (the request surface = preset composition + transport); `execute()` denies model-direct calls to masked names **before dispatch**, hinting `code_tools_search` (L226-228); `code_run` itself is always allowed (L222). Program sub-calls are admitted via the `Symbol.for('dsh-codemode.nested')` signal marker plus the `:ptc:` call-id suffix (L92-97).
- **Transport**: transport.js — the `code_run` tool hands the TypeScript program to the `ptcRuntime` service; sub-calls go through the registry's public `execute()` with the full pipeline (validation/policy/approval), and pool.js reproduces the ordering contract (parallel cap 10, exclusive barrier); `abandon()+drain()` at program end stops late sub-calls (L317-323).
- **Retention**: retention.js — retained REPL environments are tracked per (agent, provider) with two cleanup layers (agent-scope effect + plugin-scope dispose), making the leak unrepresentable.
- **Missing-dependency stub**: see "Stub behavior" in [quickstart.en.md](./quickstart.en.md).

### (3) router layer (lib/router.js + lib/bands.js)

- **Three bands**: bands.js L10 `BAND_IDS = ["spec","react","weak"]`. spec = inspect-and-plan (read-first, narrow); react = hands-on-production (write-first, wide); weak = model-routed (the only inner-routing window, few-shot classification). The ideas are ported from routing-suite measurements (V4.1 Flash: neutral + classify few-shot + three anchors = 96% routing, 100% single-task completion); the **implementation is rewritten, no upstream code copied**.
- **Explicit directive**: bands.js L114-124 parses `[router] band=<spec|react|weak|auto> [task=...]`; `auto` clears the override and returns to automatic classification.
- **First-turn capture**: router.js L234 listens on `agent/inbox/claimed` and only accepts `message.source.kind === 'user'`; once routed, the band is kept (keywords never change it).
- **Near-field guide**: router.js L237-245 registers the dynamic context `lean-router:guide` (order 220); text is constant within a band → the host's equality check makes it a zero-write → cache stays warm. It deliberately avoids the pre-step append channel (which would durably write history).
- **Diligence self-check**: `diligenceEvery` defaults to 10 (L36); the turn number is embedded so text only changes when the check fires.
- **Commands**: `/band`, `/skill` (L249-260); the preset mounts two instances: `lean-router-router` (hooks:true, commands:false, diligenceEvery:10) + `lean-router-commands` (hooks:false, commands:true) (frag-router.patch.yml).
- **Inherited sessions**: `skipInherited` defaults to true — subagents/forks with inherited history skip routing.

### (4) skillgate layer (lib/skillgate.js + lib/skill-provider.js)

- **Provider**: skill-provider.js L22 `DEFAULT_RANK = 350` (overrides the default 400 of ~/.dsh/skills so this package owns same-named skills' invocation flags). Two-tier sources: same-named skills prefer `~/.dsh/skills` (tier user), falling back to the `assets/skills` copies (tier bundled); invocation always follows `assets/skills.matrix.json` (model/user flags decided by the owner).
- **Gate off = nothing changes**: `list()` returns all 31 skills by default; gating only engages when the caller passes `list({ leanGate: state })` explicitly (L141-147).
- **Per-turn pipeline** (skillgate.js L286-331): `scoreSkills` (score all 31: signal A scenario mapping + complexBoost + signal B keyword hits +1 each) → `classifyTiers` (`autoScore 2` / `hintScore 1`, L44-45) → `arbitrate` (when ds-* are active, engineering-scene mattpocock skills drop auto→hint, L55-58) → `degrade` (when the injection estimate exceeds `tokenBudget 8000` (L46), low-score autos drop to hint; no count cap) → `renderAdmission` (English near-field text on the `lean-router:skills` channel) → audit trail.
- **Cache fallback**: the host `SkillRegistry.collect()` caches per (cwd, scopeChain, revision) and calls `provider.list()` only on a miss — so per-turn gating runs through the injection seam instead of re-calling list, and audit entries carry `mode: "fallback-cached-list"` (L311).
- **Audit**: `AUDIT_FORMAT_VERSION = 1` (L26); `createAuditChannel` (L250-279) is an in-memory ring buffer (default 256) with subscriptions, **not persisted** — panel consumption belongs to ticket 07.

### (5) audit + (6) panel (ticket 07, in flight)

- Audit side: attaching the skillgate decision stream to a sink and persisting the audit JSONL is ticket 07's in-flight work; the v1 code ships the in-memory channel described above.
- Panel side: the `ui/go.json` panel card (decision rows + collapsed full-score table + token comparison + warning banner) is **in progress, not accepted**; this ticket (08) does not touch `ui/**`.

## Preset rows and patch assembly

- scripts/build-bundle.mjs concatenates HEADER + presets/base/lean-router.patch.yml + `frag-lean → frag-toolface → frag-router → frag-preset` into the root cordis.patch.yml (847 lines); `npm run build -- --check` verifies it byte-identically in reverse.
- **frag-preset.patch.yml is the sole effective preset row** (master's integration product, generated by scripts/integrate-preset.mjs): cordis patches replace preset rows as whole keys, so the same-id overrides in frag-lean/frag-toolface wipe each other; frag-preset folds the base 12 rows + lean rows + toolface row into one union snapshot and is declared last. Its lean persona suffix already has ROUTER_PROMPT spliced in (Routing: before acting on any new task, classify it...).
- **Balance row** (inserted by frag-lean) has 3 rules and **no routing directive** in v1 (its suffix ends with a placeholder comment).
- Beyond the preset there are 4 top-level rows: `lean-delivery-gate` (enabled:false, maxRounds:2), `lean-concurrency` (enabled:true), `lean-router-router`, `lean-router-commands`.

## Directory index

| Path | Contents |
|---|---|
| lib/index.js | cordis plugin entry (skill provider mount, rank 350) |
| lib/lean/ | 8 lean-layer modules (parameters/pure functions/plugin objects) |
| lib/toolface/ | 8 toolface-layer modules (vendored codemode) |
| lib/router.js, lib/bands.js | router layer |
| lib/skillgate.js, lib/skill-provider.js | gate + provider |
| presets/base/ | 1 template + 4 fragments (frag-lean/frag-toolface/frag-router/frag-preset) |
| scripts/ | build-bundle / check-drift / doctor / integrate-preset / install / verify |
| assets/skills/ + skills.matrix.json + skills.manifest.json | 31 bundled skill copies and the model/user matrix |
| test/ | 20 test files |
| docs/ | bilingual docs (this directory) + 4 Chinese design notes (from upstream tickets, kept in Chinese) |
| ui/ | ticket 07 panel (in progress; untouched by this ticket) |
