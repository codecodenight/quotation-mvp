# Issue tracker: Local Markdown

This repo tracks work in local markdown rather than GitHub Issues.

## Existing project workflow

- Architecture/planning context lives in `docs/HANDOFF.md`.
- Codex execution tasks live as `docs/codex-task-*.md`.
- Codex reads the task file plus `AGENTS.md`, executes, then Claude reviews the diff and updates `docs/HANDOFF.md`.

Keep using this workflow when the user explicitly asks for a Codex task file.

## Matt Pocock skills workflow

When a Matt Pocock skill says "publish to the issue tracker", create local markdown under `.scratch/<feature-slug>/` unless the user asks for a `docs/codex-task-*.md` file.

Conventions:

- One feature per directory: `.scratch/<feature-slug>/`
- The PRD is `.scratch/<feature-slug>/PRD.md`
- Implementation issues are `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`
- Triage state is recorded as a `Status:` line near the top of each issue file
- Comments and conversation history append to the bottom of the file under a `## Comments` heading

## Fetching work

When a skill says "fetch the relevant ticket", read the path passed by the user. If no path is given, look first in `.scratch/`, then in `docs/codex-task-*.md`.

## Pull requests

External pull requests are not a triage surface for this solo project.
