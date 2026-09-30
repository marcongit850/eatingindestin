# Eating in Destin

A static restaurant guide for Destin and Miramar Beach, Florida. Every named `PUBLISHED` row in `data/restaurants.csv` is on the site: one profile page each, plus the directory and the map.

The visual direction matches Eating on 30A: full-bleed hero, serif display type, and monogram frames where a listing has no photograph. Meal, area, cuisine, and search filters work across the full directory. The map uses the same listings.

There is no Airtable base and no Google Places or Google Maps API.

The Cloudflare Worker name is `eatingindestin`. Do not add a custom domain binding in `wrangler.jsonc`. The live site is already [https://www.eatingindestin.com](https://www.eatingindestin.com). The apex host and the workers.dev hostname redirect there.

Worker hostname:

https://eatingindestin.352marc.workers.dev

Requests to that hostname redirect to www. The first visit can show a short Cloudflare “verify you are human” check. `site.config.json` sets `origin` to `https://www.eatingindestin.com` for canonical links, Open Graph URLs, JSON-LD, the sitemap, and `llms.txt`. Override it for one build with `SITE_ORIGIN` only when a different canonical host is required.

## Preview locally

From the repository root:

```bash
python3 scripts/build.py
python3 -m http.server 8080
```

Open `http://localhost:8080/`.

```bash
npm test
```

That rebuilds the site, checks the generated pages, and checks the filter rules.

## One profile template

`build_detail()` in `scripts/build.py` is the only restaurant profile template. `card()` is the only directory card. `includes/header.html` and `includes/footer.html` are the shared navigation, loaded by every page through `header.js` and `footer.js`. Change a link in those two files and it shows on every page. The build does not copy the nav into each HTML file.

`SAMPLE_SLUGS` in `scripts/build.py` is `None`, so the build publishes every named `PUBLISHED` row. Rows with `Status` of `PUBLISHED` and a blank restaurant name are stubs left in the export. The build skips them. They stay in the CSV.

## Edit the directory

`data/restaurants.csv` and `data/locations.csv` are the source of truth. Edit the CSVs, then regenerate:

```bash
python3 scripts/build.py
```

Commit the CSV and the generated HTML, JSON, sitemap, and robots file together. The build does not call a network API.

## Featured cover

The homepage “Featured” slot rotates through the `featured` list in `site.config.json`. One listing shows for each UTC day, in list order, then the rotation starts over. While the page is open the cover also advances every 8 seconds. That timer pauses while the pointer or keyboard focus is inside the section, while the tab is hidden, and whenever reduced motion is requested. Previous and Next step through the same list immediately and restart the timer, wrapping at either end, and the day still picks the first slide. Auto advances leave the status announcement alone; only those manual steps update it. Without JavaScript, the first slug stays on screen and the arrows stay hidden. The cover itself does not change: photo or monogram, name, lede, area and price line, and a profile link.

To add or remove a spot, edit that list and rebuild:

```bash
python3 scripts/build.py
```

Each value must be the slug of a published restaurant. Order is the rotation order. A paid placement is the same edit: put its slug in `featured`, rebuild, and commit `site.config.json` with the new homepage.

Columns that show up on the site:

- `Restaurant Name`, `slug` (leave the slug blank and the build makes one from the old path plus the area if needed)
- `map_area`, `map_area_slug`, `location_label`, `subarea`
- `address` (JSON with `formatted` and `location.latitude` / `location.longitude`). Named published rows already have both, so the map does not geocode and does not invent coordinates. Pins that share one storefront are nudged apart on screen only.
- `phone`, `website`, `price`, `notes`, `hours`
- `List Image`, `Detail Image`, `Logo` (`https://` URLs, or `wix:image://` URLs, which the build turns into local files or `static.wixstatic.com` links)
- `Cuisine Type`, `Meal Type`, `Food Type`, `Vibe`, `Category` (JSON arrays)
- `Outdoor Dining`, `Kid Friendly`, `Live Music`, `Happy Hour (drinks)`, `Happy Hour (food)`, `Reservations`
- Lauren's Favorites is a directory and map checkbox, not a CSV column. The build tags The Melting Pot, McGuire's Irish Pub, Seagar's Prime Steaks & Seafood, Ruth's Chris Steak House, and The Crab Trap Destin. Checking it shows only those listings.
- `Facebook URL`, `Instagram`
- `Status` must be `PUBLISHED`

`data/locations.csv` supplies area names and short descriptions. Areas that exist only on restaurants still appear. A `Location Image` that starts with `/images/` is a file in the repo. When that cell is empty, the build uses `images/areas/<slug>.jpg` if the file is there. Those covers are in the repo, so the area cards use the photos.

Image columns are `List Image`, `Detail Image`, and `Logo`. This export leaves them empty. The supplied photo set lives in `images/restaurants/<slug>/`. `01` is the cover on the card, the profile hero, the map popup, and the Open Graph image. `02` and `03` show in a strip under the hero when they exist. A single file named with the site slug (`images/restaurants/harbor-docks-destin-harbor.jpg`, `.jpeg`, `.webp`, or `.png`) still works as a cover when that folder is absent. A listing with neither keeps the monogram. Sundries General Market and Crafty Siren still have no storefront photo. The build does not call Google Places.

The raw CSV is not uploaded with the site (see `.assetsignore`). It includes export columns such as owner ids and `googlePlaceId`. Those columns are not read into the public JSON and are not sent to Google.

## Deploy

Cloudflare Worker `eatingindestin` serves the static site, `POST /api/subscribe`, and `POST /api/listing`. `wrangler.jsonc` sets `"name"` to `eatingindestin`, `"main"` to `worker.js`, and `"assets.directory"` to `.`. There is no custom domain route.

Signup notes and listing requests from `/contact/` go out through the Resend HTTP API (`https://api.resend.com/emails`) only when all three secrets are set on the Worker:

- `RESEND_API_KEY`
- `SUBSCRIBE_FROM` — a verified Resend sender, also used as the From address for listing mail
- `CONTACT_EMAIL` — inbox that receives the signup and listing requests

If any secret is missing, the worker still accepts the signup or listing note and returns `delivered: false`. It does not call another newsletter product. A listing email sets `reply_to` to the address on the form so a reply goes back to that person.

```bash
npx wrangler deploy
```

Leave the custom domain out of `wrangler.jsonc`. Canonical URLs use `https://www.eatingindestin.com`. The worker redirects the apex host and the workers.dev hostname to www before it serves a page.

Homepage meal and area links go to `/restaurants/?meal=Dinner` and `/restaurants/?area=destin-harbor`. The directory reads those query parameters and hides the other cards. The map page honors the same parameters.

## Pages

- `/` meal and area entry points that filter the directory
- `/restaurants/` filterable directory
- `/restaurants/<slug>/` one restaurant
- `/map/` Leaflet on OpenStreetMap. Pins outside the Destin–Miramar corridor stay on the map, and they do not set the opening frame.
- `/areas/` and `/areas/<slug>/` area notes
- `/about/` and `/contact/`
- `sitemap.xml`, `robots.txt`, `llms.txt`
