# Quickstart

> **dsh-lean-router** is one DeepSeek Harness (DSH) cordis plugin card that fuses four mechanisms into a single preset: lean token saving × thinking-chain routing × `code_run` tool masking × automatic invocation of 31 mattpocock skills. This is the English version of [quickstart.md](./quickstart.md); this package documents bilingually with Chinese-first files plus English `.en.md` files.

## Prerequisites

- DSH `>=0.2.1-rc.5 <0.2.3-0` (measured baseline 0.2.2-rc.5; see the engines field in package.json).
- The package is not published to npm yet, so install via a local link (below). DSH is in developer preview; engine drift is handled by the engines gate + doctor self-check + a warn banner, never by silent degradation.

## Install

### Path A: local link (recommended today)

~~~powershell
dsh plugin --profile desktop add "link:D:\path\to\dsh-lean-router"
~~~

After restarting DSH, pick the **Lean router** preset (lean tier) or **Lean router (balance)** (weaker-constraint tier) for new sessions.

### Path B: npm install (once published)

~~~powershell
dsh plugin --profile desktop add npm:dsh-lean-router@1.0.1
~~~

(Both paths match the output of scripts/install.mjs; the real installer, claim boundaries and `--uninstall` rollback belong to ticket 09.)

### Stub behavior when the dependency is missing

The package depends on `@deepseek-ai/dsh-tool-executor-native` (package.json dependencies). If that dependency is not resolved with the package (e.g. a manual directory copy), the tool-masking layer fails loudly instead of silently: the executor degrades to an install-hint stub, and the first `describe` call throws an error containing the install guidance (lib/toolface/executor.js L57-63):

> dsh-lean-router/toolface requires the dependency "@deepseek-ai/dsh-tool-executor-native". Install dsh-lean-router together with its dependencies (dsh plugin add resolves them) or upgrade the package; ...

To fix manually: run `npm install` inside the package directory, or re-add the package via `dsh plugin add` so the host resolves the dependency tree (fixture-path notes come with ticket 09).

## First use

1. Pick the preset: **Lean router** (13 rules + 3 soft gates + routing) or **Lean router (balance)** (3 rules; no routing directive in v1).
2. Optional explicit routing directive in the first real user message:

   ~~~text
   [router] band=spec
   [router] band=react task=slice the landing page into components
   [router] band=auto
   ~~~

   See "Three bands" in [architecture.en.md](./architecture.en.md). Without a directive the task is classified by keywords; ties fall to `weak` (model self-routed).
3. Common commands:
   - `/band`: view or switch the routing band (spec/react/weak/auto).
   - `/skill`: list skills with their invocation flags; `/skill <name>` shows one.
   - `/compact`: trigger context compaction manually (compaction group).
4. Tool masking is automatic: the model's tool list shows preset-owned tools + `code_run` only. MCP and out-of-preset plugin tools are discovered inside a `code_run` program via `tools.code_tools_search(...)` and then called by exact name. Direct calls to masked names are rejected with a hint to search first.

## Health check

~~~powershell
node scripts/doctor.mjs   # 7 structural checks (name/engines/patch/preset row/manifest 31/dirs 31/matrix 13-10-8)
npm run verify            # build --check (cordis.patch.yml byte-identical regeneration) + doctor
npm test                  # node --test test/ (20 test files)
~~~

## Glossary (uniform across the package)

| Term | Meaning |
|---|---|
| lean | The four token-saving mechanisms (turn compaction / output pruning / disabled plugins / discipline persona) plus two add-ons (delivery gate / concurrency marking) |
| masking | Hiding tools the preset does not own from the model's request surface while they stay callable inside programs (toolface layer) |
| routing | Classifying a task into one of three bands and injecting the matching near-field guide (router layer) |
| gating | Scoring all 31 skills every turn and admitting only high scorers into the near-field channel (skillgate layer) |
| band | spec (inspect-and-plan) / react (hands-on production) / weak (model-routed) |
| near-field guide | Fixed text injected via dynamic context: constant within a band, zero-write when unchanged |

## Known v1 status (stated honestly; not promises)

- **Audit panel in progress** (ticket 07): the gate audit channel (in-memory ring buffer + subscription) is ready; the panel UI is not accepted yet.
- The balance preset row carries no routing directive in v1.
- The plan-mode section keeps the flash wording verbatim (including the PTC `run_code` sentence).
- Per-turn gating runs through the injection seam rather than re-calling `list()`: audits are labeled `mode: "fallback-cached-list"` when the host `SkillRegistry.collect()` cache is serving.

See [architecture.en.md](./architecture.en.md), [configuration.en.md](./configuration.en.md) and [changelog.en.md](./changelog.en.md).
