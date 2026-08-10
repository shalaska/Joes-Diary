# Outlook ICS proxy

This Worker fetches the private Outlook ICS subscription for JoesDiary without
placing the feed URL in the browser bundle.

Deploy from this directory:

```sh
npx wrangler login
npx wrangler secret put ICS_URL
npx wrangler deploy
```

Paste the resulting `https://...workers.dev/calendar.ics` address into
JoesDiary Settings under **Outlook Work Calendar**.

The published ICS address is a bearer secret. Never commit it to this repository
or place it in `wrangler.jsonc`.
