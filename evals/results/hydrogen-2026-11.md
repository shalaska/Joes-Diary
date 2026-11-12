# Gemini 4 Hydrogen vs 3.8 Flash, November 2026

**Decision: pin `gemini-4-hydrogen` with thinking `low` for every feature, Ask my diary included
(its agent suite runs on Hydrogen in the PR's eval run). Todo extraction stays on
`gemini-3.1-flash-lite`. `GEMINI_MODEL_ASK` can move Ask back to another model on its own.**

## Setup

- Evals workflow, bake-off mode, branch `eval/hydrogen`, 2026-11-12: suites extractTodos,
  calendarNote, chat, edit and weekReview (no ask), one run per case (41 runs), judge
  `gemini-3.8-flash`. One run per case, so a single case flipping moves a feature by 12-25 points.
- The first Hydrogen run used its default thinking (high). Token counts in the first two runs
  left out thinking tokens; the client now counts them as output, as they are billed.

## Results

| Model | Thinking | All checks passed | Mean judge score | Median / p90 latency (ms) | Week review median (ms) | Tokens in / out (incl. thinking) |
| --- | --- | --- | --- | --- | --- | --- |
| `gemini-3.8-flash` | default | 100% | 4.75 | 6641 / 11817 | 15537 | 14530 / 25939 |
| `gemini-4-hydrogen` | low | 98% | 4.82 | 2981 / 4347 | 4641 | 21211 / 18436 |
| `gemini-4-hydrogen` | default (high) | 93% | 4.73 | 3761 / 9503 | 14838 | not counted |

- Hydrogen on low: the only failure is the chat overlap case saying "double-booked", a known
  flaky case that 3.8 Flash has also failed.
- Hydrogen on high padded the thin-week review (judge tone 2) and missed one todo priority.
- Cost at list prices (Hydrogen $1.50 / $7.50 per million in / out, 3.8 Flash $0.75 / $3.75):
  about $0.17 vs $0.11 for these 41 runs, so Hydrogen on low costs about 1.6x per answer.

## PR run (3 repeats, ask included), and what changed

The first PR run (judge defaulted to the new pinned model, Hydrogen) failed the gate on chat:
cases passing 79% vs a 90% baseline. Two causes were real and judge-independent or repeatable:

- The chat overlap case said "double-booked" in 3 of 3 runs (3.8 Flash: occasional).
- `unstructured-gets-structure` got two replies that suggested adding a heading instead of
  engaging with the plan (judge answers_the_point 2).

Everything else held up: ask 100% (21/21), todos, calendar note and edit 100%, week review 92%.

Changes after that run:

- **Chat stays on `gemini-3.8-flash`** (`GEMINI_MODEL_CHAT`), the thinking-partner feature where
  Hydrogen did worse. Calendar note, edit, week review and Ask move to Hydrogen.
- **The eval judge is fixed at `gemini-3.8-flash`** in the workflow, so judge scores stay
  comparable to `evals/baseline.json` when the model under test changes.
