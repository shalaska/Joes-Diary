# Calendar ICS proxy

This Worker fetches private iCal feeds for JoesDiary without placing the feed URLs
in the browser bundle:

| Path | Worker secret | Calendar |
| --- | --- | --- |
| `/calendar.ics` | `ICS_URL` | Outlook work calendar |
| `/personal.ics` | `PERSONAL_ICS_URL` | Google Calendar, via its "Secret address in iCal format" |

A feed whose secret is not set answers 503, and the app hides it. Unlike a Google
sign-in in the browser, a feed never expires; reset the secret address in Google
Calendar to revoke it.

It only serves the feed to a signed-in, allowlisted account. Every request must
carry `Authorization: Bearer <Firebase ID token>`. The Worker checks the token's
signature against Google's published keys, its issuer, audience and expiry, and
then reads `allowedUsers/{uid}` from Firestore with the caller's own token. The
Origin check stays as a second layer. It is not authentication on its own,
because any non-browser client can send any Origin header.

Merges to `main` that touch this folder deploy it from GitHub Actions
(`.github/workflows/cloudflare-worker.yml`). To deploy by hand from this directory:

```sh
npx wrangler login
npx wrangler secret put ICS_URL
npx wrangler secret put PERSONAL_ICS_URL
npx wrangler deploy
```

Paste the resulting `https://...workers.dev/calendar.ics` address into
JoesDiary Settings under **Outlook Work Calendar**.

The published ICS addresses are bearer secrets. Never commit it to this repository
or place it in `wrangler.jsonc`.
