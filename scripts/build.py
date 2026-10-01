#!/usr/bin/env python3
"""Build the Eating in Destin static site from data/*.csv.

Edit the CSVs, then run: python3 scripts/build.py
"""

from __future__ import annotations

import csv
import html
import json
import os
import re
import shutil
import unicodedata
from pathlib import Path
from urllib.parse import unquote, urlencode

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
CONFIG = json.loads((ROOT / "site.config.json").read_text(encoding="utf-8"))
ORIGIN = os.environ.get("SITE_ORIGIN", CONFIG["origin"]).rstrip("/")
SHARE_IMAGE = "/images/og-destin-harbor.jpg"
SHARE_ALT = "Fishing boats in Destin Harbor with shrimp, oysters, and fresh fish on the dock."
# Local homepage hero for Destin Harbor.
HERO_IMAGE = "/images/hero-beachside-dining.jpg"
HERO_WEBP = "/images/hero-beachside-dining.webp"
HERO_ALT = "Fishing boats in Destin Harbor with a spread of shrimp, oysters, and fresh fish."

# Display order for area lists. Keep this sequence; it is not a geographic sort.
AREA_ORDER = [
    "miramar-beach",
    "sandestin",
    "grand-boulevard",
    "destin-commons",
    "mid-destin",
    "destin-harbor",
    "crystal-beach",
]

SHORT_NAMES = {
    "miramar-beach": "Miramar Beach",
    "sandestin": "Sandestin",
    "grand-boulevard": "Grand Boulevard",
    "destin-commons": "Destin Commons",
    "mid-destin": "Mid-Destin",
    "destin-harbor": "Destin Harbor",
    "crystal-beach": "Crystal Beach",
}

FALLBACK_COPY = {
    "miramar-beach": "Beach restaurants along Scenic Gulf Drive, Silver Sands, and US 98.",
    "sandestin": "Baytowne Wharf, the marina, and the resort hotels, with waterfront dining inside Sandestin.",
    "grand-boulevard": "The Sandestin town center north of the bay, with sit-down restaurants around the square.",
    "destin-commons": "The open-air shopping center in Destin, with casual dining along the commons and Commons Drive.",
    "mid-destin": "The US 98 stretch through Destin, with everyday restaurants between the harbor and Sandestin.",
    "destin-harbor": "HarborWalk Village and the Destin Harbor docks, with seafood houses on the water.",
    "crystal-beach": "Along Scenic 98, including Henderson Beach and the gulf-front inns.",
}

MEAL_ORDER = ["Breakfast", "Lunch", "Dinner", "Desserts", "Drinks"]

# Curated list. Names are matched loosely (apostrophes and a trailing s)
# so the published row is tagged without adding a column to the CSV export.
LAURENS_FAVORITES = (
    ("The Melting Pot", ("melting pot",)),
    ("McGuire's", ("mcguire", "mcguires")),
    ("Seagar's", ("seagar", "seagars")),
    ("Ruth's Chris", ("ruths chris", "ruth chris", "ruth kris")),
    ("Crab Trap", ("crab trap",)),
)

# None publishes every PUBLISHED row in data/restaurants.csv.
# Set this to a list of slugs only when a design sample is needed again.
SAMPLE_SLUGS = None

# The Wix export's detail photo for Stinky's is a multi-megabyte PNG.
# The cover now comes from the supplied photo set. The logo stays a local file.
LOCAL_WIX_FILES = {
    "de29ed_1a5c50c91a154838816cc7ea7b48a6c6~mv2.png": "/images/restaurants/stinkys-fish-camp-dune-allen-beach/01.jpg",
    "de29ed_29920b8a7db54505a77b6a647ed4a343~mv2.jpg": "/images/restaurants/stinkys-fish-camp-logo.jpg",
}

PHOTO_DIR = ROOT / "images" / "restaurants"
AREA_PHOTO_DIR = ROOT / "images" / "areas"
PHOTO_EXTS = (".jpg", ".jpeg", ".webp", ".png")

ABOUT = (
    "Eating in Destin is a restaurant guide for Destin and Miramar Beach. "
    "Find breakfast, lunch, and dinner, "
    "with the address, the hours, and a feel for the place."
)
ABOUT_LEAD = (
    "Eating in Destin is your guide to dining in Destin and Miramar Beach. "
    "Discover breakfast, lunch, and dinner, with restaurant locations, hours, and a sense of what to expect before you go."
)
ABOUT_TOWNS = (
    "Explore the areas along this stretch of the Emerald Coast, including Miramar Beach, Sandestin, Grand Boulevard, "
    "Destin Commons, Mid-Destin, Destin Harbor, and Crystal Beach."
)
PRINT_GUIDES = (
    "Looking ahead, we\u2019ll also be launching a printed version of the \"Eating In\" guides in 2027, "
    "bringing the same curated experience into a high-quality physical format you can bring along."
)
DECAL_IMAGE = "/images/about-decal-destin.png"
DECAL_WEBP = "/images/about-decal-destin.webp"
DECAL_ALT = "Circular Eating in Destin window decal that reads Proudly listed on Eating in Destin."
DECAL_SUBJECT = "Free window decal"
PRINT_COVERS = (
    {
        "jpg": "/images/guides/eating-in-destin-spring-summer-2027.jpg",
        "webp": "/images/guides/eating-in-destin-spring-summer-2027.webp",
        "width": 1024,
        "height": 1536,
        "alt": (
            "Spring/Summer 2027 cover of Eating in Destin, with oysters, fish tacos, "
            "and cocktails on a table at Destin Harbor."
        ),
    },
    {
        "jpg": "/images/guides/eating-on-30a-spring-summer-2027.jpg",
        "webp": "/images/guides/eating-on-30a-spring-summer-2027.webp",
        "width": 1024,
        "height": 1536,
        "alt": (
            "Spring/Summer 2027 cover of Eating on 30A, with seared scallops "
            "in front of white beach houses along the Gulf."
        ),
    },
)
TOWNS = (
    "The areas in the guide are Miramar Beach, Sandestin, Grand Boulevard, Destin Commons, "
    "Mid-Destin, Destin Harbor, and Crystal Beach."
)


def e(value) -> str:
    return html.escape("" if value is None else str(value), quote=True)


def claim_href(name: str) -> str:
    """Contact URL that names the listing for a claim or a correction."""
    query = urlencode(
        {
            "restaurant": name,
            "subject": f"Claim or correct: {name}",
        }
    )
    return f"/contact/?{query}"


def decal_contact_href() -> str:
    """Contact URL for a restaurant asking for the free window decal."""
    return "/contact/?" + urlencode({"subject": DECAL_SUBJECT})


def slugify(value: str) -> str:
    text = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode("ascii")
    text = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return text or "restaurant"


def parse_list(raw: str) -> list[str]:
    raw = (raw or "").strip()
    if not raw:
        return []
    try:
        value = json.loads(raw)
    except json.JSONDecodeError:
        return [raw]
    if isinstance(value, list):
        items = [str(item).strip() for item in value]
    elif isinstance(value, str):
        items = [value.strip()]
    else:
        items = []
    return [item for item in items if item and item.upper() != "TBD"]


def is_yes(raw: str) -> bool:
    return any(item.lower() in {"yes", "occasional"} for item in parse_list(raw))


def fold_name(name: str) -> str:
    text = unicodedata.normalize("NFKD", name or "")
    for mark in ("'", "’", "‘", "`"):
        text = text.replace(mark, "")
    text = text.encode("ascii", "ignore").decode("ascii").lower()
    return re.sub(r"[^a-z0-9]+", " ", text).strip()


def token_matches(token: str, alias: str) -> bool:
    return token == alias or token == f"{alias}s" or alias == f"{token}s"


def phrase_matches(name: str, alias: str) -> bool:
    tokens = fold_name(name).split()
    wanted = fold_name(alias).split()
    if not wanted or len(wanted) > len(tokens):
        return False
    width = len(wanted)
    for start in range(len(tokens) - width + 1):
        window = tokens[start : start + width]
        if all(token_matches(token, want) for token, want in zip(window, wanted)):
            return True
    return False


def laurens_favorite_label(name: str) -> str | None:
    hits = [label for label, aliases in LAURENS_FAVORITES if any(phrase_matches(name, alias) for alias in aliases)]
    if len(hits) > 1:
        raise SystemExit(f"{name} matches more than one Lauren's favorite: {', '.join(hits)}")
    return hits[0] if hits else None


def assert_laurens_favorites(restaurants: list[dict]) -> None:
    found: dict[str, list[str]] = {label: [] for label, _aliases in LAURENS_FAVORITES}
    for restaurant in restaurants:
        label = laurens_favorite_label(restaurant["name"])
        if restaurant["laurensFavorite"] != (label is not None):
            raise SystemExit(f"Lauren's favorite flag drifted for {restaurant['name']}")
        if label:
            found[label].append(restaurant["name"])
    problems = [f"{label} matched {names or 'nothing'}" for label, names in found.items() if len(names) != 1]
    if problems:
        raise SystemExit("Lauren's favorites must match exactly one listing each: " + "; ".join(problems))


def clean_text(raw: str) -> str:
    return re.sub(r"\s+", " ", (raw or "").replace("\u00a0", " ")).strip()


def clean_hours(raw: str) -> str:
    text = clean_text(raw)
    if not text or not re.search(r"\d", text):
        return ""
    return text


def parse_address(raw: str) -> dict:
    empty = {"formatted": "", "lat": None, "lng": None, "postal": "", "street": "", "region": "FL", "city": ""}
    raw = (raw or "").strip()
    if not raw:
        return empty
    try:
        data = json.loads(raw)
    except json.JSONDecodeError:
        empty["formatted"] = raw
        return empty
    if not isinstance(data, dict):
        return empty
    loc = data.get("location") or {}
    street = data.get("streetAddress") or {}
    number = clean_text(street.get("number") or "")
    name = clean_text(street.get("name") or "")
    apt = clean_text(street.get("apt") or "")
    line = " ".join(part for part in (number, name) if part)
    if apt:
        line = f"{line}, {apt}" if line else apt
    lat = loc.get("latitude")
    lng = loc.get("longitude")
    try:
        lat = float(lat) if lat not in (None, "") else None
        lng = float(lng) if lng not in (None, "") else None
    except (TypeError, ValueError):
        lat = lng = None
    return {
        "formatted": clean_text(data.get("formatted") or ""),
        "lat": lat,
        "lng": lng,
        "postal": clean_text(data.get("postalCode") or ""),
        "street": line,
        "region": clean_text(data.get("subdivision") or "") or "FL",
        "city": clean_text(data.get("city") or ""),
    }


PHOTO_FRAMES = ("01", "02", "03", "04", "05")


def local_listing_photo(slug: str) -> str | None:
    """Use images/restaurants/<slug>.<ext> when someone drops a single cover in that folder."""
    for ext in PHOTO_EXTS:
        if (PHOTO_DIR / f"{slug}{ext}").is_file():
            return f"/images/restaurants/{slug}{ext}"
    return None


def listing_photos(slug: str) -> list[str]:
    """Photos for one listing. 01 is the cover; later frames are extras on the profile."""
    folder = PHOTO_DIR / slug
    found: list[str] = []
    if folder.is_dir():
        for stem in PHOTO_FRAMES:
            for ext in PHOTO_EXTS:
                if (folder / f"{stem}{ext}").is_file():
                    found.append(f"/images/restaurants/{slug}/{stem}{ext}")
                    break
    if found:
        return found
    single = local_listing_photo(slug)
    return [single] if single else []


def local_area_photo(slug: str) -> str | None:
    """Town card photo dropped in images/areas/<slug>.<ext>."""
    for ext in PHOTO_EXTS:
        if (AREA_PHOTO_DIR / f"{slug}{ext}").is_file():
            return f"/images/areas/{slug}{ext}"
    return None


def area_photo(slug: str, raw: str) -> str | None:
    """CSV image first, then a local file named for the town slug."""
    raw = (raw or "").strip()
    if raw.startswith("/images/"):
        if (ROOT / raw.lstrip("/")).is_file():
            return raw
    remote = wix_to_url(raw, 1200, 800)
    if remote:
        return remote
    return local_area_photo(slug)


def wix_to_url(raw: str, width: int, height: int) -> str | None:
    raw = (raw or "").strip()
    if not raw:
        return None
    if raw.startswith(("http://", "https://")):
        return raw
    match = re.match(r"wix:image://v1/([^/#]+)/([^#]*)", raw)
    if not match:
        return None
    file_id, name = match.group(1), unquote(match.group(2))
    if "heart" in name.lower() and "shape" in name.lower():
        return None
    if file_id in LOCAL_WIX_FILES:
        return LOCAL_WIX_FILES[file_id]
    safe = re.sub(r"[^A-Za-z0-9._-]+", "-", name) or "photo.jpg"
    return (
        f"https://static.wixstatic.com/media/{file_id}/v1/fill/"
        f"w_{width},h_{height},al_c,q_75,enc_auto/{safe}"
    )


def tel_href(phone: str) -> str:
    digits = re.sub(r"\D", "", phone or "")
    if len(digits) == 10:
        return f"tel:+1{digits}"
    if len(digits) == 11 and digits.startswith("1"):
        return f"tel:+{digits}"
    return f"tel:{digits}" if digits else ""


def website_href(raw: str) -> str:
    raw = clean_text(raw)
    if not raw:
        return ""
    if raw.startswith(("http://", "https://")):
        return raw
    return "https://" + raw


def tone_for(cuisines: list[str], foods: list[str], category: str) -> str:
    blob = " ".join(cuisines + foods + [category]).lower()
    if any(word in blob for word in ("coffee", "cafe", "donut")):
        return "coffee"
    if any(word in blob for word in ("dessert", "ice cream", "chocolate", "sweet")):
        return "sweet"
    if "pizza" in blob or "italian" in blob:
        return "italian"
    if "sushi" in blob or "japanese" in blob:
        return "sushi"
    if any(word in blob for word in ("seafood", "oyster", "fish")):
        return "seafood"
    if "burger" in blob:
        return "burger"
    if any(word in blob for word in ("mexican", "taco", "latin")):
        return "spice"
    if any(word in blob for word in ("wine", "bar")):
        return "wine"
    return "gulf"


def snippet(text: str, limit: int = 150) -> str:
    text = clean_text(text)
    if len(text) <= limit:
        return text
    cut = text[:limit].rsplit(" ", 1)[0]
    return cut.rstrip(".,;:") + "…"


def ymd(value: str) -> str:
    value = (value or "").strip()
    return value[:10] if re.match(r"\d{4}-\d{2}-\d{2}", value) else ""


def load_rows(path: Path) -> list[dict]:
    with path.open(encoding="utf-8-sig", newline="") as handle:
        return list(csv.DictReader(handle))


def unique_slug(base: str, used: set[str]) -> str:
    slug = base or "restaurant"
    if slug not in used:
        used.add(slug)
        return slug
    number = 2
    while f"{slug}-{number}" in used:
        number += 1
    slug = f"{slug}-{number}"
    used.add(slug)
    return slug


def load_restaurants() -> list[dict]:
    used: set[str] = set()
    restaurants = []
    for row in load_rows(DATA / "restaurants.csv"):
        if clean_text(row.get("Status")) != "PUBLISHED":
            continue
        name = clean_text(row.get("Restaurant Name"))
        # The export includes published stub rows carried over with no name or area.
        # Those rows are not listings, so the guide skips them.
        if not name:
            continue
        area_slug = slugify(row.get("map_area_slug") or row.get("map_area") or "destin")
        given = clean_text(row.get("slug"))
        if given:
            base = slugify(given)
        else:
            item = clean_text(row.get("Restaurants (Item)"))
            tail = unquote(item.rstrip("/").split("/")[-1]) if item else ""
            base = slugify(tail) if tail else slugify(f"{name}-{area_slug}")
        slug = unique_slug(base, used)
        address = parse_address(row.get("address") or "")
        cuisines = parse_list(row.get("Cuisine Type"))
        meals = parse_list(row.get("Meal Type"))
        foods = parse_list(row.get("Food Type"))
        vibes = parse_list(row.get("Vibe"))
        categories = parse_list(row.get("Category"))
        category = categories[0] if categories else ""
        area = clean_text(row.get("map_area")) or SHORT_NAMES.get(area_slug, area_slug)
        subarea = clean_text(row.get("subarea"))
        notes = clean_text(row.get("notes"))
        phone = clean_text(row.get("phone"))
        list_image = wix_to_url(row.get("List Image") or "", 960, 600)
        detail_image = wix_to_url(row.get("Detail Image") or "", 1400, 780)
        logo = wix_to_url(row.get("Logo") or "", 400, 300)
        photos = listing_photos(slug)
        dropped = photos[0] if photos else None
        card_image = dropped or list_image or detail_image
        hero_image = dropped or detail_image or list_image
        search = " ".join(
            [
                name,
                area,
                subarea,
                clean_text(row.get("location_label")),
                " ".join(cuisines),
                " ".join(meals),
                " ".join(foods),
                category,
                notes,
                clean_text(row.get("Search Terms")),
                clean_text(row.get("price")),
            ]
        ).lower()
        restaurants.append(
            {
                "slug": slug,
                "name": name,
                "area": area,
                "areaSlug": area_slug,
                "subarea": subarea,
                "label": clean_text(row.get("location_label")),
                "address": address["formatted"],
                "street": address["street"],
                "postal": address["postal"],
                "region": address["region"],
                "city": address["city"],
                "lat": address["lat"],
                "lng": address["lng"],
                "phone": phone,
                "tel": tel_href(phone),
                "website": website_href(row.get("website") or ""),
                "price": clean_text(row.get("price")),
                "notes": notes,
                "hours": clean_hours(row.get("hours") or ""),
                "cuisines": cuisines,
                "meals": meals,
                "foods": foods,
                "vibes": vibes,
                "category": category,
                "outdoor": is_yes(row.get("Outdoor Dining")),
                "kids": is_yes(row.get("Kid Friendly")),
                "music": is_yes(row.get("Live Music")),
                "laurensFavorite": laurens_favorite_label(name) is not None,
                "happyDrinks": is_yes(row.get("Happy Hour (drinks)")),
                "happyFood": is_yes(row.get("Happy Hour (food)")),
                "reservations": is_yes(row.get("Reservations")),
                "facebook": website_href(row.get("Facebook URL") or ""),
                "instagram": website_href(row.get("Instagram") or ""),
                "cardImage": card_image,
                "heroImage": hero_image,
                "photos": photos,
                "logo": logo,
                "tone": tone_for(cuisines, foods, category),
                "search": search,
                "updated": ymd(row.get("Updated Date") or ""),
            }
        )
    restaurants.sort(key=lambda item: item["name"].lower())
    assert_laurens_favorites(restaurants)
    return restaurants


def published_restaurants() -> list[dict]:
    """Listings that should appear on the site. The shell uses SAMPLE_SLUGS."""
    restaurants = load_restaurants()
    if not SAMPLE_SLUGS:
        return restaurants
    by_slug = {restaurant["slug"]: restaurant for restaurant in restaurants}
    missing = [slug for slug in SAMPLE_SLUGS if slug not in by_slug]
    if missing:
        raise SystemExit("Sample slugs missing from data/restaurants.csv: " + ", ".join(missing))
    return [by_slug[slug] for slug in SAMPLE_SLUGS]


def sample_banner() -> str:
    if not SAMPLE_SLUGS:
        return ""
    return (
        '<p class="sample-banner">Design preview. These pages use a sample of listings so the look and filters can be approved. '
        "The full restaurant CSV stays in the project and is not on the site yet.</p>"
    )


def load_areas(restaurants: list[dict]) -> list[dict]:
    by_slug: dict[str, dict] = {}
    for row in load_rows(DATA / "locations.csv"):
        if clean_text(row.get("Status")) not in {"", "PUBLISHED"}:
            continue
        slug = slugify(row.get("area_slug") or "")
        if not slug or slug == "30a":
            continue
        by_slug[slug] = {
            "slug": slug,
            "name": SHORT_NAMES.get(slug) or clean_text(row.get("area_name")).title(),
            "fullName": "",
            "description": clean_text(row.get("description")) or FALLBACK_COPY.get(slug, ""),
            "image": area_photo(slug, row.get("Location Image") or ""),
        }
    for slug, copy in FALLBACK_COPY.items():
        by_slug.setdefault(
            slug,
            {
                "slug": slug,
                "name": SHORT_NAMES.get(slug, slug),
                "fullName": "",
                "description": copy,
                "image": None,
            },
        )
    counts: dict[str, int] = {}
    full_names: dict[str, str] = {}
    for restaurant in restaurants:
        counts[restaurant["areaSlug"]] = counts.get(restaurant["areaSlug"], 0) + 1
        full_names.setdefault(restaurant["areaSlug"], restaurant["area"])
        if restaurant["areaSlug"] not in by_slug:
            by_slug[restaurant["areaSlug"]] = {
                "slug": restaurant["areaSlug"],
                "name": SHORT_NAMES.get(restaurant["areaSlug"], restaurant["area"]),
                "fullName": restaurant["area"],
                "description": FALLBACK_COPY.get(restaurant["areaSlug"], ""),
                "image": None,
            }
    ordered = []
    seen = set()
    for slug in AREA_ORDER + sorted(by_slug):
        if slug in seen or slug not in by_slug or counts.get(slug, 0) == 0:
            continue
        seen.add(slug)
        area = by_slug[slug]
        area["fullName"] = full_names.get(slug, area["name"])
        area["name"] = SHORT_NAMES.get(slug, area["fullName"])
        area["count"] = counts[slug]
        if not area.get("image"):
            area["image"] = local_area_photo(slug)
        ordered.append(area)
    return ordered


def hero_image() -> str | None:
    if (ROOT / HERO_IMAGE.lstrip("/")).is_file():
        return HERO_IMAGE
    for row in load_rows(DATA / "locations.csv"):
        if slugify(row.get("area_slug") or "") == "destin":
            return wix_to_url(row.get("Location Image") or "", 1800, 1200)
    return None


def hero_markup(hero: str | None) -> tuple[str, str]:
    if not hero:
        return "", SHARE_ALT
    alt = HERO_ALT if hero == HERO_IMAGE else SHARE_ALT
    width, height = 1800, 1200
    if hero.startswith("/"):
        info = local_image_info(ROOT / hero.lstrip("/"))
        if info:
            width, height = info[0], info[1]
    img = (
        f'<img class="hero-photo" src="{e(hero)}" alt="{e(alt)}" width="{width}" height="{height}">'
    )
    if hero == HERO_IMAGE and (ROOT / HERO_WEBP.lstrip("/")).is_file():
        img = f'<picture><source srcset="{e(HERO_WEBP)}" type="image/webp">{img}</picture>'
    return img, alt


MONOGRAM_SKIP = {"the", "and", "at", "of", "a", "an", "by", "for", "on", "in"}


def shot_label(restaurant: dict) -> str:
    if restaurant["foods"]:
        return restaurant["foods"][0]
    if restaurant["cuisines"]:
        return restaurant["cuisines"][0]
    return restaurant["area"]


def monogram(name: str) -> str:
    cleaned = (name or "").replace("’", "").replace("'", "").replace("&", " ")
    words = [word for word in re.findall(r"[A-Za-z0-9]+", cleaned) if word.lower() not in MONOGRAM_SKIP]
    if not words:
        words = re.findall(r"[A-Za-z0-9]+", name or "") or ["E"]
    return "".join(word[0] for word in words[:2]).upper()


def placeholder(tone: str, label: str, name: str = "", hidden: bool = False) -> str:
    mark = monogram(name or label)
    flag = " hidden" if hidden else ""
    return (
        f'<div class="ph" data-tone="{e(tone)}"{flag}>'
        f'<span class="mono" aria-hidden="true">{e(mark)}</span>'
        f'<span class="ph-label">{e(label)}</span></div>'
    )


def filmstrip(restaurant: dict) -> str:
    extras = (restaurant.get("photos") or [])[1:]
    if not extras:
        return ""
    frames = "".join(
        f'<img src="{e(src)}" alt="{e(photo_alt(restaurant))}" loading="lazy">'
        for src in extras
    )
    return f'<div class="profile-film" data-count="{len(extras)}">{frames}</div>'


def media_block(image: str | None, alt: str, tone: str, label: str, eager: bool = False, name: str = "") -> str:
    mark_name = name or alt
    if not image:
        return placeholder(tone, label, mark_name)
    loading = "eager" if eager else "lazy"
    return (
        f'<img src="{e(image)}" alt="{e(alt)}" loading="{loading}" '
        'onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector(\'.ph\');if(f)f.hidden=false">'
        f"{placeholder(tone, label, mark_name, hidden=True)}"
    )


def card(restaurant: dict, heading: str = "h2") -> str:
    meals = " · ".join(restaurant["meals"])
    cuisines = ", ".join(restaurant["cuisines"])
    bits = [bit for bit in (restaurant["price"], cuisines, meals) if bit]
    label = shot_label(restaurant)
    area_line = restaurant["area"]
    if restaurant["subarea"]:
        area_line += f" · {restaurant['subarea']}"
    yes_no = lambda flag: "yes" if flag else "no"
    attrs = " ".join(
        [
            f'id="r-{e(restaurant["slug"])}"',
            f'href="/restaurants/{e(restaurant["slug"])}/"',
            'class="card"',
            f'data-area="{e(restaurant["areaSlug"])}"',
            f'data-meals="{e("|".join(restaurant["meals"]))}"',
            f'data-cuisines="{e("|".join(restaurant["cuisines"]))}"',
            f'data-outdoor="{yes_no(restaurant["outdoor"])}"',
            f'data-kids="{yes_no(restaurant["kids"])}"',
            f'data-music="{yes_no(restaurant["music"])}"',
            f'data-laurens="{yes_no(restaurant["laurensFavorite"])}"',
            f'data-search="{e(restaurant["search"])}"',
        ]
    )
    note = snippet(restaurant["notes"])
    note_html = f'<p class="note">{e(note)}</p>' if note else ""
    return (
        f'<a {attrs}>'
        f'<div class="card-media">{media_block(restaurant["cardImage"], photo_alt(restaurant), restaurant["tone"], label, name=restaurant["name"])}</div>'
        f'<div class="card-body"><p class="card-area">{e(area_line)}</p>'
        f'<{heading}>{e(restaurant["name"])}</{heading}>'
        f'<p class="meta">{e(" · ".join(bits))}</p>{note_html}</div></a>'
    )


def photo_alt(restaurant: dict) -> str:
    return f"{restaurant['name']} in {restaurant['area']}, Destin"


def oxford(items: list[str]) -> str:
    items = [clean_text(item) for item in items if clean_text(item)]
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + ", and " + items[-1]


def sentence(text: str) -> str:
    text = clean_text(text).rstrip(".")
    return f"{text}." if text else ""


def within_meta(text: str) -> str | None:
    """Search snippets stay in the range the rest of the guide already uses."""
    text = clean_text(text)
    if 110 <= len(text) <= 165 and "Destin" in text:
        return text
    return None


BROAD_PLACES = {
    "destin",
    "miramar beach",
    "sandestin",
    "grand boulevard",
    "destin commons",
    "mid-destin",
    "crystal beach",
    "destin harbor",
}


def label_parts(label: str) -> tuple[str, str]:
    label = clean_text(label)
    if "|" not in label:
        return label, ""
    left, right = [clean_text(part) for part in label.split("|", 1)]
    return left, right


def is_road(text: str) -> bool:
    lowered = text.lower()
    return any(word in lowered for word in ("us 98", "scenic", "highway", "drive", "old 98", "hwy"))


def place_in_name(name: str, place: str) -> bool:
    return bool(place) and place.lower() in name.lower()


def mentions_destin(text: str) -> bool:
    return re.search(r"\bDestin\b", text) is not None


def heading_cue(restaurant: dict) -> str:
    """Neighborhood, road, or city from the listing. Nothing is invented."""
    name = restaurant["name"]
    area = restaurant["area"]
    city = restaurant["city"] or "Destin"
    left, right = label_parts(restaurant["label"])

    def fresh(part: str) -> bool:
        if not part or place_in_name(name, part):
            return False
        return part.lower() not in {area.lower(), city.lower(), "destin"}

    if area and not place_in_name(name, area):
        if city.lower() == "destin" and "destin" not in area.lower() and "destin" not in name.lower():
            return f"{area}, Destin"
        if (
            city.lower() not in {area.lower(), "destin"}
            and city.lower() not in area.lower()
            and not place_in_name(name, city)
        ):
            return f"{area}, {city}"
        return area
    for part in (left, right):
        if fresh(part):
            return part
    if not place_in_name(name, "Destin") and not place_in_name(name, city):
        if "destin" in city.lower():
            return city
        return f"{city}, Destin"
    if "destin" not in name.lower():
        return "Destin"
    return "Destin"


def cue_lead(cue: str) -> str:
    return "on" if is_road(cue.split(",")[0]) else "in"


def destin_place(name: str, place: str, city: str) -> str:
    """Keep a real Destin cue in the meta description, including Miramar and Sandestin."""
    if mentions_destin(f"{name} {place}"):
        return place
    if city.lower() == "destin":
        return f"{place} in Destin"
    return f"{place}, near Destin"


def readable_label(label: str) -> str:
    """Turn 'Area | Spot' into a phrase. Roads use on; a broader place uses in."""
    left, right = label_parts(label)
    if not left or not right:
        return label.replace(" | ", ", ")
    if is_road(right):
        return f"{left} on {right}"
    if is_road(left):
        return f"{right} on {left}"
    if right.lower() in BROAD_PLACES:
        return f"{left} in {right}"
    if left.lower() in BROAD_PLACES:
        return f"{right} in {left}"
    return f"{left}, {right}"


def readable_note(restaurant: dict) -> str:
    """The listing note, with the pipe in a location label turned into plain words."""
    note = restaurant["notes"]
    label = clean_text(restaurant["label"])
    if label and label in note:
        note = note.replace(label, readable_label(label))
    elif " | " in note:
        note = note.replace(" | ", ", ")
    return sentence(note)


def address_sentence(restaurant: dict) -> str:
    address = restaurant["address"]
    area = restaurant["area"]
    city = restaurant["city"] or "Destin"
    if not address:
        if area.lower() == city.lower():
            return f"It’s in {area}."
        return f"It’s in {area}, {city}."
    if area.lower() == city.lower() or area.lower() in address.lower():
        return f"The address is {address}."
    return f"The address is {address}, in {area}."


def service_sentence(restaurant: dict) -> str:
    meals = oxford([meal.lower() for meal in restaurant["meals"]])
    cuisines = oxford(restaurant["cuisines"][:3])
    if meals and cuisines:
        noun = "cuisine" if len(restaurant["cuisines"][:3]) == 1 else "cuisines"
        verb = "is" if noun == "cuisine" else "are"
        return f"It’s listed for {meals}. {cuisines} {verb} the {noun} on the listing."
    if meals:
        return f"It’s listed for {meals}."
    if cuisines:
        return f"{cuisines} is on the listing."
    return ""


def detail_sentence(restaurant: dict) -> str:
    """Only flags the listing itself marks yes. In Review and No stay unsaid."""
    clauses = []
    if restaurant["outdoor"]:
        clauses.append("Outdoor dining is listed.")
    if restaurant["kids"]:
        clauses.append("It’s marked kid friendly.")
    if restaurant["music"]:
        clauses.append("Live music is listed.")
    if restaurant["reservations"]:
        clauses.append("They take reservations.")
    if restaurant["happyDrinks"] and restaurant["happyFood"]:
        clauses.append("A happy hour for drinks and food is listed.")
    elif restaurant["happyDrinks"]:
        clauses.append("A happy hour for drinks is listed.")
    elif restaurant["happyFood"]:
        clauses.append("A happy hour for food is listed.")
    return " ".join(clauses)


def hours_sentence(restaurant: dict) -> str:
    if restaurant["hours"]:
        return "Hours are on this page."
    return "Hours aren’t listed on this page."


def favorite_sentence(restaurant: dict) -> str:
    if restaurant["laurensFavorite"]:
        return "It’s on Lauren’s Favorites."
    return ""


def practical_paragraph(restaurant: dict) -> str:
    parts = [
        address_sentence(restaurant),
        service_sentence(restaurant),
        detail_sentence(restaurant),
        favorite_sentence(restaurant),
        hours_sentence(restaurant),
    ]
    return " ".join(part for part in parts if part)


def listing_story(restaurant: dict) -> str:
    """Note from the listing, then a practical paragraph built only from its fields."""
    note = readable_note(restaurant)
    practical = practical_paragraph(restaurant)
    parts = []
    if note:
        parts.append(f"<p>{e(note)}</p>")
    if practical and practical != note:
        parts.append(f"<p>{e(practical)}</p>")
    if not parts:
        parts.append(f"<p>{e(practical_paragraph(restaurant))}</p>")
    return "".join(parts)


def meta_tails(restaurant: dict) -> list[str]:
    """Extra sentences that stay inside the listing. Used only to land the snippet length."""
    street = restaurant["street"]
    tails = [f"Address: {street}."]
    if restaurant["hours"]:
        tails.append("Hours, the address, and a map are on this page.")
        tails.append(f"Address: {street}. Hours are on this page.")
    tails.append(f"Address: {street}. The phone number and a map are on this page.")
    tails.append("The address, phone number, and map are on this page, on the Destin coast in Florida.")
    return tails


def listing_description(restaurant: dict) -> str:
    """Unique snippet: restaurant name, a real local cue, and facts from the listing."""
    name = restaurant["name"]
    city = restaurant["city"] or "Destin"
    place = destin_place(name, f"{cue_lead(heading_cue(restaurant))} {heading_cue(restaurant)}", city)
    cuisine = oxford(restaurant["cuisines"][:2])
    meals = oxford([meal.lower() for meal in restaurant["meals"][:3]])
    street = restaurant["street"]
    note = readable_note(restaurant)
    leads = []
    if note and mentions_destin(note):
        leads.append(note)
    if note and not mentions_destin(f"{note} {name}"):
        leads.append(f"{note} On the Destin coast in Florida.")
    leads.extend(
        [
            f"{name}, {place}, serves {cuisine} for {meals}.",
            f"{name}, {place}, serves {restaurant['cuisines'][0]}.",
            f"{name}, {place}.",
            f"{name} is at {street}, {place}.",
        ]
    )
    options = []
    for lead in leads:
        options.append(lead)
        for tail in meta_tails(restaurant):
            if street and street in lead and street in tail:
                continue
            options.append(f"{lead} {tail}")
    for option in options:
        fitted = within_meta(option)
        if fitted and fitted not in USED_DESCRIPTIONS:
            return fitted
    raise SystemExit(f"meta description out of range for {restaurant['slug']}")


def restaurant_title(restaurant: dict) -> str:
    """Restaurant name plus one local cue. The brand supplies Destin when the cue is a neighborhood."""
    name = restaurant["name"]
    cue = heading_cue(restaurant)
    phrase = f"{cue_lead(cue)} {cue}"
    area = restaurant["area"]
    city = restaurant["city"] or "Destin"
    brand = "Eating in Destin"
    candidates = [
        f"{name} {phrase} | {brand}",
        f"{name} | {cue} | {brand}",
        f"{name} in {area} | {brand}",
        f"{name} in {city} | {brand}",
        f"{name} | {area} | {brand}",
        f"{name} | {brand}",
        f"{name} {phrase}",
        f"{name} | {area}",
        f"{name} in {city}",
    ]
    seen: set[str] = set()
    for candidate in candidates:
        title = clean_text(candidate)
        if not title or title in seen:
            continue
        seen.add(title)
        if 20 <= len(title) <= 70 and title not in USED_TITLES:
            return title
    raise SystemExit(f"title out of range for {restaurant['slug']}")


def area_description(area: dict) -> str:
    name = area["fullName"]
    blurb = sentence(area["description"])
    if "Destin" in name:
        lead = f"Restaurants in {name}, Florida."
    else:
        lead = f"{name} restaurants on the Destin coast in Florida."
    count = area["count"]
    word = restaurant_count_word(count)
    options = [
        f"{lead} {blurb}",
        f"{lead} {count} {word}, with hours and addresses.",
        f"Find restaurants and food in {name}, Florida, on the Destin coast. {blurb}",
        lead,
    ]
    for option in options:
        fitted = within_meta(option)
        if fitted:
            return fitted
    raise SystemExit(f"area meta out of range for {area['slug']}")


DAY_CODES = {
    "mon": "Mo",
    "tue": "Tu",
    "wed": "We",
    "thu": "Th",
    "fri": "Fr",
    "sat": "Sa",
    "sun": "Su",
}


def clock_24(token: str) -> str | None:
    match = re.fullmatch(r"(\d{1,2}):(\d{2})\s*(AM|PM)", clean_text(token), re.I)
    if not match:
        return None
    hour = int(match.group(1))
    minute = int(match.group(2))
    meridiem = match.group(3).upper()
    if hour < 1 or hour > 12 or minute > 59:
        return None
    if meridiem == "AM":
        hour = 0 if hour == 12 else hour
    elif hour != 12:
        hour += 12
    return f"{hour:02d}:{minute:02d}"


def opening_hours(raw: str) -> list[str]:
    """Schema.org openingHours from the listing's own hours string. Skip anything we cannot parse."""
    text = clean_text(raw).replace("–", "-").replace("—", "-")
    if not text:
        return []
    slots = []
    for part in text.split(";"):
        part = part.strip()
        if not part:
            continue
        match = re.fullmatch(r"(Mon|Tue|Wed|Thu|Fri|Sat|Sun):\s*(.+)", part)
        if not match:
            return []
        if match.group(2).strip().lower() == "closed":
            continue
        times = re.fullmatch(
            r"(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)",
            match.group(2).strip(),
            re.I,
        )
        if not times:
            return []
        start = clock_24(times.group(1))
        end = clock_24(times.group(2))
        if not start or not end:
            return []
        slots.append(f"{DAY_CODES[match.group(1).lower()]} {start}-{end}")
    return slots


def postal_address(restaurant: dict) -> dict:
    address = {
        "@type": "PostalAddress",
        "streetAddress": restaurant["street"] or restaurant["address"],
        "addressLocality": restaurant["city"] or restaurant["area"],
        "addressRegion": restaurant["region"] or "FL",
        "postalCode": restaurant["postal"],
        "addressCountry": "US",
    }
    return {key: value for key, value in address.items() if value}


def restaurant_schema(restaurant: dict, description: str) -> dict:
    """Restaurant and LocalBusiness facts taken from the listing. No hours, ratings, or reviews are invented."""
    page_url = f"{ORIGIN}/restaurants/{restaurant['slug']}/"
    schema = {
        "@type": ["Restaurant", "LocalBusiness"],
        "@id": page_url + "#restaurant",
        "name": restaurant["name"],
        "url": page_url,
        "description": description,
        "address": postal_address(restaurant),
        "containedInPlace": {
            "@type": "Place",
            "name": restaurant["area"],
            "url": f"{ORIGIN}/areas/{restaurant['areaSlug']}/",
        },
        "isPartOf": {"@id": ORIGIN + "/#website"},
    }
    if restaurant["cuisines"]:
        schema["servesCuisine"] = restaurant["cuisines"]
    if restaurant["price"]:
        schema["priceRange"] = restaurant["price"]
    if restaurant["phone"]:
        schema["telephone"] = restaurant["phone"]
    if restaurant["reservations"]:
        schema["acceptsReservations"] = True
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        schema["geo"] = {
            "@type": "GeoCoordinates",
            "latitude": restaurant["lat"],
            "longitude": restaurant["lng"],
        }
    if restaurant["heroImage"]:
        image = restaurant["heroImage"]
        schema["image"] = image if image.startswith(("http://", "https://")) else ORIGIN + image
    hours = opening_hours(restaurant["hours"])
    if hours:
        schema["openingHours"] = hours
    same_as = [url for url in (restaurant["website"], restaurant["instagram"], restaurant["facebook"]) if url]
    if same_as:
        schema["sameAs"] = same_as
    return schema


USED_TITLES: set[str] = set()
USED_DESCRIPTIONS: set[str] = set()


def claim_title(title: str) -> str:
    title = clean_text(title)
    if not (20 <= len(title) <= 70):
        raise SystemExit(f"title length {len(title)}: {title}")
    if title in USED_TITLES:
        raise SystemExit(f"duplicate title: {title}")
    USED_TITLES.add(title)
    return title


def claim_description(description: str) -> str:
    description = clean_text(description)
    if not (110 <= len(description) <= 165) or "Destin" not in description:
        raise SystemExit(f"description out of range ({len(description)}): {description}")
    if description in USED_DESCRIPTIONS:
        raise SystemExit(f"duplicate description: {description}")
    USED_DESCRIPTIONS.add(description)
    return description


def local_image_info(path: Path) -> tuple[int, int, str] | None:
    if not path.is_file():
        return None
    data = path.read_bytes()
    if data.startswith(b"\x89PNG") and len(data) >= 24:
        return int.from_bytes(data[16:20], "big"), int.from_bytes(data[20:24], "big"), "image/png"
    if data[:2] != b"\xff\xd8":
        return None
    index = 2
    while index < len(data) - 8:
        if data[index] != 0xFF:
            index += 1
            continue
        marker = data[index + 1]
        if marker in (0xC0, 0xC1, 0xC2):
            height = int.from_bytes(data[index + 5 : index + 7], "big")
            width = int.from_bytes(data[index + 7 : index + 9], "big")
            return width, height, "image/jpeg"
        if marker in (0xD8, 0xD9):
            index += 2
            continue
        if index + 4 > len(data):
            break
        length = int.from_bytes(data[index + 2 : index + 4], "big")
        if length < 2:
            break
        index += 2 + length
    return None


def image_facts(url: str | None) -> dict:
    src = url or SHARE_IMAGE
    absolute = src if src.startswith(("http://", "https://")) else ORIGIN + src
    facts = {"url": absolute}
    info = None
    if src.startswith("/"):
        info = local_image_info(ROOT / src.lstrip("/"))
    else:
        match = re.search(r"w_(\d+),h_(\d+)", src)
        if match:
            kind = "image/png" if ".png" in src.lower() else "image/jpeg"
            info = (int(match.group(1)), int(match.group(2)), kind)
    if info:
        facts["width"], facts["height"], facts["type"] = info
    return facts


def social_tags(title: str, description: str, canonical: str, image: str | None, image_alt: str) -> str:
    facts = image_facts(image)
    alt = image_alt or SHARE_ALT
    tags = [
        f'<meta property="og:title" content="{e(title)}">',
        f'<meta property="og:description" content="{e(description)}">',
        f'<meta property="og:url" content="{e(canonical)}">',
        f'<meta property="og:image" content="{e(facts["url"])}">',
        f'<meta property="og:image:alt" content="{e(alt)}">',
    ]
    if "width" in facts:
        tags.append(f'<meta property="og:image:width" content="{facts["width"]}">')
        tags.append(f'<meta property="og:image:height" content="{facts["height"]}">')
        tags.append(f'<meta property="og:image:type" content="{facts["type"]}">')
    tags.extend(
        [
            '<meta property="og:type" content="website">',
            '<meta property="og:site_name" content="Eating in Destin">',
            '<meta property="og:locale" content="en_US">',
            '<meta name="twitter:card" content="summary_large_image">',
            f'<meta name="twitter:title" content="{e(title)}">',
            f'<meta name="twitter:description" content="{e(description)}">',
            f'<meta name="twitter:image" content="{e(facts["url"])}">',
            f'<meta name="twitter:image:alt" content="{e(alt)}">',
        ]
    )
    return "\n".join(tags) + "\n"


def breadcrumbs(crumbs: list[tuple[str, str]]) -> dict:
    return {
        "@type": "BreadcrumbList",
        "itemListElement": [
            {"@type": "ListItem", "position": index, "name": name, "item": ORIGIN + path}
            for index, (name, path) in enumerate(crumbs, start=1)
        ],
    }


def crumb_nav(crumbs: list[tuple[str, str]]) -> str:
    parts = []
    last = len(crumbs) - 1
    for index, (name, path) in enumerate(crumbs):
        if index:
            parts.append(' <span aria-hidden="true">/</span> ')
        if index == last:
            parts.append(f'<span aria-current="page">{e(name)}</span>')
        else:
            parts.append(f'<a href="{e(path)}">{e(name)}</a>')
    return f'<nav class="crumbs" aria-label="Breadcrumb">{"".join(parts)}</nav>'


def area_link_nav(areas: list[dict], current: str = "", label: str = "Areas") -> str:
    links = []
    for area in areas:
        if area["slug"] == current:
            continue
        links.append(
            f'<a class="text-link" href="/areas/{e(area["slug"])}/">{e(area["fullName"])} restaurants</a>'
        )
    if not links:
        return ""
    return f'<nav class="section-links" aria-label="{e(label)}">{"".join(links)}</nav>'


def browse_by_area(areas: list[dict]) -> str:
    nav = area_link_nav(areas)
    if not nav:
        return ""
    return (
        '<section class="browse-areas" aria-labelledby="browse-areas-heading">'
        '<h2 id="browse-areas-heading">Browse by area</h2>'
        f"{nav}</section>"
    )


def view_switch(current: str) -> str:
    modes = (("listing", "List", "/restaurants/"), ("map", "Map", "/map/"))
    links = []
    for key, label, href in modes:
        klass = "button" if key == current else "button secondary"
        current_attr = ' aria-current="page"' if key == current else ""
        links.append(f'<a class="{klass}" href="{href}" data-view="{href}"{current_attr}>{label}</a>')
    script = (
        "<script>!function(){var q=location.search;if(!q)return;"
        "document.querySelectorAll('[data-view]').forEach(function(a){"
        "a.href=a.getAttribute('data-view')+q;});}();</script>"
    )
    return f'<nav class="view-switch" aria-label="List or map">{"".join(links)}</nav>{script}'


def graph(*nodes: dict) -> dict:
    return {"@context": "https://schema.org", "@graph": list(nodes)}


def layout(
    title: str,
    description: str,
    path: str,
    active: str,
    body: str,
    extra_head: str = "",
    include_js: bool = True,
    image: str | None = None,
    image_alt: str = "",
    noindex: bool = False,
    extra_scripts: str = "",
) -> str:
    canonical = ORIGIN + path
    title = claim_title(title)
    description = claim_description(description)
    scripts = '<script src="/header.js"></script>\n<script src="/footer.js"></script>\n'
    if include_js:
        scripts += '<script type="module" src="/site.js"></script>'
    body_attr = ' class="home"' if active == "home" else ""
    banner = "" if active == "home" else sample_banner()
    robots = '<meta name="robots" content="noindex">\n' if noindex else ""
    return (
        "<!DOCTYPE html>\n"
        '<html lang="en">\n<head>\n'
        '<meta charset="utf-8">\n'
        '<meta name="viewport" content="width=device-width, initial-scale=1">\n'
        f"<title>{e(title)}</title>\n"
        f'<meta name="description" content="{e(description)}">\n'
        f'<link rel="canonical" href="{e(canonical)}">\n'
        + robots
        + social_tags(title, description, canonical, image, image_alt)
        + '<meta name="theme-color" content="#102825">\n'
        '<link rel="icon" href="/favicon.ico" sizes="any">\n'
        '<link rel="icon" href="/favicon.png" type="image/png" sizes="32x32">\n'
        '<link rel="icon" href="/images/eating-favicon-512.png" type="image/png" sizes="512x512">\n'
        '<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n'
        '<link rel="preconnect" href="https://fonts.googleapis.com">\n'
        '<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n'
        '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500;1,600&family=Outfit:wght@300;400;500&display=swap" rel="stylesheet">\n'
        '<link rel="stylesheet" href="/styles.css">\n'
        + extra_head
        + f"</head>\n<body{body_attr}>\n"
        + '<div id="site-header"></div>\n'
        + banner
        + '<main id="main">\n'
        + body
        + "</main>\n"
        + '<div id="site-footer"></div>\n'
        + scripts
        + extra_scripts
        + "\n</body>\n</html>\n"
    )


def json_ld(data: dict | list) -> str:
    payload = json.dumps(data, ensure_ascii=False).replace("<", "\\u003c")
    return f'<script type="application/ld+json">{payload}</script>\n'


def area_names(areas: list[dict]) -> str:
    payload = {area["slug"]: area["fullName"] for area in areas}
    return json.dumps(payload, ensure_ascii=False).replace("<", "\\u003c")


def filter_form(areas: list[dict], cuisines: list[str]) -> str:
    area_options = ['<option value="">All areas</option>']
    for area in areas:
        area_options.append(f'<option value="{e(area["slug"])}">{e(area["fullName"])}</option>')
    meal_options = ['<option value="">Any meal</option>']
    for meal in MEAL_ORDER:
        meal_options.append(f'<option value="{e(meal)}">{e(meal)}</option>')
    cuisine_options = ['<option value="">Any cuisine</option>']
    for cuisine in cuisines:
        cuisine_options.append(f'<option value="{e(cuisine)}">{e(cuisine)}</option>')
    return (
        '<form id="filters" class="filters" action="/restaurants/" method="get">'
        '<label class="field"><span>Search</span><input id="q" name="q" type="search" placeholder="Oysters, coffee, pizza"></label>'
        f'<label class="field"><span>Area</span><select id="area" name="area">{"".join(area_options)}</select></label>'
        f'<label class="field"><span>Meal</span><select id="meal" name="meal">{"".join(meal_options)}</select></label>'
        f'<label class="field"><span>Cuisine</span><select id="cuisine" name="cuisine">{"".join(cuisine_options)}</select></label>'
        '<div class="checks">'
        '<label class="check"><input type="checkbox" name="outdoor" value="yes"><span>Outdoor dining</span></label>'
        '<label class="check"><input type="checkbox" name="kids" value="yes"><span>Kid friendly</span></label>'
        '<label class="check"><input type="checkbox" name="music" value="yes"><span>Live music</span></label>'
        '<label class="check"><input type="checkbox" name="laurens" value="yes"><span>Lauren\'s Favorites</span></label>'
        "</div>"
        '<div class="filter-actions"><button type="submit">Apply</button><a class="clear" href="/restaurants/">Clear</a></div>'
        "</form>"
        f'<script type="application/json" id="area-names">{area_names(areas)}</script>'
    )


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text, encoding="utf-8")


def public_record(restaurant: dict) -> dict:
    return {
        "slug": restaurant["slug"],
        "name": restaurant["name"],
        "area": restaurant["area"],
        "areaSlug": restaurant["areaSlug"],
        "meals": restaurant["meals"],
        "cuisines": restaurant["cuisines"],
        "foods": restaurant["foods"],
        "price": restaurant["price"],
        "lat": restaurant["lat"],
        "lng": restaurant["lng"],
        "address": restaurant["address"],
        "phone": restaurant["phone"],
        "search": restaurant["search"],
        "outdoor": restaurant["outdoor"],
        "kids": restaurant["kids"],
        "music": restaurant["music"],
        "laurensFavorite": restaurant["laurensFavorite"],
        "image": restaurant["cardImage"],
    }


def select_featured(restaurants: list[dict]) -> list[dict]:
    """Homepage cover order. Slugs live in site.config.json so a paid spot is a config edit."""
    by_slug = {item["slug"]: item for item in restaurants}
    slugs = CONFIG.get("featured") or []
    if not isinstance(slugs, list) or not slugs:
        fallback = next((item for item in restaurants if item["heroImage"] or item["cardImage"]), None)
        return [fallback] if fallback else []
    missing = [str(slug) for slug in slugs if str(slug) not in by_slug]
    if missing:
        raise SystemExit("featured slugs are not published listings: " + ", ".join(missing))
    if len(slugs) != len(set(slugs)):
        raise SystemExit("featured slugs must be unique")
    return [by_slug[str(slug)] for slug in slugs]


def cover_slot(feature: dict, hidden: bool, eager: bool) -> str:
    image = feature["heroImage"] or feature["cardImage"]
    meta = " · ".join(
        bit for bit in (feature["label"] or feature["area"], feature["price"], ", ".join(feature["cuisines"])) if bit
    )
    flag = " hidden" if hidden else ""
    return (
        f'<div class="cover" data-featured{flag}>'
        f'<a class="cover-media" href="/restaurants/{e(feature["slug"])}/">'
        f'{media_block(image, photo_alt(feature), feature["tone"], shot_label(feature), eager=eager, name=feature["name"])}'
        "</a><div class=\"cover-copy\">"
        '<p class="kicker">Featured</p>'
        f"<h2>{e(feature['name'])}</h2>"
        f'<p class="lede">{e(snippet(feature["notes"], 240))}</p>'
        f'<p class="meta">{e(meta)}</p>'
        f'<p><a class="text-link" href="/restaurants/{e(feature["slug"])}/">View restaurant</a></p>'
        "</div></div>"
    )


def featured_controls() -> str:
    """Prev/next sit on the photo. They stay hidden until the page script binds them."""
    left = (
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        '<path d="M14.5 5.5 8 12l6.5 6.5" fill="none" stroke="currentColor" '
        'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    )
    right = (
        '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">'
        '<path d="M9.5 5.5 16 12l-6.5 6.5" fill="none" stroke="currentColor" '
        'stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
    )
    return (
        '<div class="cover-controls" hidden>'
        f'<button type="button" class="cover-arrow" data-featured-step="-1" aria-label="Previous featured">{left}</button>'
        f'<button type="button" class="cover-arrow" data-featured-step="1" aria-label="Next featured">{right}</button>'
        '<p class="sr-only" data-featured-status aria-live="polite"></p>'
        "</div>"
    )


def restaurant_count_word(count: int, label: bool = False) -> str:
    """Visitor noun for a restaurant count.

    Badges and other noun labels use a capital R ("7 Restaurants").
    Counts inside a sentence stay lowercase ("7 restaurants"), the same
    way the directory result line is written.
    """
    if count == 1:
        return "Restaurant" if label else "restaurant"
    return "Restaurants" if label else "restaurants"


FEATURED_ROTATION = (
    "<script>!function(){var nodes=document.querySelectorAll('#from-the-guide [data-featured]');"
    "if(nodes.length<2)return;var index=Math.floor(Date.now()/86400000)%nodes.length;"
    "for(var i=0;i<nodes.length;i++)nodes[i].hidden=i!==index;}();</script>"
)


def build_home(restaurants: list[dict], areas: list[dict], hero: str | None) -> None:
    meal_counts = []
    for meal in MEAL_ORDER:
        count = sum(1 for restaurant in restaurants if meal in restaurant["meals"])
        if count:
            meal_counts.append((meal, count))
    meals_html = "".join(
        f'<a href="/restaurants/?meal={e(meal)}"><span>{e(meal)}</span><em>{count:02d}</em></a>'
        for meal, count in meal_counts
    )
    towns = []
    for area in areas:
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="{e(area["fullName"] + " in Destin")}" loading="lazy">'
        else:
            photo = placeholder("gulf", area["name"], area["name"])
        word = restaurant_count_word(area["count"], label=True)
        towns.append(
            f'<a class="town" href="/areas/{e(area["slug"])}/">'
            f'<span class="town-frame">{photo}</span>'
            f'<span class="town-copy"><strong>{e(area["name"])}</strong><small>{area["count"]} {word}</small></span>'
            "</a>"
        )
    featured = select_featured(restaurants)
    slots = "".join(
        cover_slot(feature, hidden=index != 0, eager=index == 0)
        for index, feature in enumerate(featured)
    )
    cover = ""
    if slots:
        controls = featured_controls() if len(featured) > 1 else ""
        cover = (
            '<section class="section cover-section" id="from-the-guide" aria-label="Featured">'
            '<div class="wrap cover-stage">'
            f"{controls}{slots}</div>{FEATURED_ROTATION}</section>"
        )
    hero_html, hero_alt = hero_markup(hero)
    body = (
        '<section class="hero">'
        f"{hero_html}"
        '<div class="hero-veil" aria-hidden="true"></div>'
        '<div class="hero-copy"><div class="wrap">'
        '<p class="issue-line">A restaurant guide for the Emerald Coast.</p>'
        '<p class="eyebrow">Destin · Miramar Beach</p>'
        "<h1>Where to eat<br> in Destin.</h1>"
        '<p class="lede">Find breakfast, lunch, and dinner in Destin and Miramar Beach.</p>'
        '<form class="search-form" action="/restaurants/" method="get">'
        '<label class="field"><span class="sr-only">Search restaurants</span>'
        '<input name="q" type="search" placeholder="Oysters, coffee, the harbor…"></label>'
        "<button>Search</button></form>"
        "</div></div></section>"
        f'<nav class="meal-index" aria-label="Meals">{meals_html}</nav>'
        f"{cover}"
        '<section class="section band"><div class="wrap">'
        '<div class="section-head"><div><p class="kicker">Neighborhoods</p><h2>The areas</h2></div>'
        "<p>Each area has its own page of restaurants in Destin and Miramar Beach.</p></div>"
        f'<div class="town-grid">{"".join(towns)}</div>'
        '<p class="section-links"><a class="text-link" href="/areas/">Restaurant areas</a><a class="text-link" href="/map/">The map</a></p>'
        "</div></section>"
        '<section class="section"><div class="wrap essay-grid">'
        '<div><p class="kicker">The coast</p><h2>A guide for Destin and Miramar Beach.</h2></div>'
        f'<div><div class="prose"><p>{e(ABOUT)}</p>'
        "<p>Search for a restaurant by name, or browse food in "
        '<a href="/areas/miramar-beach/">Miramar Beach</a>, '
        '<a href="/areas/sandestin/">Sandestin</a>, '
        '<a href="/areas/destin-harbor/">Destin Harbor</a>, and the rest of Destin.</p>'
        '<p><a class="button" href="/restaurants/">Browse the directory</a></p></div>'
        '<p class="kicker">Guides</p>'
        '<p class="lede">Popular guides for a trip to Destin and Miramar Beach. Seafood, breakfast, and the rest of the list are on the guides page.</p>'
        '<p class="section-links"><a class="text-link" href="/guides/best-seafood-destin/">Best seafood in Destin</a>'
        '<a class="text-link" href="/guides/breakfast-destin/">Breakfast in Destin</a>'
        '<a class="text-link" href="/guides/">All guides</a></p></div>'
        "</div></section>"
    )
    description = (
        "Find restaurants and food in Destin and Miramar Beach, Florida, by meal, area, or cuisine, "
        "with a directory and a map of the coast."
    )
    extra = json_ld(
        graph(
            {
                "@type": "Organization",
                "@id": ORIGIN + "/#organization",
                "name": "Eating in Destin",
                "url": ORIGIN + "/",
                "description": ABOUT,
            },
            {
                "@type": "WebSite",
                "@id": ORIGIN + "/#website",
                "name": "Eating in Destin",
                "url": ORIGIN + "/",
                "description": description,
                "inLanguage": "en",
                "publisher": {"@id": ORIGIN + "/#organization"},
                "potentialAction": {
                    "@type": "SearchAction",
                    "target": ORIGIN + "/restaurants/?q={search_term_string}",
                    "query-input": "required name=search_term_string",
                },
            },
            {
                "@type": "ItemList",
                "name": "Restaurant areas in Destin",
                "numberOfItems": len(areas),
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": index,
                        "name": area["fullName"],
                        "url": f"{ORIGIN}/areas/{area['slug']}/",
                    }
                    for index, area in enumerate(areas, start=1)
                ],
            },
        )
    )
    write(
        ROOT / "index.html",
        layout(
            "Eating in Destin | Restaurants and food in Destin, FL",
            description,
            "/",
            "home",
            body,
            extra,
            image=hero,
            image_alt=hero_alt,
        ),
    )


def build_directory(restaurants: list[dict], areas: list[dict], cuisines: list[str]) -> None:
    pending = (
        "<script>!function(){var p=new URLSearchParams(location.search);"
        "['meal','area','cuisine','q','outdoor','kids','music','laurens'].some(function(k){return p.get(k)})"
        "&&document.documentElement.classList.add('js-filter')}();</script>\n"
    )
    cards = "".join(card(restaurant) for restaurant in restaurants)
    body = (
        '<div class="wrap page-intro">'
        f'{crumb_nav([("Home", "/"), ("Restaurants", "/restaurants/")])}'
        '<p class="kicker">Directory</p>'
        '<h1 id="listing-title">Restaurants in Destin</h1>'
        '<p class="lede">Food in Destin and Miramar Beach, Florida. Filter by area, meal, or a few words.</p>'
        f'{view_switch("listing")}'
        f"{filter_form(areas, cuisines)}"
        f'<p id="result-count" class="count" aria-live="polite">{len(restaurants)} restaurants</p>'
        f'<p id="empty" class="empty" hidden>No restaurants match. <a href="/restaurants/">Clear the filters</a>.</p>'
        f'<div id="cards" class="card-grid">{cards}</div>'
        f"{browse_by_area(areas)}</div>"
    )
    extra = pending + json_ld(
        graph(
            {
                "@type": "CollectionPage",
                "@id": ORIGIN + "/restaurants/#page",
                "name": "Restaurants in Destin",
                "url": ORIGIN + "/restaurants/",
                "isPartOf": {"@id": ORIGIN + "/#website"},
                "description": (
                    f"Restaurants in Destin and Miramar Beach, Florida. "
                    f"Search all {len(restaurants)} listings for food by area, meal, and cuisine, with hours and addresses."
                ),
            },
            {
                "@type": "ItemList",
                "name": "Restaurants in Destin",
                "numberOfItems": len(restaurants),
                "itemListElement": [
                    {
                        "@type": "ListItem",
                        "position": index,
                        "name": restaurant["name"],
                        "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
                    }
                    for index, restaurant in enumerate(restaurants, start=1)
                ],
            },
            breadcrumbs([("Home", "/"), ("Restaurants", "/restaurants/")]),
        )
    )
    write(
        ROOT / "restaurants" / "index.html",
        layout(
            "Restaurants in Destin, FL | Eating in Destin",
            (
                f"Restaurants in Destin and Miramar Beach, Florida. "
                f"Search all {len(restaurants)} listings for food by area, meal, and cuisine, with hours and addresses."
            ),
            "/restaurants/",
            "restaurants",
            body,
            extra,
        ),
    )


def fact(label: str, value: str) -> str:
    if not value:
        return ""
    return f"<div><dt>{e(label)}</dt><dd>{value}</dd></div>"


def build_detail(restaurant: dict, restaurants: list[dict]) -> None:
    """Single restaurant profile template. Every listing page is rendered here."""
    chips = []
    for meal in restaurant["meals"]:
        chips.append(f'<li><a href="/restaurants/?meal={e(meal)}">{e(meal)}</a></li>')
    for cuisine in restaurant["cuisines"]:
        chips.append(f'<li><a href="/restaurants/?cuisine={e(cuisine)}">{e(cuisine)}</a></li>')
    if restaurant["price"]:
        chips.append(f'<li>{e(restaurant["price"])}</li>')
    flags = []
    if restaurant["outdoor"]:
        flags.append("Outdoor dining")
    if restaurant["kids"]:
        flags.append("Kid friendly")
    if restaurant["music"]:
        flags.append("Live music")
    if restaurant["laurensFavorite"]:
        flags.append("Lauren's Favorites")
    if restaurant["happyDrinks"]:
        flags.append("Happy hour drinks")
    if restaurant["happyFood"]:
        flags.append("Happy hour food")
    if restaurant["reservations"]:
        flags.append("Takes reservations")
    for flag in flags:
        chips.append(f"<li>{e(flag)}</li>")
    phone = f'<a href="{e(restaurant["tel"])}">{e(restaurant["phone"])}</a>' if restaurant["tel"] else ""
    website = ""
    if restaurant["website"]:
        host = re.sub(r"^www\.", "", re.sub(r"^https?://", "", restaurant["website"]).split("/")[0])
        website = f'<a href="{e(restaurant["website"])}" rel="noopener noreferrer">{e(host)}</a>'
    directions = ""
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        directions = (
            f'<a href="https://www.openstreetmap.org/?mlat={restaurant["lat"]}&amp;mlon={restaurant["lng"]}'
            f'#map=17/{restaurant["lat"]}/{restaurant["lng"]}">View map</a>'
        )
    socials = []
    if restaurant["instagram"]:
        socials.append(f'<a href="{e(restaurant["instagram"])}" rel="noopener noreferrer">Instagram</a>')
    if restaurant["facebook"]:
        socials.append(f'<a href="{e(restaurant["facebook"])}" rel="noopener noreferrer">Facebook</a>')
    facts = "".join(
        [
            fact("Hours", e(restaurant["hours"]) if restaurant["hours"] else "Hours not listed"),
            fact("Phone", phone),
            fact("Website", website),
            fact("Address", e(restaurant["address"])),
            fact("Directions", directions),
            fact("Food", e(", ".join(restaurant["foods"]))),
            fact("Vibe", e(", ".join(restaurant["vibes"]))),
            fact("Category", e(restaurant["category"])),
            fact("Also", " · ".join(socials)),
        ]
    )
    logo = f'<img class="logo" src="{e(restaurant["logo"])}" alt="{e(restaurant["name"])} logo">' if restaurant["logo"] else ""
    nearby = [
        other
        for other in restaurants
        if other["areaSlug"] == restaurant["areaSlug"] and other["slug"] != restaurant["slug"]
    ][:4]
    nearby_html = "".join(
        f'<a class="map-hit" href="/restaurants/{e(other["slug"])}/"><strong>{e(other["name"])}</strong><span>{e(other["price"])}</span></a>'
        for other in nearby
    )
    map_html = ""
    if restaurant["lat"] is not None and restaurant["lng"] is not None:
        map_html = (
            f'<div id="detail-map" data-lat="{restaurant["lat"]}" data-lng="{restaurant["lng"]}" '
            f'data-name="{e(restaurant["name"])}" data-slug="{e(restaurant["slug"])}" '
            f'data-area="{e(restaurant["area"])}" data-address="{e(restaurant["address"])}" '
            f'data-image="{e(restaurant["heroImage"] or "")}" role="region" aria-label="Map"></div>'
            '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">'
            '<script src="/vendor/leaflet/leaflet.js"></script>'
        )
    area_href = f'/restaurants/?area={restaurant["areaSlug"]}'
    area_page = f'/areas/{restaurant["areaSlug"]}/'
    area_line = restaurant["label"] or restaurant["area"]
    price_bit = f' · {e(restaurant["price"])}' if restaurant["price"] else ""
    category_bit = f' · {e(restaurant["category"])}' if restaurant["category"] else ""
    map_block = f'<div class="wrap profile-map">{map_html}</div>' if map_html else ""
    claim_link = (
        f'<p class="profile-claim"><a href="{e(claim_href(restaurant["name"]))}">'
        "Claim or correct this listing</a></p>"
    )
    if nearby_html:
        more = (
            f'<section class="wrap more"><h2>Also in {e(restaurant["area"])}</h2>'
            f'<div class="map-list">{nearby_html}</div>'
            f'<p><a class="text-link" href="{e(area_page)}">Restaurants in {e(restaurant["area"])}</a></p>'
            f"{claim_link}</section>"
        )
    else:
        more = (
            f'<section class="wrap more"><p><a class="text-link" href="{e(area_page)}">Restaurants in {e(restaurant["area"])}</a></p>'
            f"{claim_link}</section>"
        )
    profile_crumbs = [
        ("Home", "/"),
        ("Restaurants", "/restaurants/"),
        (restaurant["area"], area_page),
        (restaurant["name"], f"/restaurants/{restaurant['slug']}/"),
    ]
    body = (
        '<article class="profile">'
        f'<div class="profile-hero">{media_block(restaurant["heroImage"], photo_alt(restaurant), restaurant["tone"], shot_label(restaurant), eager=True, name=restaurant["name"])}</div>'
        f"{filmstrip(restaurant)}"
        '<div class="wrap profile-head">'
        f"{crumb_nav(profile_crumbs)}"
        f'<p class="eyebrow"><a href="{e(area_href)}">{e(area_line)}</a>{price_bit}{category_bit}</p>'
        f"<h1>{e(restaurant['name'])}</h1>"
        f'<ul class="chips">{"".join(chips)}</ul>'
        "</div>"
        '<div class="wrap profile-grid">'
        f'<div class="prose profile-story">{listing_story(restaurant)}</div>'
        f"<aside>{logo}<dl class=\"facts\">{facts}</dl></aside>"
        "</div>"
        f"{map_block}{more}"
        "</article>"
    )
    description = listing_description(restaurant)
    extra = json_ld(graph(restaurant_schema(restaurant, description), breadcrumbs(profile_crumbs)))
    title = restaurant_title(restaurant)
    write(
        ROOT / "restaurants" / restaurant["slug"] / "index.html",
        layout(
            title,
            description,
            f'/restaurants/{restaurant["slug"]}/',
            "restaurants",
            body,
            extra,
            image=restaurant["heroImage"],
            image_alt=photo_alt(restaurant) if restaurant["heroImage"] else SHARE_ALT,
        ),
    )


def build_map(areas: list[dict], cuisines: list[str]) -> None:
    body = (
        '<div class="wrap page-intro">'
        f'{crumb_nav([("Home", "/"), ("Map", "/map/")])}'
        '<p class="kicker">The map</p>'
        '<h1 id="listing-title">Around Destin</h1>'
        "<p class=\"lede\">Explore restaurants and food on the map of Destin and Miramar Beach. Tap a pin to see the restaurant name, street address, and full profile.</p>"
        + view_switch("map")
        + filter_form(areas, cuisines).replace('action="/restaurants/"', 'action="/map/"').replace('href="/restaurants/"', 'href="/map/"')
        + '<p id="result-count" class="count">Loading the map…</p>'
        '<p id="map-note" class="empty" hidden></p>'
        '<div class="map-layout"><div id="map" role="region" aria-label="Restaurant map"></div>'
        '<div id="map-list" class="map-list"></div></div></div>'
    )
    extra = (
        '<link rel="stylesheet" href="/vendor/leaflet/leaflet.css">\n'
        '<script src="/vendor/leaflet/leaflet.js"></script>\n'
        + json_ld(
            graph(
                {
                    "@type": "WebPage",
                    "@id": ORIGIN + "/map/#page",
                    "name": "Restaurant map of Destin",
                    "url": ORIGIN + "/map/",
                    "isPartOf": {"@id": ORIGIN + "/#website"},
                    "description": "Map of restaurants and food in Destin and Miramar Beach, Florida.",
                },
                breadcrumbs([("Home", "/"), ("Map", "/map/")]),
            )
        )
    )
    write(
        ROOT / "map" / "index.html",
        layout(
            "Restaurant map of Destin | Eating in Destin",
            "Map of restaurants and food in Destin and Miramar Beach, Florida, using each listing’s address on OpenStreetMap.",
            "/map/",
            "map",
            body,
            extra,
        ),
    )


def build_areas(areas: list[dict], restaurants: list[dict]) -> None:
    cards = []
    for area in areas:
        photo = (
            f'<img src="{e(area["image"])}" alt="{e(area["fullName"] + " in Destin")}" loading="lazy">'
            if area["image"]
            else placeholder("gulf", area["name"], area["name"])
        )
        word = restaurant_count_word(area["count"], label=True)
        cards.append(
            f'<a class="town" href="/areas/{e(area["slug"])}/"><span class="town-frame">{photo}</span>'
            f'<span class="town-copy"><strong>{e(area["fullName"])}</strong><small>{area["count"]} {word}</small></span></a>'
        )
    body = (
        '<div class="wrap page-intro">'
        f'{crumb_nav([("Home", "/"), ("Areas", "/areas/")])}'
        '<p class="kicker">Neighborhoods</p><h1>Restaurant areas in Destin</h1>'
        "<p class=\"lede\">Find restaurants in Destin, Florida, by area. "
        "Explore the neighborhoods in the guide, including Miramar Beach, Sandestin, Destin Harbor, and Crystal Beach.</p>"
        f'<div class="town-grid">{"".join(cards)}</div></div>'
    )
    areas_description = (
        "Restaurant areas in Destin and Miramar Beach, Florida, including Miramar Beach, Sandestin, "
        "Destin Harbor, Destin Commons, and Crystal Beach."
    )
    write(
        ROOT / "areas" / "index.html",
        layout(
            "Restaurant areas in Destin, FL | Eating in Destin",
            areas_description,
            "/areas/",
            "areas",
            body,
            json_ld(
                graph(
                    {
                        "@type": "CollectionPage",
                        "name": "Restaurant areas in Destin",
                        "url": ORIGIN + "/areas/",
                        "description": areas_description,
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": "Restaurant areas in Destin",
                        "numberOfItems": len(areas),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": area["fullName"],
                                "url": f"{ORIGIN}/areas/{area['slug']}/",
                            }
                            for index, area in enumerate(areas, start=1)
                        ],
                    },
                    breadcrumbs([("Home", "/"), ("Areas", "/areas/")]),
                )
            ),
        ),
    )
    for area in areas:
        group = [restaurant for restaurant in restaurants if restaurant["areaSlug"] == area["slug"]]
        photo = ""
        if area["image"]:
            photo = f'<img src="{e(area["image"])}" alt="{e(area["fullName"])}" loading="eager">'
        name = area["fullName"]
        if "Destin" in name:
            food_line = f"Find restaurants and food in {name}, Florida."
        else:
            food_line = f"Find restaurants and food in {name}, on the Destin coast in Florida."
        lede = f"{sentence(area['description'])} {food_line}"
        area_crumbs = [
            ("Home", "/"),
            ("Areas", "/areas/"),
            (name, f"/areas/{area['slug']}/"),
        ]
        body = (
            '<article class="profile">'
            f'<div class="profile-hero">{photo or placeholder("gulf", area["name"], area["name"])}</div>'
            '<div class="wrap page-intro">'
            f"{crumb_nav(area_crumbs)}"
            f"<h1>Restaurants in {e(name)}</h1>"
            f'<p class="lede">{e(lede)}</p>'
            f'<p class="action-row"><a class="button" href="/restaurants/?area={e(area["slug"])}">Show {area["count"]} {restaurant_count_word(area["count"], label=True)}</a> '
            f'<a class="button secondary" href="/map/?area={e(area["slug"])}">Map this area</a></p>'
            f'<div class="card-grid">{"".join(card(restaurant, "h2") for restaurant in group)}</div>'
            f'{area_link_nav(areas, current=area["slug"], label="More areas")}'
            "</div></article>"
        )
        description = area_description(area)
        write(
            ROOT / "areas" / area["slug"] / "index.html",
            layout(
                f"Restaurants in {name}, FL | Eating in Destin",
                description,
                f'/areas/{area["slug"]}/',
                "areas",
                body,
                json_ld(
                    graph(
                        {
                            "@type": "CollectionPage",
                            "name": f"Restaurants in {name}",
                            "url": f'{ORIGIN}/areas/{area["slug"]}/',
                            "description": description,
                            "isPartOf": {"@id": ORIGIN + "/#website"},
                        },
                        {
                            "@type": "ItemList",
                            "name": f'Restaurants in {area["fullName"]}',
                            "numberOfItems": len(group),
                            "itemListElement": [
                                {
                                    "@type": "ListItem",
                                    "position": index,
                                    "name": restaurant["name"],
                                    "url": f"{ORIGIN}/restaurants/{restaurant['slug']}/",
                                }
                                for index, restaurant in enumerate(group, start=1)
                            ],
                        },
                        breadcrumbs(area_crumbs),
                    )
                ),
                image=area["image"],
                image_alt=f'{area["fullName"]} in Destin' if area["image"] else SHARE_ALT,
            ),
        )


def print_cover(cover: dict) -> str:
    return (
        "<figure>"
        f'<picture><source srcset="{e(cover["webp"])}" type="image/webp">'
        f'<img src="{e(cover["jpg"])}" width="{cover["width"]}" height="{cover["height"]}" '
        f'alt="{e(cover["alt"])}" loading="lazy" decoding="async">'
        "</picture></figure>"
    )


def window_decal_aside() -> str:
    return (
        '<aside class="window-decal" aria-labelledby="window-decal-heading">'
        "<picture>"
        f'<source srcset="{e(DECAL_WEBP)}" type="image/webp">'
        f'<img src="{e(DECAL_IMAGE)}" width="720" height="720" alt="{e(DECAL_ALT)}" decoding="async">'
        "</picture>"
        '<p class="kicker">For restaurants</p>'
        '<h2 id="window-decal-heading">A free window decal</h2>'
        "<p>Restaurants in the guide can have a free window decal. "
        f'<a class="text-link" href="{e(decal_contact_href())}">Contact us</a> '
        "with the restaurant name and a mailing address, and we\u2019ll send one.</p>"
        "</aside>"
    )


def build_about() -> None:
    covers = "".join(print_cover(cover) for cover in PRINT_COVERS)
    body = (
        '<div class="wrap page-intro about-intro">'
        '<div class="prose about-copy">'
        f'{crumb_nav([("Home", "/"), ("About", "/about/")])}'
        '<p class="kicker">About</p>'
        "<h1>The Destin restaurant guide</h1>"
        f"<p>{e(ABOUT_LEAD)}</p>"
        f"<p>{e(ABOUT_TOWNS)}</p>"
        '<p><a class="button" href="/restaurants/">See the restaurants</a></p>'
        "</div>"
        f"{window_decal_aside()}"
        '<div class="prose">'
        '<section class="print-guides" aria-labelledby="print-guides-heading">'
        '<h2 id="print-guides-heading">Coming in 2027</h2>'
        f"<p>{e(PRINT_GUIDES)}</p>"
        '<p>For information or to reserve your space, please '
        '<a class="text-link" href="/contact/">contact us</a>.</p>'
        f'<div class="print-covers">{covers}</div>'
        "</section></div></div>"
    )
    write(
        ROOT / "about" / "index.html",
        layout(
            "About the Eating in Destin restaurant guide",
            "Find breakfast, lunch, and dinner in Destin and Miramar Beach, Florida, including Destin Harbor, Crystal Beach, and Sandestin.",
            "/about/",
            "about",
            body,
            json_ld(
                graph(
                    {
                        "@type": "AboutPage",
                        "name": "About Eating in Destin",
                        "url": ORIGIN + "/about/",
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                        "description": ABOUT,
                    },
                    breadcrumbs([("Home", "/"), ("About", "/about/")]),
                )
            ),
            include_js=False,
        ),
    )


def build_contact() -> None:
    body = (
        '<div class="wrap page-intro">'
        '<div class="prose">'
        f'{crumb_nav([("Home", "/"), ("Contact", "/contact/")])}'
        '<p class="kicker">Contact</p>'
        "<h1>Corrections and new listings</h1>"
        "<p>Restaurant hours, phone numbers, websites, and other details are listed on each restaurant page. "
        "If something needs to be updated, a restaurant has closed, or we’re missing a place you think should be included, let us know.</p>"
        "<p>Just include the restaurant name and what needs to be changed or added. "
        "We review every submission and can follow up using the email address you provide.</p></div>"
        '<form class="listing-form" action="/api/listing" method="post" data-listing>'
        "<label><span>Your name <abbr title=\"required\">*</abbr></span>"
        '<input name="name" type="text" required maxlength="120" autocomplete="name"></label>'
        "<label><span>Email <abbr title=\"required\">*</abbr></span>"
        '<input name="email" type="email" required maxlength="200" autocomplete="email" inputmode="email"></label>'
        "<label><span>Restaurant name</span>"
        '<input name="restaurant" type="text" maxlength="160" autocomplete="organization"></label>'
        "<fieldset><legend>Request type <abbr title=\"required\">*</abbr></legend>"
        '<label class="listing-choice"><input type="radio" name="type" value="update" required> <span>Update</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="edit"> <span>Edit</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="deletion"> <span>Deletion</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="new"> <span>New listing</span></label>'
        '<label class="listing-choice"><input type="radio" name="type" value="other"> <span>Other</span></label>'
        "</fieldset>"
        "<label><span>Details <abbr title=\"required\">*</abbr></span>"
        '<textarea name="details" required maxlength="4000" rows="6"></textarea></label>'
        '<button type="submit">Submit</button>'
        '<p class="listing-status" role="status" aria-live="polite"></p>'
        "</form></div>"
    )
    write(
        ROOT / "contact" / "index.html",
        layout(
            "Contact Eating in Destin about a listing",
            "Request an update, edit, deletion, or new restaurant listing on the Eating in Destin guide for Destin and Miramar Beach.",
            "/contact/",
            "",
            body,
            json_ld(
                graph(
                    {
                        "@type": "ContactPage",
                        "name": "Contact Eating in Destin",
                        "url": ORIGIN + "/contact/",
                        "isPartOf": {"@id": ORIGIN + "/#website"},
                    },
                    breadcrumbs([("Home", "/"), ("Contact", "/contact/")]),
                )
            ),
            include_js=False,
            extra_scripts='<script src="/listing.js"></script>\n',
        ),
    )


def build_404() -> None:
    body = (
        '<div class="wrap page-intro prose"><p class="kicker">Not found</p><h1>That page is not on the menu.</h1>'
        '<p>Try the restaurant directory or the map.</p>'
        '<p><a class="button" href="/restaurants/">Browse restaurants</a></p></div>'
    )
    write(
        ROOT / "404.html",
        layout(
            "Page not found | Eating in Destin",
            "That page is not on the Eating in Destin guide to restaurants in Destin and Miramar Beach, Florida. Try the directory.",
            "/404.html",
            "",
            body,
            json_ld(
                {
                    "@context": "https://schema.org",
                    "@type": "WebPage",
                    "name": "Page not found",
                    "url": ORIGIN + "/404.html",
                    "isPartOf": {"@id": ORIGIN + "/#website"},
                }
            ),
            include_js=False,
            noindex=True,
        ),
    )


def newest_date(dates: list[str]) -> str:
    found = [date for date in dates if date]
    return max(found) if found else ""


def build_sitemap(restaurants: list[dict], areas: list[dict], guides: list[dict]) -> None:
    site_date = newest_date([restaurant["updated"] for restaurant in restaurants])
    urls = [
        ("/", site_date),
        ("/restaurants/", site_date),
        ("/map/", site_date),
        ("/areas/", site_date),
        ("/guides/", site_date),
        ("/about/", site_date),
        ("/contact/", site_date),
    ]
    for guide in guides:
        guide_date = newest_date(restaurant["updated"] for restaurant in guide["restaurants"])
        urls.append((guide["path"], guide_date or site_date))
    for area in areas:
        area_date = newest_date(
            restaurant["updated"] for restaurant in restaurants if restaurant["areaSlug"] == area["slug"]
        )
        urls.append((f"/areas/{area['slug']}/", area_date or site_date))
    for restaurant in restaurants:
        urls.append((f"/restaurants/{restaurant['slug']}/", restaurant["updated"]))
    lines = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for path, updated in urls:
        lines.append("  <url>")
        lines.append(f"    <loc>{e(ORIGIN + path)}</loc>")
        if updated:
            lines.append(f"    <lastmod>{e(updated)}</lastmod>")
        lines.append("  </url>")
    lines.append("</urlset>")
    write(ROOT / "sitemap.xml", "\n".join(lines) + "\n")


def build_robots() -> None:
    agents = [
        "*",
        "Googlebot",
        "Bingbot",
        "GPTBot",
        "ChatGPT-User",
        "Google-Extended",
        "ClaudeBot",
        "anthropic-ai",
        "PerplexityBot",
        "Applebot-Extended",
        "Bytespider",
        "CCBot",
        "meta-externalagent",
        "FacebookBot",
    ]
    blocks = [
        f"# Public site: {ORIGIN}/",
        "# Search and AI crawlers may read this site.",
        f"# {ORIGIN}/llms.txt",
        f"# {ORIGIN}/llms-full.txt",
        "",
    ]
    blocks.extend(f"User-agent: {agent}\nAllow: /\n" for agent in agents)
    text = "\n".join(blocks) + f"\nSitemap: {ORIGIN}/sitemap.xml\n"
    write(ROOT / "robots.txt", text)


def build_llms(restaurants: list[dict], areas: list[dict], guides: list[dict]) -> None:
    lines = [
        "# Eating in Destin",
        "",
        "> Restaurant guide for Destin and Miramar Beach, Florida.",
        "",
        ABOUT,
        "",
        TOWNS,
        "",
        "Search by restaurant name, or look for restaurants and food in Destin, Miramar Beach, Sandestin, Destin Harbor, and nearby areas.",
        "",
        f"- [Home]({ORIGIN}/)",
        f"- [Restaurants]({ORIGIN}/restaurants/)",
        f"- [Map]({ORIGIN}/map/)",
        f"- [Areas]({ORIGIN}/areas/)",
        f"- [Guides]({ORIGIN}/guides/): Seafood, breakfast, coffee, areas, and favorites in Destin and Miramar Beach.",
        f"- [About]({ORIGIN}/about/): A restaurant guide for Destin and Miramar Beach.",
        f"- [Contact]({ORIGIN}/contact/): Send a correction, edit, deletion, or new listing.",
        "",
        "## Areas",
        "",
    ]
    for area in areas:
        lines.append(f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']}")
    lines.extend(["", "## Guides", ""])
    for guide in guides:
        lines.append(f"- [{guide['h1']}]({ORIGIN}{guide['path']}): {guide['llms']}")
    lines.extend(
        [
            "",
            "## Restaurants",
            "",
        ]
    )
    for restaurant in restaurants:
        cuisine = ", ".join(restaurant["cuisines"][:3]) or "Restaurant"
        city = restaurant["city"] or "Destin"
        area = restaurant["area"]
        place = city if area.lower() == city.lower() else f"{area}, {city}"
        if "Destin" not in place:
            place = f"{place}, near Destin"
        lines.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/): {cuisine} in {place}, Florida."
        )
    lines.extend(
        [
            "",
            "## Optional",
            "",
            f"- [Extended guide for language models]({ORIGIN}/llms-full.txt): The same pages, with a short note for each restaurant.",
            f"- [Sitemap]({ORIGIN}/sitemap.xml): Every public page on this site.",
        ]
    )
    write(ROOT / "llms.txt", "\n".join(lines) + "\n")
    full = [
        "# Eating in Destin",
        "",
        "> Restaurant guide for Destin and Miramar Beach, Florida.",
        "",
        ABOUT,
        "",
        "Each profile gives the street address and a map pin. A photograph appears when the listing has one.",
        "",
        f"- [Home]({ORIGIN}/)",
        f"- [Restaurants]({ORIGIN}/restaurants/)",
        f"- [Map]({ORIGIN}/map/)",
        f"- [Areas]({ORIGIN}/areas/)",
        f"- [Guides]({ORIGIN}/guides/)",
        f"- [About]({ORIGIN}/about/)",
        f"- [Contact]({ORIGIN}/contact/)",
        f"- [Short index]({ORIGIN}/llms.txt)",
        f"- [Sitemap]({ORIGIN}/sitemap.xml)",
        "",
        "## Restaurants",
        "",
    ]
    for restaurant in restaurants:
        bits = ", ".join(restaurant["cuisines"]) or restaurant["category"] or "Restaurant"
        meals = ", ".join(restaurant["meals"])
        address = restaurant["address"] or restaurant["area"]
        full.append(
            f"- [{restaurant['name']}]({ORIGIN}/restaurants/{restaurant['slug']}/): {address}. {bits}; {meals}. {snippet(restaurant['notes'], 180)}"
        )
    full.extend(["", "## Areas", ""])
    for area in areas:
        full.append(f"- [{area['fullName']}]({ORIGIN}/areas/{area['slug']}/): {area['description']}")
    full.extend(["", "## Guides", ""])
    for guide in guides:
        full.append(f"- [{guide['h1']}]({ORIGIN}{guide['path']}): {guide['llms']}")
    write(ROOT / "llms-full.txt", "\n".join(full) + "\n")


def guide_picks(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    import guides_build

    return guides_build.guide_picks(restaurants, areas)


def build_guides(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    import guides_build

    return guides_build.build_guides(restaurants, areas)


def main() -> None:
    USED_TITLES.clear()
    USED_DESCRIPTIONS.clear()
    restaurants = published_restaurants()
    areas = load_areas(restaurants)
    hero = hero_image()
    cuisines = sorted({cuisine for restaurant in restaurants for cuisine in restaurant["cuisines"]})
    shutil.rmtree(ROOT / "restaurants", ignore_errors=True)
    shutil.rmtree(ROOT / "areas", ignore_errors=True)
    write(DATA / "restaurants.json", json.dumps([public_record(item) for item in restaurants], indent=2) + "\n")
    write(
        DATA / "locations.json",
        json.dumps(
            [
                {
                    "slug": area["slug"],
                    "name": area["fullName"],
                    "shortName": area["name"],
                    "description": area["description"],
                    "count": area["count"],
                    "image": area["image"],
                }
                for area in areas
            ],
            indent=2,
        )
        + "\n",
    )
    build_home(restaurants, areas, hero)
    build_directory(restaurants, areas, cuisines)
    for restaurant in restaurants:
        build_detail(restaurant, restaurants)
    build_map(areas, cuisines)
    build_areas(areas, restaurants)
    guides = build_guides(restaurants, areas)
    build_about()
    build_contact()
    build_404()
    build_sitemap(restaurants, areas, guides)
    build_robots()
    build_llms(restaurants, areas, guides)
    photos = sum(1 for restaurant in restaurants if restaurant["cardImage"])
    print(f"Built {len(restaurants)} restaurants, {len(areas)} areas, {photos} photos")


if __name__ == "__main__":
    main()
