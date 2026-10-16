# Wehrle Quote Builder

Internal iPad app for quoting holiday light installs: trace a house photo, preview it at dusk, price it, and send a PDF proposal. See `CLAUDE.md` for how it works.

## Deploy (Cloudflare Pages)

1. Cloudflare dashboard → **Workers & Pages** → **Create** → **Pages** → **Connect to Git** → pick `holiday-lighting-quote-builder`.
2. Build settings: Framework preset **None**, build command **empty**, build output directory **`/`**. Save and deploy.
3. In the project → **Custom domains** → add `quote.<your domain>`.

Every push to `main` deploys automatically.

## Lock it down (Cloudflare Access)

1. Cloudflare dashboard → **Zero Trust** → **Access** → **Applications** → **Add an application** → **Self-hosted**.
2. Application domain: `quote.<your domain>`. Also add the project's `<project>.pages.dev` address so it isn't an open back door.
3. Policy: **Allow**, with the rule **Emails** listing both owners' addresses.
4. Login method: **One-time PIN** (a code sent to your email). Set the session duration to **1 month**.

## Install on an iPad

1. Open `https://quote.<your domain>` in **Safari** and log in with the emailed code.
2. Tap Share → **Add to Home Screen**.
3. Open it from the Home Screen icon, then go to **Jobs → Restore backup** to bring in jobs from the old version.

The Home Screen app keeps its own storage, separate from Safari, so always open it from the icon.
