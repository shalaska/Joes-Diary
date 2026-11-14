# SLOs and alerts

`config.js` defines what "working well" means for the diary. The Monitoring workflow makes Google Cloud Monitoring match it whenever the file changes on `main`.

| SLO | Target over 28 days | SLI source |
| --- | --- | --- |
| Ask answers within 20 s | 95% | `diary_llm_latency`, feature `ask` |
| Quick AI features within 8 s | 95% | `diary_llm_latency`, the other features |
| Claude tool calls within 2 s | 99% | `diary_mcp_tool_latency` |
| AI features succeed | 99% | `diary_llm_requests`, good vs server-failure outcomes |

## Terms

- **SLI (indicator):** a ratio of good events to all events. For example, Ask answers under 20 s divided by all Ask answers.
- **SLO (objective):** the target for that ratio over a window, for example 95% over 28 days.
- **Error budget:** the part that is allowed to go wrong. At 95%, that's 5% of Ask answers per 28 days.
- **Burn rate:** how fast the budget is being spent. A burn rate of 1 uses exactly the whole budget in 28 days. Each SLO alerts by email when the burn rate stays above 6 over 6 hours.

## Where the numbers come from

The SLIs are built from the gateway's structured log lines (`llm_call`, `mcp_call`) through log-based metrics. These lines already carry `feature`, `outcome` and `latencyMs`, and never any diary text.

Only server failures spend the availability budget. The caller's own mistakes (bad input, signed out, daily limit) don't. The traces in Cloud Trace use the same split.

## Low traffic

With one user and a handful of requests a day, one slow or failed request can be a large share of a 6-hour window. So in practice the alert fires on almost any failure in a quiet period. At real traffic levels you would add a faster window (for example, burn rate 14.4 over 1 hour) and page only on that.

## Setup, once

The github-deploy service account needs `roles/monitoring.editor` and `roles/logging.configWriter`. The `ALERT_EMAIL` repository secret sets where alerts go.
