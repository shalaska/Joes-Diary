# Outlook ICS proxy

This Worker fetches the private Outlook ICS subscription for JoesDiary without
placing the feed URL in the browser bundle.

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
npx wrangler deploy
```

Paste the resulting `https://...workers.dev/calendar.ics` address into
JoesDiary Settings under **Outlook Work Calendar**.

The published ICS address is a bearer secret. Never commit it to this repository
or place it in `wrangler.jsonc`.
