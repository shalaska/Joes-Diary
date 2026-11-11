# Model bake-off, November 2026

**Decision: keep `gemini-3.8-flash` pinned for every feature.** It scored highest, and the
cheaper Flash-Lite models fail in ways that matter for a diary (dropping a sentence the
author wrote, inventing calendar times). Flash-Lite is 7-9x faster, so the one change worth
trying next is moving todo extraction, where it matched Flash exactly, onto
`gemini-3.1-flash-lite`.

## Setup

- 37 synthetic cases across the four AI features, each run 3 times per model (111 runs),
  through the production gateway handler: same prompts, schemas and output checks as live.
- Code graders plus an LLM judge. The judge was `gemini-3.8-flash` for every model, so it
  may favour its own answers. It agreed with 12/12 hand labels in calibration.
- Candidates: the pinned model, the newest two stable Flash, Flash-Lite and Pro models the
  key can call. `gemini-2.5-pro` is listed but returns 404, and no stable 3.x Pro exists.
- Run: Evals workflow with `bakeoff=auto`, `repeats=3`, 2026-11-11.

## Results

| Model | All checks passed | Todos | Calendar note | Chat | Edit | Mean judge score | Median / p90 latency (ms) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `gemini-3.8-flash` (pinned) | **99%** | 100% | 100% | 96% | 100% | 4.85 | 6635 / 11035 |
| `gemini-3.7-flash` | 97% | 98% | 100% | 92% | 100% | 4.90 | 6492 / 11041 |
| `gemini-3.5-flash-lite` | 94% | 96% | 100% | 92% | 83% | 4.65 | **724 / 991** |
| `gemini-3.1-flash-lite` | 94% | 100% | 90% | 100% | 72% | 4.64 | 869 / 1194 |

Token use was almost identical across models (about 37k in and 8k out per 111 runs).

## What the failures were

- **Both Flash-Lite models, edit:** given a selection that contains an injected instruction,
  they rewrote the rest but silently deleted the injected sentence (judge: preserves_meaning 2)
  in all three runs. They also padded short rewrites past the 4x length limit.
- **`gemini-3.1-flash-lite`, calendar note:** left out an event once and invented
  06:00 and 07:00 times once.
- **`gemini-3.5-flash-lite`, chat:** two answers to a direct question restated the note
  instead of answering it (judge: answers_the_point 2-3, tone 2-3).
- **Flash models:** the only repeat failures are the chat overlap case still saying
  "double-booked" and one todo priority, both already known flaky cases.

## Cost

At this app's volume the bill is pennies either way, so cost does not decide it. Published
prices per 1M tokens: `gemini-3.1-flash-lite` $0.25 in / $1.50 out (Google's pricing page).
`gemini-3.8-flash` is listed by third-party trackers at $0.75 / $3.75, rising on
1 January 2027. Google's own page did not show a 3.8 Flash price when checked, so treat that
figure as unverified.

## Next

- Try per-feature models: `extractTodos` on `gemini-3.1-flash-lite` (same 100% pass rate,
  about 6x faster), gated by the same evals.
- Re-run the bake-off when a stable 3.x Pro or a new Flash appears. The weekly model bump
  already gates new Flash versions on these evals.
