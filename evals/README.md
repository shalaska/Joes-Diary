# Evals

Offline evals for the AI features behind the gateway. Every input is synthetic and
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

## The week review ("weekReview")

`cases/weekReview.js` cuts four weeks out of the invented diary (`agent/diary.js`): a busy
week, a week with a pasted prompt injection, a week with a work problem that drags on, and a
one-note week. The grader wants the five sections in order, every main thread named, only
`(Mon)`-style references to days that have notes, no injected text and a length limit. The
judge scores grounding, whether it sees patterns across days rather than retelling them,
specificity and tone. It is not in `baseline.json` yet, so it is reported but not gated.

## The diary agent ("ask")

`cases/ask.js` asks 20 questions of an invented three-month diary (`agent/diary.js`) through
the real agent loop (`gateway/src/agent.js`). Besides the answer, the graders check the path:
cited days must exist and include the expected ones, "not in the diary" needs a search first,
the run stays within 8 tool calls, and two entries carry pasted instructions that must not be
obeyed. The judge sees the whole synthetic diary to score groundedness.

## The gate

`gate.js` compares a run with `baseline.json` and fails the check when a feature drops
more than its noise tolerance: 10 points of cases passing, or 0.3 on any judge criterion.
The baseline comes from a noise check (every case run 5 times on an unchanged prompt and
model). Some cases are flaky rather than broken, for example a todo priority that is right
3 times in 5, so the tolerance is set so that one or two flaky failures in a 3-repeat PR
run do not block a merge.

- A PR runs only the suites its change can affect (`pickSuites.js`): the agent's files run
  the ask suite, prompts run the single-shot suites, the Gemini client or the model config run
  everything, one feature's cases run that feature. Those cases run 3 times with the gate on
  (`EVAL_GATE=1`), ask cases once. Features a run leaves out are not gated. A change to the
  harness alone runs one cheap suite once, ungated, to prove the harness still works; tests
  and docs run nothing. Only one eval run per branch runs at a time.
- The weekly model bump runs the evals on the candidate model with the gate on, so a new
  model that is worse on our cases opens its PR marked "(evals regressed)" and fails.
- After an intended change (a new prompt that trades one thing for another, or a new
  pinned model), refresh the baseline in the same PR and say why:

```sh
GEMINI_API_KEY=... EVAL_REPEATS=5 EVAL_WRITE_BASELINE=1 node evals/run.js
```

## What a run costs

Every run spends from the Gemini spend cap, which the live app shares, so a run that is too
big can switch the diary's AI off until the cap is raised or the month ends.

- Each run ends with a cost table (`pricing.js`): every model call is counted, the models
  under test and the judge on separate lines, thinking tokens included. `cost.json` holds the
  same numbers. Quote these figures, not a guess from the token column of one suite.
- `EVAL_MAX_COST_EUR` stops a run: once the run has cost that much, no further case starts and
  the run fails. Up to four cases that were already running still finish. CI sets it to 1.00
  (`max_cost` on a manual run).
- For scale: in November 2026 a full PR run (all six suites, 3 runs per case, ask once) cost
  about EUR 0.70. The judge scores every answer, so it is a real share of that.
- Prices in `pricing.js` come from the billing report. Add the new model's line when the
  pinned model changes; a model with no line is costed at the highest known price.

## Model bake-off

Run the Evals workflow from the Actions tab with `bakeoff` set to `auto` (the pinned model
plus the newest two stable Flash, Flash-Lite and Pro models) or to a comma list of models.
Every model gets the same cases and the same judge (the pinned model unless `judge_model`
is set), and the run summary ends with one comparison table (`evals/bakeoff.js`).

## Traces in Arize

With the `ARIZE_API_KEY` and `ARIZE_SPACE_ID` repository secrets set, every eval run is also
sent to Arize (project `joes-diary-evals`) as OpenTelemetry traces, using the OpenInference
conventions. `evals/tracing.js` builds them:

- one root span per case (`eval <feature>/<case>`): the synthetic input, the answer, pass or fail,
  and a `session.id` shared by the whole run, so a CI run shows up as one session;
- an `LLM` span per model call: model, prompt, reply, input, output and thinking tokens;
- an `EVALUATOR` span per code check (`evaluation.label` pass or fail, score 1 or 0, the detail);
- a `judge` span with the judge's own model call inside, its lowest score and each criterion.

Only eval data is traced. The gateway never imports this file, so nothing from the live diary
can reach Arize. Without the secrets (local runs, forks) tracing stays off and nothing changes.
