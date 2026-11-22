---
name: implement
description: Implement a piece of work from a spec plus its tickets, or a single ticket. Drives tdd per ticket, lands everything on one integration branch, closes with code-review.
disable-model-invocation: true
user-invocable: true
---

Implement the work described by the user: either a **whole spec with its tickets**, or **one ticket** on its own.

Common to both: build it with test-driven development. Read `../tdd/SKILL.md` now and work at pre-agreed seams. Run typechecking regularly, single test files regularly, and the full test suite once at the end. Commit to the branch you are working on. Before reporting done, read `../code-review/SKILL.md` and review the diff.

If the user passes a ticket reference, fetch it from the issue tracker and state its title before starting. If the reference is ambiguous, ask.

The issue tracker should already be configured. If it is not, tell the user to run `/setup-matt-pocock-skills` (or read `../setup-matt-pocock-skills/SKILL.md` yourself and follow its setup steps).

## One ticket

Read the ticket, state its title, implement it test-first on the current branch. It is self-contained, so the previous ticket's context is disposable. Then review it with `../code-review/SKILL.md` and report.

## A whole spec

You have been provided a spec. This spec should have tickets associated with it, describing how to implement the spec.

The goal is the entire spec implemented on a single **integration branch**, with every ticket resolved the way the issue tracker closes work.

The tickets are not a list of steps. They are a **task graph** with blocking relationships between them. This means there is always a **frontier** of tickets which are ready to be grabbed.

Start every subagent with a fresh context window.

Communication to and from subagents should be sparse. Communicate primarily through **context pointers**: to the spec, tickets, research notes, and previous commits. Don't duplicate information already available via pointers.

**Implementer subagents** should be run in the background where possible for maximum concurrency.

### Steps

1. Read the spec and tickets to understand the task graph.

2. (optional) Use an **exploration subagent** to conduct any exploration required by the tickets - relevant codebase files or external documentation. Ensure the exploration subagent can save files - it should save its markdown notes in a directory outside the repo, accessible by all future subagents. This lets **implementer subagents** focus on implementation rather than exploration. For the reading discipline, read `../research/SKILL.md` and follow it.

3. Create the integration branch. If the issue tracker closes work through PRs, or the user asks for one, open a draft PR after the first merge in step 5 (a branch with no commits ahead of main can't open one), marked as closing the spec and tickets.

4. Use a fresh **implementer subagent** for each ticket, each in its own worktree on its own branch. Each implementer subagent:
   - confirms its worktree is based on the integration branch before starting, and resets onto it if not;
   - reads and follows `../tdd/SKILL.md` to build the ticket;
   - merges the integration branch tip into its own branch before reporting done

5. Once an **implementer subagent** completes, merge its work to the integration branch with a **merger subagent**.

6. If this changes the **frontier** of available tickets, kick off more **implementer subagents** to work on the new tickets. This allows for maximum concurrency.

7. Once all tickets are complete, read `../code-review/SKILL.md` and run the review on the integration branch. Fix all issues raised by the code review in a single fresh **implementer subagent**.

8. If a draft PR exists, mark it ready for review. Otherwise, resolve each ticket the way the issue tracker closes work, and report the integration branch.

9. Clean up all **implementer subagent** worktrees.
