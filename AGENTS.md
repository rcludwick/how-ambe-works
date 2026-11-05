# Agent Instructions & Workflow Rules

## Atomic Workflows and Commits
To prevent work-in-progress loss across agent session windows or quota interruptions:
- **One file or figure per commit:** Change strictly one file or one Three.js graph at a time.
- **Renumbering figures:** Adding, moving or removing a figure changes its number. When you change a figure's number, update every reference to it across the site. Search for its old anchor and number in prose, glossary entries, and diagrams. Land that update in its own commit.
- **Immediate test and commit:** Run `uv run python tools/check-copy.py`, `uv run python tools/check-slots.py --inventory`, and `uv run --locked --group docs zensical build --clean --strict`. When editing prose, check `uv run python tools/check-voice.py --score <file>`. Commit each change immediately, and make sure it is on `main` before starting the next change.
- **Keep working trees clean:** Never leave unstaged or uncommitted changes across multi-file edits.

## Several agents at once
Several agents may be working on this site at the same time, each in its own worktree. Their changes all land on the same `main`.
- **Prefer small changes:** Make each change in a worktree, keep it to one file or one figure, and merge it to `main` as soon as it passes. A small change lands cleanly next to another agent's work.
- **Avoid wide sweeping changes:** A rename, renumbering or rewording across many pages is likely to collide with another agent's edits to those pages. If you must make one, land it on its own and quickly, so others can pick it up.
- **Start from the latest `main`:** Before you start a change, create the worktree from the current `main`. Before you merge, rebase onto `main` again, since another agent may have landed something in the meantime.
- **Leave other agents' work alone:** Don't edit, stash, reset or remove a worktree or branch that you didn't create.

## Worktrees
- When you create a git worktree, launch the preview server inside it with `uv run --locked --group docs zensical serve`.

## Writing Prose
- Follow the 3Blue1Brown pedagogy in `STYLE.md` and `tools/VOICE.md`.
- Open with a concrete physical problem, not an abstract definition. Show where the naive approach fails before introducing the fix.
- Keep sentences to two commas or fewer, the Oxford comma included.
- Do not use em dashes. Split longer sentences into separate statements.
