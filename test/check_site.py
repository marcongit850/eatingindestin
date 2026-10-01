#!/usr/bin/env python3
"""Checks the generated static site against the CSV source."""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
import build  # noqa: E402

restaurants = json.loads((ROOT / "data" / "restaurants.json").read_text(encoding="utf-8"))
source = build.load_restaurants()
home = (ROOT / "index.html").read_text(encoding="utf-8")
directory = (ROOT / "restaurants" / "index.html").read_text(encoding="utf-8")
sitemap = (ROOT / "sitemap.xml").read_text(encoding="utf-8")
robots = (ROOT / "robots.txt").read_text(encoding="utf-8")
wrangler = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
site_js = (ROOT / "site.js").read_text(encoding="utf-8")
styles = (ROOT / "styles.css").read_text(encoding="utf-8")

failures = []


def check(condition: bool, message: str) -> None:
    if not condition:
        failures.append(message)


shown = build.published_restaurants()
check(len(source) == 215, f"named published rows should stay at 215, got {len(source)}")
check(len(restaurants) == len(shown) == 215, "public json should include every named published restaurant")
csv_rows = build.load_rows(ROOT / "data" / "restaurants.csv")
blank_names = [row for row in csv_rows if build.clean_text(row.get("Status")) == "PUBLISHED" and not build.clean_text(row.get("Restaurant Name"))]
check(len(csv_rows) == 351 and len(blank_names) == 114, "the CSV keeps 351 rows, including 114 blank stubs that stay off the site")
detail_pages = list((ROOT / "restaurants").glob("*/index.html"))
check(len(detail_pages) == len(restaurants), f"generated {len(detail_pages)} detail pages for {len(restaurants)} rows")
check("not on the site yet" not in home and "Design preview" not in home, "homepage should not say the catalog is still a sample")
check("full restaurant CSV" not in home.lower(), "homepage should not say the CSV is withheld")
check("<h1>Where to eat<br> in Destin.</h1>" in home, "homepage headline should say where to eat in Destin")
check('<h1 id="listing-title">Restaurants in Destin</h1>' in directory, "directory heading should target restaurants in Destin")
check("Filter by area, meal, or a few words." in directory, "directory intro should name the filters")
check("Food in Destin and Miramar Beach, Florida." in directory, "directory intro should name Destin and Miramar Beach")
check('id="browse-areas-heading">Browse by area</h2>' in directory, "directory should offer browse by area below the listings")
directory_intro, directory_listings = directory.split('<div id="cards"', 1)
check("Miramar Beach restaurants" not in directory_intro, "area page links should not sit in the filter row")
check('class="section-links"' not in directory_intro, "the filter row should not include the area shortcut nav")
for area_slug, area_name in (
    ("miramar-beach", "Miramar Beach"),
    ("sandestin", "Sandestin"),
    ("grand-boulevard", "Grand Boulevard"),
    ("destin-commons", "Destin Commons"),
    ("mid-destin", "Mid-Destin"),
    ("destin-harbor", "Destin Harbor"),
    ("crystal-beach", "Crystal Beach"),
):
    check(
        f'href="/areas/{area_slug}/">{area_name} restaurants</a>' in directory_listings,
        f"directory should link to {area_name} below the listings",
    )
check('name="area"' in directory and ">All areas</option>" in directory, "directory keeps the area dropdown")
check(
    'class="view-switch"' in directory
    and 'aria-current="page">List</a>' in directory
    and 'data-view="/map/">Map</a>' in directory
    and directory.find('class="view-switch"') < directory.find('id="filters"'),
    "directory should switch between list and map beside the filters",
)
check(
    'name="laurens" value="yes"' in directory and ">Lauren's Favorites</span>" in directory,
    "directory filter should include Lauren's Favorites",
)
map_page = (ROOT / "map" / "index.html").read_text(encoding="utf-8")
check(">Lauren's Favorites</span>" in map_page, "map filter should include Lauren's Favorites")
check('name="area"' in map_page and ">All areas</option>" in map_page, "map keeps the area dropdown")
check(
    'class="view-switch"' in map_page
    and 'aria-current="page">Map</a>' in map_page
    and 'data-view="/restaurants/">List</a>' in map_page
    and map_page.find('class="view-switch"') < map_page.find('id="filters"'),
    "map should switch between list and map beside the filters",
)
favorite_names = sorted(item["name"] for item in restaurants if item.get("laurensFavorite") is True)
check(
    favorite_names
    == [
        "McGuire's Irish Pub",
        "Ruth's Chris Steak House",
        "Seagar's Prime Steaks & Seafood",
        "The Crab Trap Destin",
        "The Melting Pot",
    ],
    f"Lauren's favorites should be the five tagged listings, got {favorite_names}",
)
check(directory.count('data-laurens="yes"') == 5, "directory should mark exactly five Lauren's favorites")
check("laurens" in site_js and "laurensFavorite" in site_js, "site.js should filter Lauren's favorites")
check("The table" not in directory and "Narrow the guide" not in directory, "directory should drop the old heading and intro")
build_src = (ROOT / "scripts" / "build.py").read_text(encoding="utf-8")
check(build_src.count("def build_detail(") == 1, "restaurant profiles should come from one template function")
check(build_src.count("def card(") == 1, "directory cards should come from one template function")
check('"name": "eatingindestin"' in wrangler, "worker name must stay eatingindestin")
check("eatingindestin.com" not in wrangler, "wrangler must not attach the vanity domain")
check("routes" not in wrangler, "wrangler must not declare custom routes")

for meal in ("Breakfast", "Lunch", "Dinner", "Desserts", "Drinks"):
    check(f'href="/restaurants/?meal={meal}"' in home, f"homepage missing meal link {meal}")

areas = json.loads((ROOT / "data" / "locations.json").read_text(encoding="utf-8"))
check(len(areas) == len({item["areaSlug"] for item in restaurants}), f"town pages should match listed areas, got {len(areas)}")
for area in areas:
    check(f'href="/areas/{area["slug"]}/"' in home, f"homepage missing area page {area['slug']}")
    check((ROOT / "areas" / area["slug"] / "index.html").exists(), f"missing town page {area['slug']}")

for restaurant in restaurants:
    path = ROOT / "restaurants" / restaurant["slug"] / "index.html"
    check(path.exists(), f"missing detail page {restaurant['slug']}")
    check(f"/restaurants/{restaurant['slug']}/" in directory, f"directory missing {restaurant['slug']}")
    check(f"{build.ORIGIN}/restaurants/{restaurant['slug']}/" in sitemap, f"sitemap missing {restaurant['slug']}")
    page = path.read_text(encoding="utf-8")
    h1 = page.split("<h1>", 1)[1].split("</h1>", 1)[0]
    check(h1 == build.e(restaurant["name"]), f"detail h1 should be the restaurant name only {restaurant['slug']}")
    check("h1-place" not in page, f"detail page should not add a place subtitle {restaurant['slug']}")
    check('aria-label="Related guides"' not in page, f"listing should not add a related-guides nav {restaurant['slug']}")
    check("Other locations" not in page, f"listing should not add an other-locations block {restaurant['slug']}")
    check('class="profile"' in page and 'class="profile-hero"' in page, f"detail page left the shared profile template {restaurant['slug']}")
    check("maps.googleapis" not in page and "airtable" not in page.lower(), f"detail page calls a paid API {restaurant['slug']}")
    claim = build.e(build.claim_href(restaurant["name"]))
    check(
        f'class="profile-claim"><a href="{claim}">Claim or correct this listing</a>' in page,
        f"detail page missing claim link {restaurant['slug']}",
    )
    check("Claim+or+correct%3A+" in claim, f"claim subject should name the restaurant with a colon {restaurant['slug']}")

check(f"Sitemap: {build.ORIGIN}/sitemap.xml" in robots, "robots missing sitemap")
check("User-agent: *" in robots and "Allow: /" in robots, "robots should allow crawlers")
missing_coords = [item["slug"] for item in restaurants if not isinstance(item.get("lat"), (int, float)) or not isinstance(item.get("lng"), (int, float)) or not item.get("address")]
check(not missing_coords, f"listings missing address or coordinates: {missing_coords}")
photos = [item for item in restaurants if item.get("image")]
missing_photos = sorted(item["slug"] for item in restaurants if not item.get("image"))
check(
    missing_photos
    == [
        "crafty-siren-destin-harbor",
        "harbor-tavern-destin-harbor",
        "lone-wolf-pizza-co-mid-destin",
        "o-quigley-s-seafood-steamer-mid-destin",
        "parlor-doughnuts-destin-mid-destin",
        "sundries-general-market-sandestin",
    ],
    f"unexpected monogram listings: {missing_photos}",
)
check(len(photos) == 209, f"expected 209 restaurant photos, got {len(photos)}")
check(build.local_listing_photo("not-a-restaurant") is None, "a slug without a dropped file should stay a monogram")
check(build.listing_photos("sundries-general-market-sandestin") == [], "Sundries General Market has no photo folder")
check(build.listing_photos("crafty-siren-destin-harbor") == [], "Crafty Siren has no photo folder")
check(
    build.listing_photos("juju-boba-destin-commons")
    == [
        "/images/restaurants/juju-boba-destin-commons/01.jpg",
        "/images/restaurants/juju-boba-destin-commons/02.jpg",
    ],
    "JuJu Boba should use the two supplied photos",
)
check(
    build.listing_photos("moo-la-la-ice-cream-and-desserts-sandestin")
    == [
        "/images/restaurants/moo-la-la-ice-cream-and-desserts-sandestin/01.jpg",
        "/images/restaurants/moo-la-la-ice-cream-and-desserts-sandestin/02.jpg",
        "/images/restaurants/moo-la-la-ice-cream-and-desserts-sandestin/03.jpg",
    ],
    "Moo La-La should use the three supplied photos",
)
harbor_photo = build.listing_photos("harbor-docks-destin-harbor")
check(
    harbor_photo and harbor_photo[0].endswith("/harbor-docks-destin-harbor/01.jpg"),
    f"Harbor Docks cover should be 01, got {harbor_photo}",
)
for item in photos:
    path = ROOT / item["image"].lstrip("/")
    check(path.is_file(), f"missing photo file {item['image']}")
    check(item["image"].endswith("/01.jpg"), f"cover should be 01.jpg for {item['slug']}")
    check(path.stat().st_size < 500_000, f"photo too large for the web: {item['image']}")
readme = (ROOT / "README.md").read_text(encoding="utf-8")
check("images/restaurants/" in readme and "`01` is the cover" in readme, "README should say how restaurant photos are stored")
check("does not call Google Places" in readme, "README should keep Google Places off")
check("popup-address" in site_js and "markerPopup" in site_js, "map popups should include the street address")
check('>View restaurant</a>' in site_js and "View profile" not in site_js, "map popup CTA should say View restaurant")
check('emptyLabel = "Restaurants in Destin"' in site_js, "unfiltered directory title should name restaurants in Destin")
pin_rule = styles.split(".leaflet-marker-icon.pin", 1)
check(len(pin_rule) == 2 and "background:" in pin_rule[1][:400], "map pins must paint a fill on Leaflet's marker class")
check(".leaflet-div-icon.pin" not in styles, "pin styles must not depend on the class Leaflet drops")
about = (ROOT / "about" / "index.html").read_text(encoding="utf-8")
for banned in ("CSV files", "Google Places", "OpenStreetMap tiles", "monogram in a set frame"):
    check(banned not in about, f"about page still mentions {banned}")
check("editorial" not in about.lower(), "about should not call the site an editorial guide")
check("CSV" not in about and "OpenStreetMap" not in about and "Google Places" not in about, "about should stay free of build talk")
check(f"<p>{build.ABOUT_LEAD}</p><p>{build.ABOUT_TOWNS}</p>" in about, "about page should use the two visitor paragraphs")
check("a feel for the place" not in about.split("<main", 1)[-1].split("</main>", 1)[0], "about body should use the new guide copy")
contact = (ROOT / "contact" / "index.html").read_text(encoding="utf-8")
for banned in ("github.com", "GitHub", "restaurants.csv", "locations.csv", "README", "CSV", "Wix", "custom domain"):
    check(banned not in contact, f"contact page still mentions {banned}")
check("Corrections and new listings" in contact, "contact page should keep the corrections heading")
check(
    "Restaurant hours, phone numbers, websites, and other details are listed on each restaurant page." in contact
    and "If something needs to be updated, a restaurant has closed, or we’re missing a place you think should be included, let us know." in contact,
    "contact page should use Marc's first intro paragraph",
)
check(
    "Just include the restaurant name and what needs to be changed or added. We review every submission and can follow up using the email address you provide." in contact,
    "contact page should use Marc's second intro paragraph",
)
check("listing-hint" not in contact and "Update covers hours" not in contact, "contact page should not explain the request types")
check("We read these" not in contact, "contact page should drop the previous intro")
check("Marc" not in contact, "contact page should not name a person")
check(">Submit</button>" in contact, "contact submit button should say Submit")
check("Send to Marc" not in contact and "Town / location" not in contact, "contact form should drop the personal send label and the town field")
check('action="/api/listing"' in contact and 'data-listing' in contact, "contact form should post to the listing endpoint")
check('name="restaurant"' in contact and 'name="details"' in contact, "contact form is missing restaurant fields")
check('name="town"' not in contact, "contact form should not ask for a town")
check('name="name"' in contact and 'name="email"' in contact, "contact form should ask for a reply name and email")
contact_form = contact.split("<form", 1)[1].split("</form>", 1)[0]
contact_fields = ["name", "email", "restaurant", "type", "details"]
contact_order = [contact_form.find(f'name="{field}"') for field in contact_fields]
check(all(index >= 0 for index in contact_order) and contact_order == sorted(contact_order), "contact fields should run name, email, restaurant, type, details")
for request_type in ("update", "edit", "deletion", "new", "other"):
    check(f'value="{request_type}"' in contact, f"contact form missing request type {request_type}")
check(">Other</span>" in contact, "contact form should offer Other next to the other request types")
restaurant_input = re.search(r'<input name="restaurant"[^>]*>', contact)
check(
    restaurant_input is not None and "required" not in restaurant_input.group(0) and "Restaurant name <abbr" not in contact,
    "restaurant name should be optional",
)
check('src="/listing.js"' in contact, "contact page should load the listing form script")
listing_js = (ROOT / "listing.js").read_text(encoding="utf-8")
check("/api/listing" in listing_js, "listing script should post to the worker")
check("Enter the restaurant name." not in listing_js, "listing script should not require a restaurant name")
check('type !== "other"' in listing_js, "listing script should accept an Other request")
check("town" not in listing_js, "listing script should not send a town")
check(
    'queryValue(params, "restaurant", 160)' in listing_js and 'queryValue(params, "subject", 4000)' in listing_js,
    "listing script should read restaurant and subject from the query string",
)
check('class="profile-claim"' not in directory, "directory cards should not repeat the claim link")
check("Marc" not in listing_js and "Thanks. We have your note." in listing_js, "listing script should thank without a personal name")
check(".listing-form" in styles and ".listing-status" in styles, "listing form should use the site styles")
check("See the restaurants" in about and "Open the directory" not in about, "about button should invite visitors in")
check('<h2 id="print-guides-heading">Coming in 2027</h2>' in about, "about page should announce the 2027 print guides")
check(build.e(build.PRINT_GUIDES) in about, "about page should use the print guide paragraph")
contact_sentence = (
    "For information or to reserve your space, please "
    '<a class="text-link" href="/contact/">contact us</a>.'
)
check(f"<p>{contact_sentence}</p>" in about, "print guide section should invite visitors to contact us")
print_section = about.split('<h2 id="print-guides-heading">Coming in 2027</h2>', 1)[-1]
check(
    print_section.find(build.e(build.PRINT_GUIDES)) < print_section.find(contact_sentence) < print_section.find('class="print-covers"'),
    "contact sentence should follow the print guide paragraph",
)
about_main = about.split("<main", 1)[-1].split("</main>", 1)[0]
check("\u2014" not in about_main, "about body should not use an em dash")
check('class="print-covers"' in about, "print covers should share one layout")
for cover in build.PRINT_COVERS:
    check(cover["jpg"] in about and cover["webp"] in about, f"about page should include {cover['jpg']}")
    check(build.e(cover["alt"]) in about, f"about page should describe {cover['jpg']}")
    for name in (cover["jpg"], cover["webp"]):
        cover_path = ROOT / name.lstrip("/")
        check(cover_path.is_file(), f"missing print cover {name}")
        check(cover_path.stat().st_size < 400_000, f"print cover too large for the web: {name}")
guides_css = styles.split(".print-covers {", 1)
check(
    len(guides_css) == 2 and "grid-template-columns: minmax(0, 1fr)" in guides_css[1][:500],
    "print covers should stack in one column by default",
)
desktop_css = styles.split("@media (min-width: 720px)", 1)[1]
check(
    ".print-covers" in desktop_css and "repeat(2, minmax(0, 1fr))" in desktop_css,
    "print covers should sit side by side from 720px",
)
check("Find breakfast, lunch, and dinner in Destin and Miramar Beach" in home, "homepage hero should welcome visitors to Destin")
check('src="/images/hero-beachside-dining.jpg"' in home, "homepage hero should use the harbor dining photo")
check('srcset="/images/hero-beachside-dining.webp"' in home, "homepage hero should offer the WebP photo")
check(
    "Fishing boats in Destin Harbor with a spread of shrimp, oysters, and fresh fish." in home,
    "homepage hero alt should describe the harbor photo",
)
check("de29ed_1473adbe1b4b4c068a746d2bd7c0fc46" not in home, "homepage should drop the old Wix hero")
check(
    'property="og:image" content="https://www.eatingindestin.com/images/hero-beachside-dining.jpg"' in home,
    "homepage share image should be the harbor dining photo",
)
for hero_name in ("images/hero-beachside-dining.jpg", "images/hero-beachside-dining.webp"):
    hero_path = ROOT / hero_name
    check(hero_path.is_file(), f"missing hero photo {hero_name}")
    check(hero_path.stat().st_size < 400_000, f"hero photo too large for the web: {hero_name}")
check("editorial" not in home.lower() and "already filtered" not in home, "homepage should not sound like a product or an editorial")
check("a feel for the place" in home, "homepage essay should use the visitor guide")
areas_index = (ROOT / "areas" / "index.html").read_text(encoding="utf-8")
check("<h1>Restaurant areas in Destin</h1>" in areas_index, "areas page heading should name restaurants in Destin")
check(
    "Explore the neighborhoods in the guide, including Miramar Beach, Sandestin, Destin Harbor, and Crystal Beach." in areas_index,
    "areas page intro should name neighborhoods without a geographic order",
)
ordering_claim = re.compile(r"west\s*(?:to|-|–|—|→)\s*east", re.I)
sweep_phrases = (
    "western edge of the guide",
    "from the Harbor to Crystal Beach",
    "from Destin Harbor to Crystal Beach",
    "from Miramar Beach to Crystal Beach",
    "from Miramar Beach through the Harbor",
    "neighborhoods in between",
    "east end of Destin",
)
copy_files = [
    ROOT / "index.html",
    ROOT / "about" / "index.html",
    ROOT / "llms.txt",
    ROOT / "llms-full.txt",
    ROOT / "data" / "locations.json",
    * (ROOT / "areas").glob("**/index.html"),
    * (ROOT / "guides").glob("**/index.html"),
]
for copy_path in copy_files:
    copy_text = copy_path.read_text(encoding="utf-8")
    check(ordering_claim.search(copy_text) is None, f"{copy_path.relative_to(ROOT)} should not claim a west-to-east order")
    for phrase in sweep_phrases:
        check(phrase not in copy_text, f"{copy_path.relative_to(ROOT)} should not say {phrase!r}")
town_count = styles.split(".town small {", 1)
check(
    len(town_count) == 2 and "white-space: nowrap" in town_count[1][:500],
    "town restaurant counts should stay on one line",
)
check("11 Restaurants" in areas_index and "11 places" not in areas_index, "area cards should count Restaurants")
check("50 Restaurants" in home and re.search(r"\bplaces\b", home) is None, "homepage area counts should say Restaurants")
check(build.restaurant_count_word(1, label=True) == "Restaurant", "a single listing is a Restaurant label")
check(build.restaurant_count_word(7) == "restaurants", "sentence counts stay lowercase")
check("1 restaurant on the map" in site_js and "restaurants on the map" in site_js, "map count should say restaurants")
check("place on the map" not in site_js, "map count should not say place")
check("filter" not in areas_index.lower() and "directory" not in areas_index.lower(), "towns page should not explain the directory")
crystal = (ROOT / "areas" / "crystal-beach" / "index.html").read_text(encoding="utf-8")
check("Show 11 Restaurants" in crystal, "Crystal Beach should label its count as Restaurants")
check("Destin Harbor" in (ROOT / "areas" / "destin-harbor" / "index.html").read_text(encoding="utf-8"), "Destin Harbor stays an area name")
for area_page in (ROOT / "areas").glob("*/index.html"):
    text = area_page.read_text(encoding="utf-8")
    check("Watch a short clip" not in text, f"{area_page.parent.name} still has a clip sentence")
    check(re.search(r"\bplaces\b", text) is None, f"{area_page.parent.name} still says places")
    check("youtube.com" not in text and "youtu.be" not in text, f"{area_page.parent.name} still links to YouTube")
    check("<h1>" in text and 'class="lede"' in text and 'class="card-grid"' in text, f"{area_page.parent.name} lost the town page")
config = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
featured = config.get("featured") or []
by_slug = {item["slug"]: item for item in restaurants}
check(featured == [
    "harbor-docks-destin-harbor",
    "the-back-porch-mid-destin",
    "beach-walk-cafe-crystal-beach",
], "featured cover should be Harbor Docks, The Back Porch, then Beach Walk Cafe")
check(len(set(by_slug[slug]["areaSlug"] for slug in featured)) == len(featured), "featured listings should use different towns")
check({"$$", "$$$"} <= {by_slug[slug]["price"] for slug in featured}, "featured mix should include casual and upscale")
check(home.count('<div class="cover" data-featured') == len(featured), "homepage should render every featured cover")
check("86400000" in home and "from-the-guide" in home, "homepage should rotate the cover by UTC day")
check(home.count('class="kicker">Featured') == len(featured), "each featured cover uses the Featured kicker")
check("From the guide" not in home, "homepage should not keep the old featured heading")
check('aria-label="Previous featured"' in home and 'aria-label="Next featured"' in home, "featured arrows need accessible names")
check('data-featured-step="-1"' in home and 'data-featured-step="1"' in home, "featured arrows should step through the list")
check('class="cover-controls" hidden' in home, "featured arrows stay hidden until the page script runs")
check("stepFeatured" in site_js and "data-featured-step" in site_js, "page script should cycle the featured cover")
check(
    "shouldAutoRotateFeatured" in site_js and "FEATURED_ROTATE_MS = 8000" in site_js,
    "featured cover should advance on its own every 8 seconds",
)
check(
    "prefers-reduced-motion" in site_js and "visibilitychange" in site_js and "pagehide" in site_js,
    "featured auto-rotate should stop for reduced motion, a hidden tab, and leaving the page",
)
check(
    "mouseenter" in site_js and "mouseleave" in site_js and "focusin" in site_js and "focusout" in site_js,
    "featured auto-rotate should pause for pointer and keyboard focus",
)
check("mapListCard" in site_js and "map-thumb" in site_js and "openPopup" in site_js, "map list should use compact cards and still open the pin")
check("#map-list .map-hit" in styles and "#map-list .map-thumb" in styles, "map list cards should stay compact")
check(".cover-arrow" in styles and "min-width: 44px" in styles, "featured arrows should stay large enough to tap")
for slug in featured:
    check(f'/restaurants/{slug}/' in home, f"homepage cover missing {slug}")
    check(f'href="/restaurants/{slug}/">View restaurant</a>' in home, f"featured cover for {slug} should say View restaurant")
    check(f'/images/restaurants/{slug}/01.jpg' in home, f"featured cover for {slug} should use its photo")
check("Read the profile" not in home, "featured cover should not put the profile URL in the label")
check("View restaurant" in home, "featured cover CTA should say View restaurant")
llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
check("CSV" not in llms and "custom domain" not in llms, "llms.txt should stay visitor-facing")
check(
    '"origin": "https://www.eatingindestin.com"' in (ROOT / "site.config.json").read_text(encoding="utf-8"),
    "public origin should be the live www host",
)
check("openstreetmap.org" in site_js, "map tiles must be OpenStreetMap")
check("OpenStreetMap" in (ROOT / "map" / "index.html").read_text(encoding="utf-8"), "map page missing OpenStreetMap")
check("leaflet.js" in (ROOT / "map" / "index.html").read_text(encoding="utf-8"), "map page missing Leaflet")
check("googlePlaceId" not in json.dumps(restaurants), "public json leaked place ids")

harbor = next(item for item in restaurants if item["slug"] == "harbor-docks-destin-harbor")
card = re.search(r'id="r-harbor-docks-destin-harbor"[^>]*>', directory)
check(card is not None, "missing Harbor Docks card")
if card:
    tag = card.group(0)
    check('data-area="destin-harbor"' in tag, "Harbor Docks area filter data")
    check("Breakfast" in tag and "Lunch" in tag and "Dinner" in tag, "Harbor Docks meal data")

harbor_page = (ROOT / "restaurants" / "harbor-docks-destin-harbor" / "index.html").read_text(encoding="utf-8")
harbor_hero = harbor_page.split('class="profile-hero"', 1)[1].split('class="profile-film"', 1)[0]
check("/images/restaurants/harbor-docks-destin-harbor/01.jpg" in harbor_hero, "Harbor Docks hero should be the supplied cover")
check(
    'class="profile-film"' in harbor_page and "/images/restaurants/harbor-docks-destin-harbor/02.jpg" in harbor_page,
    "Harbor Docks profile should show the extra photos",
)
sundries = (ROOT / "restaurants" / "sundries-general-market-sandestin" / "index.html").read_text(encoding="utf-8")
sundries_hero = sundries.split('class="profile-hero"', 1)[1].split('class="wrap profile-head"', 1)[0]
check('class="ph"' in sundries_hero and 'class="mono"' in sundries_hero, "a listing without a photo should keep the monogram")
check("<img" not in sundries_hero and 'class="profile-film"' not in sundries, "Sundries General Market should stay a monogram")
for slug, extras in (
    ("moo-la-la-ice-cream-and-desserts-sandestin", ("02.jpg", "03.jpg")),
):
    page = (ROOT / "restaurants" / slug / "index.html").read_text(encoding="utf-8")
    hero = page.split('class="profile-hero"', 1)[1].split('class="wrap profile-head"', 1)[0]
    check(f"/images/restaurants/{slug}/01.jpg" in hero, f"{slug} hero should be the supplied cover")
    check(
        re.search(r'<div class="ph"[^>]*\shidden>', hero) is not None,
        f"{slug} monogram should stay a hidden fallback behind the photo",
    )
    check(hero.index("<img") < hero.index('class="ph"'), f"{slug} should show the photo ahead of the monogram")
    for extra in extras:
        check(f"/images/restaurants/{slug}/{extra}" in page, f"{slug} profile should show {extra}")
check("static.wixstatic.com" not in home and "static.wixstatic.com" not in harbor_page, "Destin pages should not hotlink Wix photos")
for area in areas:
    slug = area["slug"]
    check(area.get("image") == f"/images/areas/{slug}.jpg", f"{slug} should use its area cover")
    card_html = home.split(f'href="/areas/{slug}/"', 1)[1].split("</a>", 1)[0]
    check(f'src="/images/areas/{slug}.jpg"' in card_html, f"{slug} homepage card should use its area photo")
    check('class="mono"' not in card_html, f"{slug} homepage card should not use a monogram")
    areas_card = areas_index.split(f'href="/areas/{slug}/"', 1)[1].split("</a>", 1)[0]
    check(f'src="/images/areas/{slug}.jpg"' in areas_card, f"{slug} areas page card should use its area photo")
    check('class="mono"' not in areas_card, f"{slug} areas page card should not use a monogram")
    area_page = (ROOT / "areas" / slug / "index.html").read_text(encoding="utf-8")
    area_hero = area_page.split('class="profile-hero"', 1)[1].split('class="wrap page-intro"', 1)[0]
    check(f'src="/images/areas/{slug}.jpg"' in area_hero, f"{slug} area page should use its cover")
    check('class="ph"' not in area_hero, f"{slug} area page hero should not use a monogram")

shared_header = (ROOT / "includes" / "header.html").read_text(encoding="utf-8")
shared_footer = (ROOT / "includes" / "footer.html").read_text(encoding="utf-8")
check('href="/restaurants/"' in shared_header and 'href="/map/"' in shared_header, "shared header is missing nav links")
check('href="/areas/"' in shared_header and 'href="/about/"' in shared_header, "shared header is missing town or about links")
check('href="/guides/"' in shared_header, "shared header is missing the guides link")
check('href="/guides/"' in shared_footer, "shared footer is missing the guides link")
check('href="/guides/best-seafood-destin/"' in home and 'href="/guides/"' in home, "homepage should mention the guides")
check("Popular guides for a trip to Destin and Miramar Beach." in home, "homepage guides mention should stay modest")
guide_index = (ROOT / "guides" / "index.html").read_text(encoding="utf-8")
seafood_page = (ROOT / "guides" / "best-seafood-destin" / "index.html").read_text(encoding="utf-8")
check("<h1>Guides for Destin</h1>" in guide_index, "guides index heading")
check('<h1 class="guide-title">Best seafood in Destin</h1>' in seafood_page, "seafood guide heading")
check('href="/restaurants/?cuisine=Seafood"' in seafood_page, "seafood guide should link the directory filter")
check('href="/map/?cuisine=Seafood"' in seafood_page, "seafood guide should link the map filter")
check('href="/restaurants/?cuisine=Seafood&amp;kids=yes"' in seafood_page, "seafood guide should link kid-friendly seafood")
check("FAQPage" in seafood_page, "seafood guide should include FAQ schema")
check("oysters, shrimp" in seafood_page, "seafood guide should stay specific about the catch")
check("this page gathers" not in seafood_page.lower(), "seafood guide should not explain itself as a tag dump")
check(f"{build.ORIGIN}/guides/" in sitemap and f"{build.ORIGIN}/guides/best-seafood-destin/" in sitemap, "sitemap missing guides")
areas_for_guides = build.load_areas(source)
picks = build.guide_picks(source, areas_for_guides)
check(len(picks) == 9, f"expected 9 guides, got {len(picks)}")
check([item["slug"] for item in picks][0] == "best-seafood-destin", "seafood guide should stay first")
check([item["slug"] for item in picks][-1] == "laurens-favorites-destin", "favorites guide should stay last")
for guide in picks:
    page = (ROOT / "guides" / guide["slug"] / "index.html").read_text(encoding="utf-8")
    check(f'<h1 class="guide-title">{build.e(guide["h1"])}</h1>' in page or f"<h1>{build.e(guide['h1'])}</h1>" in page, f"guide heading {guide['slug']}")
    if guide["slug"] != "index":
        check(f'<h1 class="guide-title">{build.e(guide["h1"])}</h1>' in page, f"guide title class {guide['slug']}")
    check("FAQPage" in page, f"guide FAQ schema {guide['slug']}")
    check(2 <= page.count("<h3>") <= 4, f"guide FAQ count {guide['slug']}")
    check(build.e(guide["directory_href"]) in page, f"directory filter missing {guide['slug']}")
    check(build.e(guide["map_href"]) in page, f"map filter missing {guide['slug']}")
    check(guide["path"] in guide_index, f"guides index missing {guide['slug']}")
    prose = "\n".join(guide["paragraphs"] + [item["answer"] for item in guide["faqs"]])
    for restaurant in source:
        check(restaurant["name"] not in prose, f"{guide['slug']} names {restaurant['name']}")
        present = f"/restaurants/{restaurant['slug']}/" in page
        if restaurant["slug"] in {item["slug"] for item in guide["restaurants"]}:
            check(present, f"{guide['slug']} missing {restaurant['slug']}")
        else:
            check(not present, f"{guide['slug']} should not list {restaurant['slug']}")
    check(f"{build.ORIGIN}{guide['path']}" in sitemap, f"sitemap missing {guide['slug']}")
    check(re.search(r"\b\d+\s+restaurants\b", prose, re.I) is None, f"{guide['slug']} hard-codes a restaurant count")
    hero = page.split('class="profile-hero"', 1)[1].split('class="wrap page-intro"', 1)[0]
    check(f'src="{guide["teaser_image"]}"' in hero, f"{guide['slug']} hero should use its own cover")
    check(f'src="{guide["teaser_image"]}"' in guide_index, f"{guide['slug']} hub card should use its cover")
    check((ROOT / guide["teaser_image"].lstrip("/")).is_file(), f"missing cover for {guide['slug']}")
    check(
        f'property="og:image" content="{build.ORIGIN}{guide["teaser_image"]}"' in page,
        f"{guide['slug']} social image should use its cover",
    )
cover_paths = [guide["teaser_image"] for guide in picks]
check(len(cover_paths) == len(set(cover_paths)) == 9, "each guide needs a different cover image")
check(".h1-place" not in styles, "listing H1 should not style a place subtitle")
check(".profile-links" not in styles, "listing pages should not style a related-guides nav")
for restaurant in source:
    page = (ROOT / "restaurants" / restaurant["slug"] / "index.html").read_text(encoding="utf-8")
    story = page.split('class="prose profile-story"', 1)[1].split("</div>", 1)[0]
    check(story.count("<p>") >= 2, f"listing intro should have the note and a practical paragraph {restaurant['slug']}")
    check("<nav" not in story, f"profile story should stay prose {restaurant['slug']}")
    check("aggregateRating" not in page and '"review"' not in page, f"listing schema should not invent reviews {restaurant['slug']}")
    check('aria-label="Related guides"' not in page, f"related guides nav should stay off the listing {restaurant['slug']}")
    check(f'href="/areas/{restaurant["areaSlug"]}/"' in page, f"area page link missing {restaurant['slug']}")
    check(f"Also in {build.e(restaurant['area'])}" in page or f"Restaurants in {build.e(restaurant['area'])}" in page, f"nearby or area link missing {restaurant['slug']}")
coffee_page = (ROOT / "guides" / "coffee-brunch-destin" / "index.html").read_text(encoding="utf-8")
check("doesn’t list brunch as its own meal" in coffee_page, "coffee guide should say brunch is not its own meal")
check("/restaurants/capriccio-cafe-mid-destin/" not in coffee_page, "coffee guide should follow the Cafe cuisine, not every coffee mention")
water_page = (ROOT / "guides" / "waterfront-destin" / "index.html").read_text(encoding="utf-8")
check("don’t score a table as on the water" in water_page, "waterfront guide should say outdoor seating is not a view rating")
check("/restaurants/whataburger-destin-harbor-destin-harbor/" not in water_page, "a harbor listing without outdoor seating is not on the waterfront guide")
check("/restaurants/chipotle-mexican-grill-destin-commons-destin-commons/" not in water_page, "a shopping-center patio is not on the waterfront guide")
check("/restaurants/whataburger-destin-harbor-destin-harbor/" in (ROOT / "guides" / "destin-harbor-restaurants" / "index.html").read_text(encoding="utf-8"), "harbor guide should keep the full area list")
llms = (ROOT / "llms.txt").read_text(encoding="utf-8")
check(f"{build.ORIGIN}/guides/" in llms, "llms.txt should link the guides")
check('href="/contact/"' in shared_footer and "site-footer" in shared_footer, "shared footer is missing links")
check(
    'src="/images/eating-in-destin-logo.png"' in shared_header and 'alt="Eating in Destin"' in shared_header,
    "header should use the Eating in Destin logo",
)
check("<em>Eating</em>" not in shared_header, "header should not keep the text wordmark")
check('class="footer-mark"' in shared_footer and 'src="/images/eating-in-destin-logo.png"' in shared_footer, "footer should use the Eating in Destin logo")
check('alt="Eating in Destin"' in shared_footer and "<em>Eating</em>" not in shared_footer, "footer logo needs alt text")
check(
    'class="footer-sister"' in shared_footer
    and "Be sure to also check out" in shared_footer
    and 'src="/images/eating-on-30a-logo.png"' in shared_footer
    and 'alt="Eating on 30A"' in shared_footer
    and 'href="https://eatingon30a.352marc.workers.dev"' in shared_footer,
    "footer should point visitors to Eating on 30A",
)
check((ROOT / "images" / "eating-on-30a-logo.png").is_file(), "30A logo should live in images")
check("workers.dev/images" not in shared_footer, "30A logo should not be hotlinked")
sister_css = styles.split(".footer-sister a", 1)
check(
    len(sister_css) == 2 and "flex-wrap: wrap" in sister_css[1][:500],
    "30A footer promo should wrap instead of overflowing",
)
check("logo.svg" not in shared_header and "logo.svg" not in shared_footer and not (ROOT / "logo.svg").exists(), "the masthead file should stay out of the site")
check((ROOT / "images" / "eating-in-destin-logo.png").is_file(), "transparent logo file should be in images")
check('href="/favicon.png"' in home and 'href="/apple-touch-icon.png"' in home, "home should link the circle favicon")
check('href="/favicon.svg"' not in home, "home should not keep the old svg favicon")
check((ROOT / "favicon.png").is_file() and (ROOT / "favicon.ico").is_file(), "favicon png and ico should exist")
check((ROOT / "apple-touch-icon.png").is_file() and (ROOT / "images" / "eating-favicon-512.png").is_file(), "apple touch and 512 favicon should exist")
check(not (ROOT / "favicon.svg").exists(), "old svg favicon should be removed")
check("brand-logo" not in styles and "subscribe-band" in styles and "subscribe-popup" in styles, "subscribe styles should stay in place")
check("Yes, I want coupons!" in shared_footer and 'name="email"' in shared_footer, "footer subscribe is missing the coupon fields")
check(">Local<" in shared_footer and ">Visitor<" in shared_footer, "footer subscribe should offer Local and Visitor")
check('id="subscribe-popup"' in shared_footer and "Exclusive restaurant coupons" in shared_footer, "coupon popup and footer headline")
subscribe_js = (ROOT / "subscribe.js").read_text(encoding="utf-8")
check("30000" in subscribe_js and "localStorage" in subscribe_js, "popup should wait 30s and remember dismiss in localStorage")
worker_js = (ROOT / "worker.js").read_text(encoding="utf-8")
check("CONTACT_EMAIL" in worker_js and "RESEND_API_KEY" in worker_js and "SUBSCRIBE_FROM" in worker_js, "signup mail should name its env vars")
check("GOOGLE_SHEETS_WEBHOOK_URL" in worker_js and "GOOGLE_SHEETS_WEBHOOK_TOKEN" in worker_js, "signup sheet should name its env vars")
check('pathname === "/api/listing"' in worker_js and "reply_to" in worker_js, "listing mail should use the same Resend secrets and a reply address")
check("run_worker_first" in wrangler and '"main": "worker.js"' in wrangler, "api subscribe should be served by the worker")
html_pages = [
    path
    for path in ROOT.rglob("*.html")
    if ".wrangler" not in path.parts and "includes" not in path.parts
]
check(html_pages, "no html pages to check for shared chrome")
for page in html_pages:
    text = page.read_text(encoding="utf-8")
    rel = page.relative_to(ROOT).as_posix()
    check('id="site-header"' in text, f"{rel} does not mount the shared header")
    check('id="site-footer"' in text, f"{rel} does not mount the shared footer")
    check('src="/header.js"' in text and 'src="/footer.js"' in text, f"{rel} does not load the shared header and footer scripts")
    check("<header class=\"site-header\">" not in text, f"{rel} still inlines the header")
    check("footer-mark" not in text, f"{rel} still inlines the footer")

blob = "\n".join([home, directory, site_js, styles, (ROOT / "map" / "index.html").read_text(encoding="utf-8")])
for banned in ("maps.googleapis", "places.googleapis", "airtable.com", "maps.google.com"):
    check(banned not in blob, f"found banned dependency {banned}")

if failures:
    print("\n".join(failures))
    raise SystemExit(1)
print(f"site check ok ({len(restaurants)} restaurants, {len(areas)} towns)")
