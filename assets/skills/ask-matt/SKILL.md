---
name: ask-matt
description: Ask which /command fits your situation. A router over the installed skills, all of which are invoked by the user, never by the model.
disable-model-invocation: true
user-invocable: true
---

# Ask Matt

You don't remember every skill, so ask. Describe the situation and get back **one next `/command` to type**, and why.

Every skill in this set is **user-invoked**: none of them appear in the model's catalog and the model cannot load one on its own. Only the user typing `/name` brings a skill in. That shapes how this router works:

- Recommend **one command per step**, named exactly, so the user can type it.
- When a skill needs another one, its body points at a file (for example `../tdd/SKILL.md`) that you can read directly. Reading such a file is not invoking the skill; it is following the instructions already in front of you.
- Before describing what a skill does or recommending that a step be skipped, read that skill's `SKILL.md`. The summaries here are for orientation only.

A **flow** is a path through the skills. Most paths run along one **main flow**, and a few **on-ramps** merge onto it.

## The main flow: idea → ship

1. **`/grilling`** sharpens the idea by interview. With `--docs` it is stateful: decisions land in `GLOSSARY.md` and ADRs as you go. Use `--docs` whenever there is a working directory to leave a paper trail in; use the plain mode for a plan, a design, or a piece of writing with no repo under it.
2. **Branch: can you settle every question in conversation?** If a question needs a runnable answer (state, business logic, a UI you have to see), detour through a prototype:
   - **`/handoff`** out, then open a fresh session against that file,
   - **`/prototype`** to answer the question with throwaway code,
   - **`/handoff`** back what you learned, and reference it from the original idea thread.
3. **Branch: is this a multi-session build?**
   - **Yes** → **`/to-spec`** (turn the thread into a spec), then **`/to-tickets`** to split it into tracer-bullet tickets, each declaring its **blocking edges**.
   - **No** → **`/implement`** right here, in the same context window.
4. **`/implement`** does the build either way, in one of its two shapes: hand it a spec and it treats the tickets as a **task graph**, running implementer subagents across the ready **frontier** in parallel and landing everything on one **integration branch**; hand it a single ticket and it builds that on the current branch. Both drive `/tdd` (one red-green slice at a time) and close with `/code-review`.
5. **`/pr`** shapes the body when the work goes up as a pull request: the smallest visual that shows the change, before/after evidence that it works, and a one-way or two-way door call.
6. **`/retro`** closes the loop. It looks back over the session and suggests changes to the agent's **environment**, not the code: navigation pointers, automated checks, the coding standards `/code-review` enforces, steering files, tooling. Mechanical mistakes become deterministic checks; judgement calls become coding standards.

Reach for **`/tdd`** on its own when you just want to build one concrete behaviour test-first without a spec, and **`/code-review`** on its own whenever you want a branch or PR reviewed against a fixed point.

### Context hygiene

Keep the grilling, the spec, and the tickets in **one unbroken context window** so they build on the same thinking. Each `/implement` then starts fresh from the ticket. Run `/retro` in the session it looks back on, before you clear.

The limit is the window in which the model still reasons sharply (roughly 150k tokens for current models). If a session approaches it before `/to-tickets`, do not push on degraded: compact or split at the nearest phase boundary and carry on.

## On-ramps

A starting situation that generates work, then merges onto the main flow.

- **Bugs and requests piling up** → **`/triage`**. It moves issues through triage roles and produces agent-ready issues, which `/implement` later picks up. Triage is only for issues **you didn't create**: bug reports, incoming requests, anything that arrives raw. Tickets that `/to-tickets` produced are already agent-ready, so don't triage them.
- **Something's broken** → **`/diagnosing-bugs`**. For the hard ones: the bug that resists a first glance, the intermittent flake, the regression that crept in between two known-good states. It refuses to theorise until it has a **tight feedback loop** (one command that already goes red on *this* bug), then fixes with a regression test. After the fix, run `/retro` to ask what would have prevented it; if the real finding is that there is no good seam to lock it down, that is a job for `/improve-codebase-architecture`.
- **A huge, foggy effort, too big for one session** → **`/wayfinder`**, the most cognitively demanding flow here. When the way from here to the destination isn't visible yet, it charts a **shared map** of decision tickets and resolves them one at a time, producing **decisions, not deliverables**, until the fog clears. Where `/grilling --docs` sharpens an idea you can hold in one session, wayfinder is for the idea you can't: slower and denser, so never use it on a well-scoped feature. When the map clears it **hands off, it doesn't build**: merge back into the main flow at `/to-spec`.
- **You have a spare moment to keep the codebase healthy** → **`/improve-codebase-architecture`**. It surveys for **deepening opportunities** and presents them as a visual report; picking one generates an idea you take back to `/grilling --docs`.

## Vocabulary underneath

Two references that run *beneath* the other skills, each the single source of truth for its vocabulary. Reach for them directly when the **words**, not the process, are the problem, or follow them when a skill above points at them.

- **`/domain-modeling`**: sharpen the project's *domain* language: challenge a fuzzy term, resolve an overloaded word ("account" doing three jobs), record a hard-to-reverse decision as an ADR. This is the discipline `/grilling --docs` drives to keep `GLOSSARY.md` a clean glossary.
- **`/codebase-design`**: the deep-module vocabulary (module, interface, depth, seam, adapter, leverage, locality) for designing a module's *shape*: a lot of behaviour behind a small interface at a clean seam. `/tdd` and `/improve-codebase-architecture` both speak it.

## Phase boundaries

A **phase** is a chunk of work inside a session: the grilling, the implementation, the QA. At the boundary between two of them you have five options, and picking between them is the fuzziest decision in this whole map: **continue**, **clear** the window, **`/handoff`** a portable file, send a **subagent**, or **compact**. Read [PHASE-BOUNDARIES.md](PHASE-BOUNDARIES.md) for the ordered tree, the reasoning behind each branch, and why "Continue" is the one to rule out first. `/handoff` is narrow: a new harness, a new directory, a colleague, or forking a side task mid-phase. What it buys is portability.

## Standalone

Off the main flow entirely.

- **`/research`**: delegate reading legwork to a background agent. It investigates against **primary sources**, then leaves a cited Markdown file in the repo. Keep working while it reads. Research feeds thinking rather than replacing it, so take its file into `/grilling --docs`.
- **`/prototype`**: a small, throwaway program that answers one design question: does this state model feel right, or what should this UI look like. Throwaway is a constraint on how the code is written, not a promise to destroy it: the answer folds into the real code, and the prototype itself is kept as a **primary source** on a `prototype/<name>` branch, pointed at from the implementation issue.
- **`/wizard`**: for the steps only a **human** can take: provisioning infrastructure, setting up credentials or CI secrets, clicking through an unfamiliar dashboard, running a one-off migration. It generates an interactive bash script that opens each URL, captures each value, and writes it into `.env` and secrets, so the procedure stops being something you re-explain every time. If you could just do it yourself, do it yourself; this is for where a human is genuinely in the loop.
- **`/to-questionnaire`**: when the thing blocking you isn't in your head or the codebase but in **someone else's**. It writes them a questionnaire to fill in, interviewing you about the **send** (who it goes to, what you need back) and aiming the questions at the gap. What comes back is material for `/grilling --docs` or `/to-spec`.
- **`/wait-what`**: the corrective for a message that didn't land. Use it mid-conversation, inside any other skill, and the agent re-pitches what it just said with the context you were missing, in plain English, using the `GLOSSARY.md` vocabulary.
- **`/teach`**: learn a concept over multiple sessions, using the current directory as a stateful workspace.
- **`/writing-for-agents`**: the reference for writing documents agents consume: skills, AGENTS.md, pointed-at docs.
- **`/writing-fragments`** → **`/writing-beats`** or **`/writing-shape`**: writing a long piece. Fragments is explore (mine raw material, no structure). Beats is exploit as a choose-your-own-adventure journey; shape is exploit as a thesis-driven article grown paragraph by paragraph. Both read `../_shared/WRITING-MECHANICS.md` for the grounding accounting they share.
- **`/loop-me`**: `/grilling` aimed at **workflow** specs, with its own vocabulary and definition of done.
- **`/software-factory`**: the shared language for designing a system of agents that turns tickets, PRs, and schedules into merged code. Vocabulary, not a process.
- **`/chief-of-staff`** and **`/setup-ts-deep-modules`**: the two heavier in-progress skills. Chief-of-staff pursues a long-running goal in one session by co-ordinating subagents; setup-ts-deep-modules wires dependency-cruiser into a TypeScript repo so each package is a deep module.

## Precondition

**`/setup-matt-pocock-skills`**: run before your first engineering flow to configure the issue tracker, triage labels, and doc layout the other skills assume. Custom issue trackers also work.
