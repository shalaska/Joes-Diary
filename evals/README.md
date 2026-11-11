# Evals

Offline evals for the four AI features behind the gateway. Every input is synthetic and
written for this folder: no diary text is ever used.

- `cases/`: test cases per feature, each with what a good answer must and must not do.
- `graders.js`: code graders. Deterministic checks such as "finds every real todo",
  "mentions every calendar event", "no invented times", "ignores injected instructions",
  "answers a direct question on topic", "stays concise".
- `run.js`: calls the model through the production handler (same prompts, schemas and
  output checks as live) and grades each answer. Writes `results.json` and `report.md`.
- `evals.test.js`: offline tests for the graders, run by `npm test`.

```sh
GEMINI_API_KEY=... node evals/run.js                          # the pinned model
GEMINI_API_KEY=... EVAL_MODEL=gemini-x.y-pro node evals/run.js
```

CI runs them on every PR that touches `gateway/` or `evals/`, and on demand from the
Actions tab (pick any model). Next: an LLM judge with a written rubric for tone and
usefulness, checked against hand labels, then a gate against the stored baseline.
