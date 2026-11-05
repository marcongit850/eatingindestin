# Eating in Destin: architecture

Last checked against the code and Cloudflare on Nov 5, 2026.

## What it does

A static restaurant guide for Destin and Miramar Beach, FL (sister site of Eating on 30A). The Worker serves the generated pages and handles coupon signup, listing requests, the list your restaurant form, shared accounts (sign in, My places), and the listing admin.

## Domains and Worker

- Worker: `eatingindestin`
- Custom domains (attached in the Cloudflare dashboard, not in `wrangler.jsonc`): `eatingindestin.com`, `www.eatingindestin.com`. Canonical is https://www.eatingindestin.com. The apex and the workers.dev host (https://eatingindestin.352marc.workers.dev) redirect there.

## Data and images

- Directory data: `data/restaurants.csv` and `data/locations.csv` in this repo are the source of truth. `scripts/build.py` generates the HTML, `data/catalog.json`, and the sitemap. Raw CSVs are not uploaded (`.assetsignore`).
- Photos: `images/` in this repo, served as static assets. `scripts/build.py` writes `data/image-sizes.json` so the listing overlay can add width and height. That file is not uploaded (`.assetsignore`). The Worker imports it.
- Admin listing edits and admin uploaded photos: stored by the shared `eating-accounts` Worker (D1 `eating-accounts`, R2 `eating-listings`). They override the `data/catalog.json` baseline. Do not add a Destin database or photo bucket. Listing fields live in the JSON `listings.payload` column. There is no separate column for amenities, so `waterfront` and `bar` do not need a D1 migration.
- Cross-guide admin: the browser stays on this origin and still sends this origin's admin session. The Worker uses its bundled `data/catalog.json` for Eating in Destin (`ACCOUNT_SITE`). For Eating on 30A it fetches that guide's public `https://www.eatingon30a.com/data/catalog.json` from the Worker, not from the browser, then merges the shared D1 rows. The fetch does not follow redirects and sends no session or secret. An empty override payload does not crash the list. A failed sister fetch returns JSON, not an HTML error page. Eating on 30A runs its own copy of `catalog-store.js`, `catalog.js`, `admin-api.js`, and `admin.js`. Both copies have to be deployed before switching works from both admins. No CORS header is added. The page content security policy does not allow the browser to call eatingon30a.com.
- `waterfront` and `bar` are booleans on every listing (display labels Waterfront and Bar Scene). The baseline values are `Waterfront` and `Bar Scene` columns on `data/restaurants.csv` (`["Yes"]` or `["No"]`), written by `scripts/build.py` into `data/catalog.json` and `data/restaurants.json`. Approved tags: 38 waterfront and 32 bar. Every other published listing is false. Waterfront and Bar Scene controls stay hidden only while no live listing has that tag.
- Directory and map filters read `area`, `meal`, `cuisine`, `q`, `outdoor`, `kids`, `music`, `laurens`, `reservations`, `groups`, `happyfood`, `happydrinks`, plus `price` (exactly `$`, `$$`, `$$$`, or `$$$$`), `waterfront=yes`, `bar=yes`, and `happyhour=yes` (happy hour food or happy hour drinks). The homepage hero and the restaurants page use the same tappable chips for those filters (quick chips, a More filters panel, and Clear all, with aria-pressed). The map keeps select menus and checkboxes. Meal, cuisine, and price are single-select. The restaurant list stays in the initial HTML.
- An admin override whose payload omits `waterfront` or `bar` keeps the baseline value. Only an explicit `true` sets the flag (`=== true`, not a truthy string). An explicit `false` clears it. The Edge Seafood Restaurant & SkyBar (`the-edge-seafood-restaurant-and-skybar-destin-harbor`) already has an override row, so its waterfront and bar tags show from the baseline without a D1 write. Do not rewrite that row just to make the tags appear.
- Saving a listing from the admin or the list-your-restaurant form stores `waterfront` and `bar` only after `eating-accounts` is redeployed from the eatingon30A repo. That Worker validates payloads with eatingon30A's `listing-model.js`, not this copy. It has no Builds trigger. Until that deploy, a save drops the new keys and the CSV baseline still shows. Deploy `eating-accounts` before relying on an admin save to persist the flags.
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
- Workers static assets `html_handling` still emits 307 when a directory URL is missing its trailing slash, or when the request is for `index.html`. The Worker rewrites those responses to 301 (308 for POST) and keeps the Location header. A listing overlay must not rebuild a 3xx response, or `/restaurants` and `/map` come back as a 307 with no Location.
- Old restaurant paths are handled in the Worker, not by a second router. `data/legacy-redirects.json` and `data/amp-redirects.json` 301 a previous Destin slug to the live Destin listing. `data/sister-redirects.json` 301s a removed path that belongs on Eating on 30A to `https://www.eatingon30a.com` (a specific listing when the slug matches one page in `data/sister-catalog.json`, otherwise the 30A restaurant directory). `vue-on-30a` is not in that map: Eating on 30A has no Vue page, so the old path is 410 instead of the restaurant index. `data/location-redirects.json` 301s old `/location/{town}` paths to the matching 30A area page. `all-of-30a` goes to `https://www.eatingon30a.com/areas/`. A removed Destin path with no live listing and no 30A page stays 410. Any other `/restaurants/{slug}` that is not a live page returns 404, including an empty 200 body.
- An admin override is rendered by `renderProfile` in `public-html.js`, not by the built HTML file. That renderer includes WebSite and Organization, Restaurant hours when the hours text names the days and both clock times, and width and height from `data/image-sizes.json` for local images. The Edge listing is one of those overrides.
- Listing titles drop ` | Eating in Destin` when that suffix would make the title longer than 60 characters. Descriptions longer than 160 characters are cut on a word boundary to about 150-155 characters, with no ellipsis. Restaurant JSON-LD adds `openingHoursSpecification` from the hours already on the page, and includes `priceRange`, `image`, and `telephone` only when the listing has them. There is no menu URL or `hasMenu` field.
- Shared accounts: `eatingindestin`, `eatingon30a`, and `eating-accounts` must all hold the same `ACCOUNTS_SHARED_SECRET`. Change it on all three together.
- Sheets token names are mirrored across the two guides: here `GOOGLE_SHEETS_WEBHOOK_TOKEN` is the Destin tab and `GOOGLE_SHEETS_WEBHOOK_TOKEN_30A` is the 30A tab.
- `SUBSCRIBE_FROM` must be a sender on a domain verified in Resend, or mail is not delivered.
- Missing mail, Sheets, or Zoho secrets fail soft (the request still succeeds). Check the `delivered` and `recorded` flags.

TODO: record which Resend verified domain `SUBSCRIBE_FROM` uses (the value is a secret and cannot be read back).

## Standing rule

Any PR that changes architecture (new secret, cron, storage, binding, or deploy change) must update this file in the same PR.
