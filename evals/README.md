# Evals

Offline evals for the four AI features behind the gateway. Every input is synthetic and
written for this folder: no diary text is ever used.

- `cases/`: test cases per feature, each with what a good answer must and must not do.
- `graders.js`: code graders. Deterministic checks such as "finds every real todo",
  "mentions every calendar event", "no invented times", "ignores injected instructions",
  "answers a direct question on topic", "stays concise".
- `run.js`: calls the model through the production handler (same prompts, schemas and
  output checks as live) and grades each answer. Writes `results.json` and `report.md`.
- `judge.js`: an LLM judge (newest stable Gemini Pro by default) that scores what code
  cannot: does the chat answer the point, is it grounded, is the tone natural rather than
  preachy, is the calendar insight specific. Each criterion 1-5; a run passes at 3+ on all.
- `calibration.js`: hand-labelled good and bad answers. The judge is scored against these
  first (`EVAL_CALIBRATE=1`), so we know how often it lets a bad answer through before
  trusting its numbers.
- `evals.test.js`: offline tests for the graders and the judge plumbing, run by `npm test`.

```sh
GEMINI_API_KEY=... node evals/run.js                          # the pinned model
GEMINI_API_KEY=... EVAL_MODEL=gemini-x.y-pro node evals/run.js
```

CI runs them on every PR that touches `gateway/` or `evals/`, and on demand from the
Actions tab (pick any model and judge).

## The gate

`gate.js` compares a run with `baseline.json` and fails the check when a feature drops
more than its noise tolerance: 10 points of cases passing, or 0.3 on any judge criterion.
The baseline comes from a noise check (every case run 5 times on an unchanged prompt and
model). Some cases are flaky rather than broken, for example a todo priority that is right
3 times in 5, so the tolerance is set so that one or two flaky failures in a 3-repeat PR
run do not block a merge.

- PRs run each case 3 times with the gate on (`EVAL_GATE=1`).
- The weekly model bump runs the evals on the candidate model with the gate on, so a new
  model that is worse on our cases opens its PR marked "(evals regressed)" and fails.
- After an intended change (a new prompt that trades one thing for another, or a new
  pinned model), refresh the baseline in the same PR and say why:

```sh
GEMINI_API_KEY=... EVAL_REPEATS=5 EVAL_WRITE_BASELINE=1 node evals/run.js
```

## Model bake-off

Run the Evals workflow from the Actions tab with `bakeoff` set to `auto` (the pinned model
plus the newest two stable Flash, Flash-Lite and Pro models) or to a comma list of models.
Every model gets the same cases and the same judge (the pinned model unless `judge_model`
is set), and the run summary ends with one comparison table (`evals/bakeoff.js`).
