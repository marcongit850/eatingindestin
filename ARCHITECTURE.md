# Eating in Destin: architecture

Last checked against the code and Cloudflare on Oct 8, 2026.

## What it does

A static restaurant guide for Destin and Miramar Beach, FL (sister site of Eating on 30A). The Worker serves the generated pages and handles coupon signup, listing requests, the list your restaurant form, shared accounts (sign in, My places), and the listing admin.

## Domains and Worker

- Worker: `eatingindestin`
- Custom domains (attached in the Cloudflare dashboard, not in `wrangler.jsonc`): `eatingindestin.com`, `www.eatingindestin.com`. Canonical is https://www.eatingindestin.com. The apex and the workers.dev host (https://eatingindestin.352marc.workers.dev) redirect there.

## Data and images

- Directory data: `data/restaurants.csv` and `data/locations.csv` in this repo are the source of truth. `scripts/build.py` generates the HTML, `data/catalog.json`, and the sitemap. Raw CSVs are not uploaded (`.assetsignore`).
- Photos: `images/` in this repo, served as static assets.
- Admin listing edits and admin uploaded photos: stored by the shared `eating-accounts` Worker (D1 `eating-accounts`, R2 `eating-listings`). They override the `data/catalog.json` baseline. Do not add a Destin database or photo bucket.
- Accounts, sessions, and saves: D1 `eating-accounts` (id `f3ae29af-a929-4185-b5bd-b349cc015a3f`), owned by `eating-accounts`. This site keeps no user database.
- External services: Resend (email), a Google Sheets Apps Script webhook (coupon rows), Zoho Campaigns (list subscribe).

Bindings on `eatingindestin`: `ASSETS` (static assets, directory `.`), vars `ACCOUNT_SITE` (`destin`) and `ACCOUNTS_ORIGIN` (`https://eating-accounts.352marc.workers.dev`). No D1, R2, or KV is bound to this Worker. The code also accepts an optional `ACCOUNTS` service binding, but none is set, so it calls `ACCOUNTS_ORIGIN` over HTTPS.

## Secrets and env vars (names only)

`eatingindestin` secrets: `ACCOUNTS_SHARED_SECRET`, `CONTACT_EMAIL`, `RESEND_API_KEY`, `SUBSCRIBE_FROM`, `GOOGLE_SHEETS_WEBHOOK_URL`, `GOOGLE_SHEETS_WEBHOOK_TOKEN`, `GOOGLE_SHEETS_WEBHOOK_TOKEN_30A`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_LIST_KEY_DESTIN`, `ZOHO_LIST_KEY_30A`.

Optional, read by the code but not set today: `ADMIN_EMAILS` (comma list; when unset, admins fall back to `DEFAULT_ADMINS` in `listing-model.js`).

Magic link mail is sent by `eating-accounts`, not by this Worker. Its secrets are listed in ARCHITECTURE.md in the eatingon30A repo.

## Cron and scheduled jobs

None. There is no scheduled handler in the code, and `eatingindestin` has no cron trigger.

## How it deploys

- Cloudflare Workers Builds, auto deploy on merge to `main`. Repo `marcongit850/eatingindestin`, trigger `03274723-0fd9-4952-b412-ccf4bfba0651`, build command empty, deploy command `npx wrangler deploy`, root `/`.
- If a merge does not deploy: `POST /accounts/f1c59948520f1ec39473238b621c7e24/builds/triggers/03274723-0fd9-4952-b412-ccf4bfba0651/builds` with body `{"branch": "main", "commit_hash": "<full 40 character sha>"}`. Check builds with `GET /accounts/f1c59948520f1ec39473238b621c7e24/builds/workers/458add3f583b423cbb9d3bf4adcd779e/builds?per_page=2` and match `commit_hash`.
- Exception: the shared `eating-accounts` Worker (accounts, admin API, magic links for both food sites) lives in the eatingon30A repo under `accounts/`. It has no Workers Builds trigger and has been deployed by hand. Deploy it before any change here that depends on a new accounts API.

## Known gotchas

- The Workers Builds build command is empty, so `scripts/build.py` does NOT run on deploy. Run `python3 scripts/build.py` and commit the regenerated HTML, JSON, and sitemap with every CSV edit.
- Do not add a custom domain or route to `wrangler.jsonc`. The domains are attached in the dashboard.
- `run_worker_first` is `true` so redirects run before static HTML.
- Shared accounts: `eatingindestin`, `eatingon30a`, and `eating-accounts` must all hold the same `ACCOUNTS_SHARED_SECRET`. Change it on all three together.
- Sheets token names are mirrored across the two guides: here `GOOGLE_SHEETS_WEBHOOK_TOKEN` is the Destin tab and `GOOGLE_SHEETS_WEBHOOK_TOKEN_30A` is the 30A tab.
- `SUBSCRIBE_FROM` must be a sender on a domain verified in Resend, or mail is not delivered.
- Missing mail, Sheets, or Zoho secrets fail soft (the request still succeeds). Check the `delivered` and `recorded` flags.

TODO: record which Resend verified domain `SUBSCRIBE_FROM` uses (the value is a secret and cannot be read back).

## Standing rule

Any PR that changes architecture (new secret, cron, storage, binding, or deploy change) must update this file in the same PR.
