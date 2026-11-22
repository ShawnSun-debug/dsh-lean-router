---
name: grilling
description: Grill the user relentlessly about a plan, decision, or idea until you share an understanding. Use when the user wants to stress-test their thinking, or says "grill". With --docs it also writes ADRs and GLOSSARY.md as decisions land.
disable-model-invocation: true
user-invocable: true
---

Interview the user relentlessly until you reach a shared understanding. Map this as a **design tree**: every decision branches into the decisions that hang off it.

Work the tree in **rounds**. The **frontier** is every decision whose prerequisites are already settled: the questions you can ask _now_ without guessing at answers you haven't heard yet. Ask the whole frontier in one round, then wait for the user's answers before the next round.

## Ask with the question tool

By default a round goes through the `ask_user_question` tool, not prose. It puts the frontier in front of the user as a dialog of clickable options: faster to answer, and it hands the structure back to you directly. One call carries the whole round, one entry per frontier question.

- Give each entry a stable `id` and a two-or-three word `header` that names the decision, not a restatement of the question.
- Word `question` so that accepting your recommendation is the easy path.
- Put your recommended answer **first** in `options` and append `(Recommended)` to its label. Every option needs a one-sentence `description` saying what picking it commits the user to.
- Set `multi_select` only when the choices genuinely combine; otherwise leave it off.
- Keep a round to what fits on one screen. If the frontier is larger than about five questions, ask the five that unblock the most and say in one line what is still queued.
- An answer that comes back empty (skipped) is **not** permission and **not** a decision: park it, finish the round, and raise that question again in prose at the end. Do not put it to the tool a second time.
- An answer may carry `custom` text alongside a chosen option. When the text contradicts the option, the text wins.

Fall back to prose in a single message when the tool is not available in this session, when a question needs paragraphs of context that will not fit an option list, or when the user asks for plain text. Format a prose round like so, and word each question so "yes" accepts your recommended answer:

```
❓ **Q1** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>

---

❓ **Q2** - **<question title>**: <question body, might be multiple paragraphs, including multiple choices>

➡️ <your recommended answer>
```

Prose is also where a parked or skipped decision gets raised again.

Each round the user answers reshapes the tree: settled decisions push the frontier outward and unblock questions that depended on them. Recompute the frontier and ask the next round. A question whose answer depends on another question still open in this round belongs to a _later_ round, not this one.

Finding _facts_ is your job, never the user's. When a frontier question needs a fact from the environment (filesystem, tools, etc.), dispatch a sub-agent with a fresh context window to find it; don't ask the user for anything you could look up yourself. Don't block on it: a running exploration is an unsettled prerequisite, so only the questions downstream of it wait for the sub-agent to report; ask the rest of the frontier now. The _decisions_ are the user's: put each to them and wait.

The session is done when the frontier is empty: every branch of the design tree visited, nothing left silently assumed. Do not act on it until the user confirms you have reached a shared understanding.

## Modes

Pick the mode from the user's words; if it is genuinely unclear, ask once.

- **Stateless (default)** — nothing is written to disk. Use it when the conversation has no repo under it (a plan, a design, a piece of writing), or when the user only wants their thinking stress-tested.
- **`--docs`** — the same interview, but decisions get written down as they crystallize. Use it whenever there is a working directory to leave a paper trail in; it is strictly the more useful mode there. To run it, read `../domain-modeling/SKILL.md` now and follow it for the whole session: challenge fuzzy terms, resolve overloaded words, record hard-to-reverse decisions as ADRs where the project keeps them, and keep `GLOSSARY.md` current inline as rounds land.
- **Workflow specs** — if what is being grilled is a workflow the user wants to build, rather than a plan or a design, read `../loop-me/SKILL.md` and follow that instead. It is this same interview aimed at spec vocabulary and a definition of done.
