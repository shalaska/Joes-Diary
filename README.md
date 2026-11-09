# Joe's Diary

A private, single-user diary I use most days. It is also where I practise the
things I care about as a product manager: AI features with evals, permissions,
and release discipline, on a product with a real (if small) user.

Live at https://joesdiary-d8211.web.app. Sign-up is closed.

## What it does

- **Daily entries** grouped by day, with drag-to-reorder days, trash and restore.
- **Todos** captured by hand, by Siri ("Add to JoesDiary"), or extracted from an
  entry by Gemini.
- **Calendar side panel** showing Google Calendar and an Outlook work calendar
  (ICS feed), with a per-calendar switch for whether events may reach an AI model.
  The work calendar is blocked by default.
- **Gemini features**: a thinking-partner chat on an entry, edit-the-selection,
  todo extraction, a diary note drafted from a day's calendar, and a "day shape"
  summary.
- **Import and export**: Notion import, Markdown zip export.

## Architecture

```
Browser (React 19 + Vite, Firebase Hosting)
 ├─ Firebase Auth (email + password, allowlisted accounts only)
 ├─ Cloud Firestore  users/{uid}/{entries,trash,todos,dayMetadata,settings}
 ├─ Dexie (IndexedDB) for the calendar cache and pre-cloud migration
 ├─ Google Calendar API (OAuth token client, events + read-only calendar list)
 ├─ Cloudflare Worker  cloudflare/ics-proxy  → Outlook ICS feed (URL kept as a secret)
 └─ Cloud Function  gateway/  llm (europe-west1)
     ├─ checks the Firebase ID token and the allowlist
     ├─ 300 calls per user per day
     └─ Gemini API (key in Secret Manager, pinned model version)
```

## How data is protected

- **Firestore rules** ([`firestore.rules`](firestore.rules)) are the source of
  truth and are deployed from CI. Every document lives under `users/{uid}/**`,
  and only that user can read or write it, and only if `allowedUsers/{uid}`
  exists. A stranger who creates an account through the public Auth API gets no
  access at all. Rules are tested against the emulator on every PR.
- **AI privacy switch**: events from calendars marked "AI off" are filtered out
  before any prompt is built, and again inside the Gemini service as defence in
  depth. Covered by unit tests.
- **Google Calendar** access is limited to `calendar.events` and
  `calendar.calendarlist.readonly`. The access token is kept in
  `sessionStorage` for the current tab only.
- **LLM gateway** ([`gateway/`](gateway)): the browser never sees the Gemini
  key. The function owns the prompts, pins an exact model version (it refuses
  an alias such as `-latest`), checks every answer against a JSON schema or
  format rule, and logs metadata only: feature, prompt version, model, outcome,
  latency and token counts. Never the text.
- **Spend caps**: Google Cloud enforced caps pause the Gemini API at €5 a month
  and the gateway's Cloud Run at €2 a month, on top of the per-user daily limit.
- **Secrets**: the Outlook ICS address is a Worker secret, never in the bundle.
  The Firebase web config in `src/firebase.js` is public by design; access is
  enforced by the rules, not by hiding it.
- **Deploys** use GitHub OIDC and Workload Identity Federation, so there is no
  long-lived Google key anywhere. Only this repository can impersonate the
  deploy account, and that account can only manage Hosting and Firestore rules.

## Development

```sh
npm ci
npm run dev          # local app
npm run lint         # ESLint, must be clean
npm test             # unit tests for the app and the gateway (Vitest)
npm run test:rules   # Firestore rules tests (needs Java 21; starts the emulator)
npm run build
```

## Release process

Every pull request runs lint, unit tests, rules tests and a build, then deploys a
7-day preview channel and links it in the run summary. Merging to `main` deploys
the site and the Firestore rules. See
[`.github/workflows/firebase-hosting.yml`](.github/workflows/firebase-hosting.yml).

## Roadmap

1. **Foundations** (now): rules in the repo, closed sign-up, narrower scopes,
   CI gate, and the server-side LLM gateway.
2. **Evals**: offline eval suites on synthetic data for todo extraction and
   calendar notes, run in CI so a prompt or model change that makes things worse
   cannot ship.
3. **An agent with permission tiers**: read tools run freely, writes are
   reversible or need a tap, destructive actions are never taken by the agent.
4. **A remote MCP server with OAuth** so other AI clients can use the diary with
   scoped, revocable access.
5. **Metadata-only analytics in SQL** and **SLOs with OpenTelemetry**.

Diary content never leaves Firestore for analytics or evals: eval datasets are
synthetic, and logs hold metadata only.
