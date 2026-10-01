"""Visitor guides for Eating in Destin.

Cards come from published listing fields. Prose stays general: it can name an
area, a meal, or a cuisine, and it does not name a restaurant.
"""

from __future__ import annotations

import re
import shutil
from urllib.parse import urlencode

# Outdoor seating in the harbor, the resort, and Crystal Beach is the closest
# listing signal to a waterfront meal. There is no waterfront field.
WATER_AREAS = ("destin-harbor", "sandestin", "crystal-beach")

GUIDES_INDEX_TITLE = "Restaurant guides for Destin | Eating in Destin"
GUIDES_INDEX_DESCRIPTION = (
    "Guides for meals, areas, and favorites in Destin and Miramar Beach, Florida, "
    "each drawn from the restaurant directory and the map."
)

BANNED_PROSE = (
    "this page gathers",
    "tagged",
    "checkbox",
    "west to east",
    "west-to-east",
    "western edge of the guide",
    "from the Harbor to Crystal Beach",
    "from Destin Harbor to Crystal Beach",
    "from Miramar Beach to Crystal Beach",
    "from Miramar Beach through the Harbor",
    "neighborhoods in between",
    "east end of Destin",
)


def check_meta(title: str, description: str) -> None:
    if not 20 <= len(title) <= 70:
        raise SystemExit(f"title length {len(title)}: {title}")
    if not 110 <= len(description) <= 165 or "Destin" not in description:
        raise SystemExit(f"description length {len(description)}: {description}")


def human_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} and {items[1]}"
    return ", ".join(items[:-1]) + f", and {items[-1]}"


def or_list(items: list[str]) -> str:
    if not items:
        return ""
    if len(items) == 1:
        return items[0]
    if len(items) == 2:
        return f"{items[0]} or {items[1]}"
    return ", ".join(items[:-1]) + f", or {items[-1]}"


def coast_order(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    order = {area["slug"]: index for index, area in enumerate(areas)}
    return sorted(
        restaurants,
        key=lambda restaurant: (order.get(restaurant["areaSlug"], len(order)), restaurant["name"].lower()),
    )


def filter_href(path: str, pairs: list[tuple[str, str]]) -> str:
    return path + "?" + urlencode(pairs)


def area_record(areas: list[dict], slug: str) -> dict:
    return next(area for area in areas if area["slug"] == slug)


def area_groups(picked: list[dict], areas: list[dict]) -> list[tuple[dict, list[dict]]]:
    groups = []
    for area in areas:
        group = [restaurant for restaurant in picked if restaurant["areaSlug"] == area["slug"]]
        if group:
            groups.append((area, group))
    return groups


def rank_areas(picked: list[dict], areas: list[dict]) -> tuple[list, list]:
    groups = area_groups(picked, areas)
    ranked = sorted(groups, key=lambda item: (-len(item[1]), item[0]["fullName"]))
    return groups, ranked


def tier_names(groups: list, ranked: list) -> str:
    if len(ranked) < 2 or len(ranked[0][1]) == len(ranked[1][1]):
        return ""
    count = len(ranked[1][1])
    order = {id(area): index for index, (area, _group) in enumerate(groups)}
    tied = [item for item in ranked[1:] if len(item[1]) == count]
    tied.sort(key=lambda item: order.get(id(item[0]), 0))
    return human_list([item[0]["fullName"] for item in tied])


def widest_choice(groups: list, ranked: list) -> str:
    top_count = len(ranked[0][1])
    leaders = [item[0]["fullName"] for item in ranked if len(item[1]) == top_count]
    if len(leaders) == 1:
        text = f"{leaders[0]} has the widest choice"
        nxt = tier_names(groups, ranked)
        if nxt:
            text += f", then {nxt}"
        return text
    return f"{human_list(leaders)} have the widest choice"


def spread_sentence(picked: list[dict], areas: list[dict], noun: str) -> str:
    groups, ranked = rank_areas(picked, areas)
    leaders = {item[0]["fullName"] for item in ranked if len(item[1]) == len(ranked[0][1])}
    second = len(ranked[1][1]) if len(ranked) > 1 and len(ranked[0][1]) != len(ranked[1][1]) else None
    featured = set(leaders)
    if second is not None:
        featured.update(item[0]["fullName"] for item in ranked if len(item[1]) == second)
    elsewhere = [area["fullName"] for area, _group in groups if area["fullName"] not in featured]
    text = f"{widest_choice(groups, ranked)}."
    if elsewhere:
        text += f" You’ll also find {noun} in {human_list(elsewhere)}."
    return text


def text_link(href: str, label: str) -> str:
    import build

    return f'<a class="text-link" href="{build.e(href)}">{build.e(label)}</a>'


def faq_item(question: str, answer: str, href: str = "", label: str = "") -> dict:
    import build

    html = build.e(answer)
    if href:
        html += " " + text_link(href, label) + "."
    return {"question": question, "answer": answer, "html": html}


def faq_nodes(items: list[dict]) -> dict:
    return {
        "@type": "FAQPage",
        "mainEntity": [
            {
                "@type": "Question",
                "name": item["question"],
                "acceptedAnswer": {"@type": "Answer", "text": item["answer"]},
            }
            for item in items
        ],
    }


def faq_html(items: list[dict]) -> str:
    import build

    blocks = [
        '<section class="guide-faq" aria-labelledby="guide-faq-heading">',
        '<h2 id="guide-faq-heading">Common questions</h2>',
    ]
    for item in items:
        blocks.append(f"<h3>{build.e(item['question'])}</h3><p>{item['html']}</p>")
    blocks.append("</section>")
    return "".join(blocks)


def show_label(count: int) -> str:
    import build

    return f"Show {count} {build.restaurant_count_word(count, label=True)}"


# One existing photo per guide, used as both the hub card and the page hero.
# Restaurant covers are listings on that guide. Area covers are the area photos
# already used on the area pages. None of these paths should be repeated.
GUIDE_COVERS = {
    "best-seafood-destin": ("restaurant", "brotula-s-seafood-house-and-steamer-destin-harbor"),
    "breakfast-destin": ("restaurant", "another-broken-egg-cafe-grand-boulevard-grand-boulevard"),
    "coffee-brunch-destin": ("restaurant", "camille-s-sidewalk-cafe-crystal-beach"),
    "kid-friendly-destin": ("restaurant", "moo-la-la-ice-cream-and-desserts-sandestin"),
    "dinner-sandestin": ("restaurant", "the-beach-house-sandestin"),
    "destin-harbor-restaurants": ("restaurant", "dewey-destin-s-harborside-destin-harbor"),
    "miramar-beach-restaurants": ("area", "miramar-beach"),
    "waterfront-destin": ("area", "crystal-beach"),
    "laurens-favorites-destin": ("restaurant", "mcguire-s-irish-pub-destin-harbor"),
}


def guide_cover(slug: str, restaurants: list[dict], areas: list[dict]) -> tuple[str, str]:
    import build

    kind, key = GUIDE_COVERS[slug]
    if kind == "area":
        area = area_record(areas, key)
        path = area.get("image") or ""
        alt = f"{area['fullName']} in Destin"
    else:
        restaurant = next(item for item in restaurants if item["slug"] == key)
        path = restaurant["cardImage"] or ""
        alt = build.photo_alt(restaurant)
    photo = build.ROOT / path.lstrip("/")
    if not path or not photo.is_file():
        raise SystemExit(f"{slug} cover is missing: {path}")
    return path, alt


def guide_spec(
    slug: str,
    h1: str,
    title: str,
    description: str,
    kicker: str,
    paragraphs: list[str],
    restaurants: list[dict],
    directory_href: str,
    map_href: str,
    faqs: list[dict],
    teaser_area: str,
    teaser_note: str,
    teaser: tuple[str, str],
    llms: str,
    extra: list[tuple[str, str]] | None = None,
    extra_label: str = "More ways to browse",
    directory_label: str = "",
    map_label: str = "Map these restaurants",
    list_name: str = "",
) -> dict:
    return {
        "slug": slug,
        "path": f"/guides/{slug}/",
        "h1": h1,
        "title": title,
        "description": description,
        "kicker": kicker,
        "paragraphs": paragraphs,
        "restaurants": restaurants,
        "directory_href": directory_href,
        "directory_label": directory_label or show_label(len(restaurants)),
        "map_href": map_href,
        "map_label": map_label,
        "faqs": faqs,
        "teaser_area": teaser_area,
        "teaser_note": teaser_note,
        "teaser_image": teaser[0],
        "teaser_alt": teaser[1],
        "llms": llms,
        "extra": extra or [],
        "extra_label": extra_label,
        "list_name": list_name or h1,
    }


def guard_prose(spec: dict, restaurants: list[dict]) -> None:
    prose = "\n".join(
        spec["paragraphs"]
        + [item["question"] + "\n" + item["answer"] for item in spec["faqs"]]
        + [spec["teaser_note"], spec["llms"], spec["description"], spec["h1"]]
    )
    lowered = prose.lower()
    for phrase in BANNED_PROSE:
        if phrase.lower() in lowered:
            raise SystemExit(f"{spec['slug']} uses banned phrase: {phrase}")
    digits = set(re.findall(r"\d+", prose))
    extra_digits = digits - {"98"}
    if extra_digits:
        raise SystemExit(f"{spec['slug']} has a count in the prose: {sorted(extra_digits)}")
    for restaurant in restaurants:
        if restaurant["name"] and restaurant["name"] in prose:
            raise SystemExit(f"{spec['slug']} names {restaurant['name']}")


def guide_picks(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    ranked = coast_order(restaurants, areas)

    def choose(pred) -> list[dict]:
        return [restaurant for restaurant in ranked if pred(restaurant)]

    seafood = choose(lambda restaurant: "Seafood" in restaurant["cuisines"])
    breakfast = choose(lambda restaurant: "Breakfast" in restaurant["meals"])
    kids = choose(lambda restaurant: restaurant["kids"])
    dinner = choose(lambda restaurant: restaurant["areaSlug"] == "sandestin" and "Dinner" in restaurant["meals"])
    harbor = choose(lambda restaurant: restaurant["areaSlug"] == "destin-harbor")
    miramar = choose(lambda restaurant: restaurant["areaSlug"] == "miramar-beach")
    sandestin = choose(lambda restaurant: restaurant["areaSlug"] == "sandestin")
    water = choose(lambda restaurant: restaurant["outdoor"] and restaurant["areaSlug"] in WATER_AREAS)
    favorites = choose(lambda restaurant: restaurant["laurensFavorite"])
    cafes = choose(lambda restaurant: "Cafe" in restaurant["cuisines"])
    groups = {
        "seafood": seafood,
        "breakfast": breakfast,
        "kids": kids,
        "dinner": dinner,
        "harbor": harbor,
        "miramar": miramar,
        "water": water,
        "favorites": favorites,
        "cafes": cafes,
    }
    empty = [name for name, group in groups.items() if not group]
    if empty:
        raise SystemExit("guide is empty: " + ", ".join(empty))

    seafood_href = "/restaurants/?cuisine=Seafood"
    seafood_map = "/map/?cuisine=Seafood"
    breakfast_href = "/restaurants/?meal=Breakfast"
    breakfast_map = "/map/?meal=Breakfast"
    kids_href = "/restaurants/?kids=yes"
    kids_map = "/map/?kids=yes"
    dinner_href = filter_href("/restaurants/", [("area", "sandestin"), ("meal", "Dinner")])
    dinner_map = filter_href("/map/", [("area", "sandestin"), ("meal", "Dinner")])
    harbor_href = "/restaurants/?area=destin-harbor"
    harbor_map = "/map/?area=destin-harbor"
    miramar_href = "/restaurants/?area=miramar-beach"
    miramar_map = "/map/?area=miramar-beach"
    favorites_href = "/restaurants/?laurens=yes"
    favorites_map = "/map/?laurens=yes"
    cafe_href = "/restaurants/?cuisine=Cafe"
    cafe_map = "/map/?cuisine=Cafe"
    harbor_outdoor = filter_href("/restaurants/", [("area", "destin-harbor"), ("outdoor", "yes")])
    harbor_outdoor_map = filter_href("/map/", [("area", "destin-harbor"), ("outdoor", "yes")])

    breakfast_groups, _breakfast_ranked = rank_areas(breakfast, areas)
    breakfast_towns = {restaurant["areaSlug"] for restaurant in breakfast}
    breakfast_missing = [area["fullName"] for area in areas if area["slug"] not in breakfast_towns]
    cafe_groups, _cafe_ranked = rank_areas(cafes, areas)
    kids_groups, _kids_ranked = rank_areas(kids, areas)
    seafood_where = spread_sentence(seafood, areas, "seafood")
    breakfast_where = spread_sentence(breakfast, areas, "breakfast")
    kids_where = spread_sentence(kids, areas, "kid-friendly restaurants")
    cafe_where = spread_sentence(cafes, areas, "cafes")
    seafood_kids = any(restaurant["kids"] for restaurant in seafood)
    breakfast_kids = any(restaurant["kids"] for restaurant in breakfast)
    cafe_not_breakfast = [restaurant for restaurant in cafes if "Breakfast" not in restaurant["meals"]]
    coffee_not_cafe = [
        restaurant
        for restaurant in restaurants
        if "Coffee" in restaurant["foods"] and "Cafe" not in restaurant["cuisines"]
    ]
    bakery = any("Bakery" in restaurant["foods"] or "Donuts" in restaurant["foods"] for restaurant in cafes)
    oyster = any("Oyster Bar" in restaurant["foods"] for restaurant in seafood)
    also_sushi = any("Sushi" in restaurant["cuisines"] or "Sushi" in restaurant["foods"] for restaurant in seafood)
    also_steak = any("Steak" in restaurant["foods"] for restaurant in seafood)
    sandestin_other = [restaurant for restaurant in sandestin if "Dinner" not in restaurant["meals"]]
    dinner_not_kids = [restaurant for restaurant in dinner if not restaurant["kids"]]
    dinner_kids = [restaurant for restaurant in dinner if restaurant["kids"]]
    harbor_not_dinner = [restaurant for restaurant in harbor if "Dinner" not in restaurant["meals"]]
    fav_seafood = [restaurant for restaurant in favorites if "Seafood" in restaurant["cuisines"]]
    fav_other = [restaurant for restaurant in favorites if "Seafood" not in restaurant["cuisines"]]
    fav_kids = [restaurant for restaurant in favorites if restaurant["kids"]]
    fav_not_kids = [restaurant for restaurant in favorites if not restaurant["kids"]]
    fav_areas = [area["fullName"] for area in areas if any(restaurant["areaSlug"] == area["slug"] for restaurant in favorites)]
    miramar_bits = []
    if any("Breakfast" in restaurant["meals"] for restaurant in miramar):
        miramar_bits.append("breakfast before the beach")
    if any("Seafood" in restaurant["cuisines"] for restaurant in miramar):
        miramar_bits.append("seafood")
    if any("Dinner" in restaurant["meals"] for restaurant in miramar):
        miramar_bits.append("dinner")
    kids_areas = {restaurant["areaSlug"] for restaurant in kids}

    seafood_range = "The list is sit-down seafood houses and casual seafood rooms"
    if oyster:
        seafood_range = "The list runs from oyster bars to sit-down seafood houses"
    seafood_also = ""
    if also_sushi and also_steak:
        seafood_also = " Some of those restaurants also serve sushi or a steak."
    elif also_sushi:
        seafood_also = " Some of those restaurants also serve sushi."
    elif also_steak:
        seafood_also = " Some of those restaurants also serve a steak."

    if cafe_not_breakfast:
        cafe_breakfast = "Some of these cafes don’t serve breakfast. Check the restaurant so you don’t arrive for a morning meal at a lunch stop."
        cafe_breakfast_faq = "Some do and some don’t. Open the restaurant before you count on a morning meal."
    else:
        cafe_breakfast = "The cafes here also serve breakfast."
        cafe_breakfast_faq = "Yes. The cafes on this page also cover breakfast. The breakfast guide is the wider morning list."
    coffee_extra = ""
    if coffee_not_cafe:
        coffee_extra = " Search coffee in the directory for a few more cups that aren’t on this cafe list."
    morning_kinds = "coffee, a bakery, or a morning plate" if bakery else "coffee or a morning plate"

    if breakfast_missing:
        breakfast_gap = (
            f"Staying in {or_list(breakfast_missing)}? Plan a short drive. "
            "Those areas don’t have a breakfast restaurant."
        )
        breakfast_gap_faq = f"None in {or_list(breakfast_missing)}. Plan a short drive to a neighboring area."
    else:
        breakfast_gap = "Every area has a morning restaurant, so you can eat near where you’re staying."
        breakfast_gap_faq = "Every area has at least one breakfast restaurant."

    if sandestin_other:
        dinner_daytime = "Not every Sandestin restaurant serves dinner. Daytime stops stay on the Sandestin area page."
        dinner_daytime_faq = "No. Coffee, breakfast, and other daytime stops stay on the Sandestin area page."
    else:
        dinner_daytime = "The Sandestin restaurants here all serve dinner. The area page still has the full resort list."
        dinner_daytime_faq = "Yes. The Sandestin restaurants on this page all serve dinner."

    if dinner_kids and dinner_not_kids:
        dinner_kids_copy = "Some Sandestin dinners are listed as kid friendly and some aren’t. Use kid friendly with Sandestin and dinner if that’s the plan."
        dinner_kids_faq = "Some yes, some no. Use kid friendly with Sandestin and dinner, and open the restaurant before you promise a table."
    elif dinner_kids:
        dinner_kids_copy = "The dinners here are listed as kid friendly. Open the restaurant if you need a high chair, which isn’t listed."
        dinner_kids_faq = "Yes. These Sandestin dinners are listed as kid friendly."
    else:
        dinner_kids_copy = "These Sandestin dinners aren’t listed as kid friendly. Open the restaurant before you bring children."
        dinner_kids_faq = "No. These Sandestin dinners aren’t listed as kid friendly."

    if harbor_not_dinner:
        harbor_day = "Not every stop serves dinner. Daytime counters are mixed in with the dining rooms. For the evening only, show dinner in Destin Harbor."
        harbor_day_faq = "No. Daytime stops are mixed in. The directory can show dinner in Destin Harbor on its own."
    else:
        harbor_day = "The Destin Harbor restaurants here all serve dinner."
        harbor_day_faq = "Yes. The Destin Harbor restaurants on this page all serve dinner."

    if fav_seafood and fav_other:
        fav_food = "Some are seafood and some aren’t."
        fav_food_faq = "No. Some are seafood and some aren’t."
    elif fav_seafood:
        fav_food = "The favorites here are seafood."
        fav_food_faq = "Yes. These favorites are seafood."
    else:
        fav_food = "None of these favorites are seafood."
        fav_food_faq = "No. None of these favorites are seafood."
    if fav_kids and fav_not_kids:
        fav_family = "Some are listed as kid friendly and some aren’t. Check the restaurant if you’re bringing children."
        fav_family_faq = "Some are and some aren’t. Check the restaurant before you bring children."
    elif fav_kids:
        fav_family = "These favorites are listed as kid friendly."
        fav_family_faq = "Yes. These favorites are listed as kid friendly."
    else:
        fav_family = "These favorites aren’t listed as kid friendly."
        fav_family_faq = "No. These favorites aren’t listed as kid friendly."

    kid_meals = "Both breakfast and seafood include kid-friendly restaurants." if seafood_kids and breakfast_kids else (
        "Breakfast includes kid-friendly restaurants." if breakfast_kids else "Seafood includes kid-friendly restaurants." if seafood_kids else "Open a restaurant before you count on a kids’ menu."
    )
    kids_everywhere = "You’ll still find them in every area." if len(kids_areas) == len(areas) else "The directory can show the kid-friendly list on its own."

    specs = [
        guide_spec(
            "best-seafood-destin",
            "Best seafood in Destin",
            "Best seafood in Destin | Eating in Destin",
            (
                "Best seafood restaurants in Destin and Miramar Beach, Florida, "
                "from oyster bars to sit-down seafood houses, with the directory and a map."
            ),
            "Seafood",
            [
                "Looking for seafood in Destin? The harbor is still a fishing harbor, and the meal people come for is the catch: oysters, shrimp, and a fish plate, whether that’s a basket after the beach or a longer dinner.",
                f"{seafood_where} {seafood_range}.{seafood_also}",
                "Open a restaurant for the address and the hours. The directory and the map can show seafood on its own, or seafood together with kid friendly, so you can see what’s closest to where you’re staying.",
                "Summer, spring break, and holiday weekends pack the harbor and the rooms along 98. Hours shift outside that season. Check before you drive across town, and go a little early if you want a table. If you’re cooking at the rental, this list is for eating out.",
            ],
            seafood,
            seafood_href,
            seafood_map,
            [
                faq_item(
                    "Where in Destin is the seafood?",
                    seafood_where,
                    seafood_href,
                    "See seafood in the directory",
                ),
                faq_item(
                    "Are there kid-friendly seafood restaurants?",
                    "Yes. Kid-friendly seafood is part of this list. The directory can show seafood and kid friendly together."
                    if seafood_kids
                    else "None of the seafood restaurants here are listed as kid friendly.",
                    filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]),
                    "Show kid-friendly seafood",
                ),
                faq_item(
                    "Can I eat seafood at Destin Harbor?",
                    "Yes. Destin Harbor has seafood restaurants, along with the rest of the coast. Show seafood there when that’s the plan for the day.",
                    filter_href("/restaurants/", [("area", "destin-harbor"), ("cuisine", "Seafood")]),
                    "Show Destin Harbor seafood",
                ),
            ],
            "Seafood",
            "Oyster bars and seafood houses in Destin and Miramar Beach.",
            guide_cover("best-seafood-destin", restaurants, areas),
            "Seafood restaurants in Destin and Miramar Beach.",
            extra=[(filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]), "Kid-friendly seafood")],
            extra_label="Seafood filters",
            list_name="Seafood restaurants in Destin",
        ),
        guide_spec(
            "breakfast-destin",
            "Breakfast in Destin",
            "Breakfast in Destin | Eating in Destin",
            (
                "Breakfast restaurants in Destin and Miramar Beach, Florida, "
                "for the meal before the beach, with the directory and a map for the morning."
            ),
            "Breakfast",
            [
                f"Breakfast in Destin is the meal before the beach. {breakfast_where}",
                breakfast_gap,
                "Some morning spots are cafes, with coffee and something baked. For a late breakfast that stays with the cafes, use the coffee guide. Diners that aren’t cafes stay on this page.",
                "Open a restaurant for the address and the hours. If you already know the area, the directory and the map can show breakfast on its own, or breakfast with kid friendly.",
                "Weekend mornings in season draw a line. Eat before you head to the sand, and check the hours outside summer, when rooms change their opening time.",
            ],
            breakfast,
            breakfast_href,
            breakfast_map,
            [
                faq_item(
                    "Where can I get breakfast in Destin?",
                    breakfast_where,
                    breakfast_href,
                    "See breakfast in the directory",
                ),
                faq_item(
                    "Which areas don’t have breakfast?",
                    breakfast_gap_faq,
                    breakfast_href,
                    "Show the breakfast list",
                ),
                faq_item(
                    "Can I get coffee with breakfast?",
                    "Some breakfast spots are cafes. The coffee guide is that shorter list, for a cup or a later morning.",
                    "/guides/coffee-brunch-destin/",
                    "Open coffee and brunch",
                ),
            ],
            "Breakfast",
            f"Morning in Destin. {widest_choice(breakfast_groups, _breakfast_ranked)}.",
            guide_cover("breakfast-destin", restaurants, areas),
            "Breakfast restaurants in Destin and Miramar Beach.",
            list_name="Breakfast in Destin",
        ),
        guide_spec(
            "coffee-brunch-destin",
            "Coffee and brunch in Destin",
            "Coffee and brunch in Destin | Eating in Destin",
            (
                "Coffee and cafes in Destin and Miramar Beach, Florida, for a late breakfast or a cup before the beach. "
                "There isn’t a separate brunch meal."
            ),
            "Coffee",
            [
                f"Need coffee before the beach? Destin doesn’t list brunch as its own meal. A cafe is the late breakfast: {morning_kinds}.",
                cafe_where,
                f"{cafe_breakfast} The breakfast guide is the wider morning list, including diners that aren’t cafes.",
                "Open a restaurant for the hours. Weekend mornings in season draw a line at the busy spots. A coffee counter is the stop on the way to the sand. A sit-down cafe is the better plan when you want an actual breakfast."
                + coffee_extra,
            ],
            cafes,
            cafe_href,
            cafe_map,
            [
                faq_item(
                    "Is there brunch in Destin?",
                    "Not as its own meal. Breakfast and the cafes cover a late morning. Coffee, a bakery, and a plate are the plan.",
                    cafe_href,
                    "See cafes in the directory",
                ),
                faq_item(
                    "Where is the coffee?",
                    cafe_where,
                    cafe_href,
                    "See cafes in the directory",
                ),
                faq_item(
                    "Do these cafes serve breakfast?",
                    cafe_breakfast_faq,
                    breakfast_href,
                    "Show breakfast",
                ),
            ],
            "Coffee",
            "Cafes and coffee. Destin doesn’t list brunch as its own meal.",
            guide_cover("coffee-brunch-destin", restaurants, areas),
            "Cafes and coffee in Destin and Miramar Beach. There isn’t a separate brunch meal.",
            list_name="Coffee and cafes in Destin",
        ),
        guide_spec(
            "kid-friendly-destin",
            "Kid-friendly in Destin and Miramar",
            "Kid-friendly Destin and Miramar | Eating in Destin",
            (
                "Kid-friendly restaurants in Destin and Miramar Beach, Florida, "
                "for families eating breakfast, seafood, lunch, and dinner along the coast."
            ),
            "With kids",
            [
                f"Destin and Miramar Beach are easy with kids when you pick the right room. {kids_where}",
                f"You don’t have to skip the meal you wanted. {kid_meals} If the full set is too much, narrow it in the directory.",
                "Not every restaurant is a family stop. If a place isn’t on this page, it isn’t listed as kid friendly. Open the restaurant before you promise the kids a table.",
                "Lunch after the beach is usually kinder than a late dinner with tired children. The harbor and Baytowne get crowded on summer evenings, so an earlier meal is the easier plan. High chairs aren’t listed here, so call ahead if you need one.",
            ],
            kids,
            kids_href,
            kids_map,
            [
                faq_item(
                    "Is every restaurant in Destin kid friendly?",
                    "No. If a restaurant isn’t on this page, it isn’t listed as kid friendly. Check before you count on it with children.",
                    kids_href,
                    "Show the kid-friendly list",
                ),
                faq_item(
                    "Which areas have the most kid-friendly restaurants?",
                    f"{widest_choice(kids_groups, _kids_ranked)}. {kids_everywhere}",
                    kids_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Can we do breakfast or seafood with kids?",
                    kid_meals + " The directory can show either meal with kid friendly turned on.",
                    filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]),
                    "Show kid-friendly seafood",
                ),
            ],
            "Kid friendly",
            "Family meals in Destin and Miramar Beach.",
            guide_cover("kid-friendly-destin", restaurants, areas),
            "Kid-friendly restaurants in Destin and Miramar Beach.",
            extra=[
                (filter_href("/restaurants/", [("meal", "Breakfast"), ("kids", "yes")]), "Kid-friendly breakfast"),
                (filter_href("/restaurants/", [("cuisine", "Seafood"), ("kids", "yes")]), "Kid-friendly seafood"),
            ],
            list_name="Kid-friendly restaurants in Destin",
        ),
        guide_spec(
            "dinner-sandestin",
            "Dinner near Sandestin",
            "Dinner near Sandestin | Eating in Destin",
            (
                "Dinner near Sandestin in Destin, Florida, at Baytowne Wharf, the marina, "
                "and the resort hotels, with the directory and a map."
            ),
            "Sandestin",
            [
                "Staying at Sandestin and don’t want to get back on 98? Dinner here is inside the resort: Baytowne Wharf, the marina, and the hotel restaurants.",
                "Grand Boulevard, the town center north of the bay, is a short drive if you want the square instead of the wharf. Those restaurants are on the Grand Boulevard page, not this one.",
                dinner_daytime,
                dinner_kids_copy,
                "Baytowne gets busy on summer evenings. If you’re walking the wharf, eat a little early. Hours change with the season, so open the restaurant before you head over.",
            ],
            dinner,
            dinner_href,
            dinner_map,
            [
                faq_item(
                    "Does every Sandestin restaurant serve dinner?",
                    dinner_daytime_faq,
                    "/areas/sandestin/",
                    "Open the Sandestin area page",
                ),
                faq_item(
                    "Where in Sandestin is dinner?",
                    "Inside the resort: Baytowne Wharf, the marina, and the hotel restaurants. Grand Boulevard, north of the bay, is a separate area.",
                    dinner_href,
                    "See Sandestin dinner in the directory",
                ),
                faq_item(
                    "Can we bring kids to dinner in Sandestin?",
                    dinner_kids_faq,
                    filter_href("/restaurants/", [("area", "sandestin"), ("meal", "Dinner"), ("kids", "yes")]),
                    "Show kid-friendly Sandestin dinner",
                ),
            ],
            "Sandestin",
            "Evening inside Sandestin: Baytowne Wharf, the marina, and the hotels.",
            guide_cover("dinner-sandestin", restaurants, areas),
            "Dinner restaurants in Sandestin, near Destin.",
            extra=[
                ("/areas/sandestin/", "Sandestin area page"),
                ("/areas/grand-boulevard/", "Grand Boulevard restaurants"),
            ],
            list_name="Dinner near Sandestin",
        ),
        guide_spec(
            "destin-harbor-restaurants",
            "Destin Harbor restaurants",
            "Destin Harbor restaurants | Eating in Destin",
            (
                "Destin Harbor restaurants in Destin, Florida, at HarborWalk Village and the docks, "
                "with seafood, snacks, the directory, and a map."
            ),
            "Destin Harbor",
            [
                "Destin Harbor is the fishing harbor, and HarborWalk Village is the boardwalk beside the boats. Come hungry for seafood, and expect snacks, sweets, and a drink stop mixed in with the dining rooms.",
                harbor_day,
                "The area covers the boardwalk and the streets right around it. Open a restaurant for the address so you know whether you’re walking HarborWalk or driving to a spot nearby.",
                "Summer afternoons and weekends fill the boardwalk. Parking tightens up then. Check the hours before you leave the condo, and go a little early if you want to sit down.",
            ],
            harbor,
            harbor_href,
            harbor_map,
            [
                faq_item(
                    "Does every Destin Harbor restaurant serve dinner?",
                    harbor_day_faq,
                    filter_href("/restaurants/", [("area", "destin-harbor"), ("meal", "Dinner")]),
                    "Show Destin Harbor dinner",
                ),
                faq_item(
                    "Is this the same list as the area page?",
                    "Same restaurants. The area page introduces Destin Harbor. Here you can open the directory or the map with the harbor already selected.",
                    harbor_href,
                    "See Destin Harbor in the directory",
                ),
                faq_item(
                    "When is the harbor busiest?",
                    "Summer afternoons, weekends, and holiday weeks. Go a little early if you want a table, and check the hours before you leave.",
                    harbor_map,
                    "Map Destin Harbor",
                ),
            ],
            "Destin Harbor",
            "HarborWalk Village and the docks, with seafood houses and snack stops.",
            guide_cover("destin-harbor-restaurants", restaurants, areas),
            "Restaurants in Destin Harbor.",
            extra=[
                ("/areas/destin-harbor/", "Destin Harbor area page"),
                (filter_href("/restaurants/", [("area", "destin-harbor"), ("cuisine", "Seafood")]), "Destin Harbor seafood"),
            ],
            list_name="Destin Harbor restaurants",
        ),
        guide_spec(
            "miramar-beach-restaurants",
            "Miramar Beach restaurants",
            "Miramar Beach restaurants | Eating in Destin",
            (
                "Miramar Beach restaurants in Destin, Florida, along Scenic Gulf Drive, "
                "Silver Sands, and US 98, with the directory and a map."
            ),
            "Miramar Beach",
            [
                "Miramar Beach is the gulf side of this stretch: Scenic Gulf Drive, Silver Sands, and US 98. It’s its own area, next to Sandestin, not the resort itself.",
                f"You’ll find {human_list(miramar_bits)} along that stretch." if miramar_bits else "Open a restaurant for the meal before you drive over.",
                "Silver Sands is the easy lunch if you’re already at the outlets, and a separate trip if you’re coming from the sand. Open a restaurant for the address before you assume it’s on Scenic Gulf Drive.",
                "This is the full Miramar Beach list, the same restaurants as the area page. Use the directory or the map when you want breakfast, seafood, or dinner on their own.",
            ],
            miramar,
            miramar_href,
            miramar_map,
            [
                faq_item(
                    "Is Miramar Beach the same as Sandestin?",
                    "No. Miramar Beach is its own area, along Scenic Gulf Drive, Silver Sands, and US 98. Sandestin is the resort next door.",
                    "/areas/sandestin/",
                    "Open Sandestin",
                ),
                faq_item(
                    "What can I eat in Miramar Beach?",
                    f"You’ll find {human_list(miramar_bits)}." if miramar_bits else "Open the directory with Miramar Beach selected.",
                    miramar_href,
                    "See Miramar Beach in the directory",
                ),
                faq_item(
                    "How do I map Miramar Beach?",
                    "Open the map with Miramar Beach selected. It draws the restaurants in this area.",
                    miramar_map,
                    "Open the Miramar Beach map",
                ),
            ],
            "Miramar Beach",
            "Scenic Gulf Drive, Silver Sands, and US 98.",
            guide_cover("miramar-beach-restaurants", restaurants, areas),
            "Restaurants in Miramar Beach, near Destin.",
            extra=[("/areas/miramar-beach/", "Miramar Beach area page")],
            list_name="Miramar Beach restaurants",
        ),
        guide_spec(
            "waterfront-destin",
            "Waterfront dining in Destin",
            "Waterfront dining in Destin | Eating in Destin",
            (
                "Outdoor dining by the harbor, Sandestin, and Crystal Beach in Destin, Florida. "
                "A patio here is not a promise of a water view."
            ),
            "Outdoors",
            [
                "The boats are at Destin Harbor. HarborWalk is the boardwalk on that harbor. Sandestin adds Baytowne Wharf, the marina, and the gulf-front hotels. Crystal Beach is the Scenic 98 stretch by Henderson Beach.",
                "These listings don’t score a table as on the water. They do mark outdoor seating. This page is outdoor dining in those three areas. A harbor patio, a wharf table, a gulf-front dining room, or a sidewalk seat can all land here. If you need the docks, start with Destin Harbor. A patio is not a promise of a view.",
                "Miramar Beach has restaurants along Scenic Gulf Drive. They’re on the Miramar Beach guide. Outdoor seating there isn’t on this page, and neither are the patios at Destin Commons or Grand Boulevard.",
                "Open a restaurant for the address. The directory and the map show outdoor seating one area at a time. For every outdoor seat in town, including the shopping centers, use the full outdoor list.",
            ],
            water,
            harbor_outdoor,
            harbor_outdoor_map,
            [
                faq_item(
                    "Is every restaurant here on the water?",
                    "No. Outdoor seating is what the listings record. A table can face the harbor, the bay, the gulf, or a sidewalk.",
                    harbor_outdoor,
                    "Show outdoor seating at Destin Harbor",
                ),
                faq_item(
                    "Where do I start for the boats?",
                    "Destin Harbor, on the HarborWalk boardwalk. Open outdoor seating there in the directory or on the map.",
                    harbor_outdoor_map,
                    "Map outdoor seating at Destin Harbor",
                ),
                faq_item(
                    "Does outdoor seating mean a gulf view?",
                    "No. Crystal Beach is the Scenic 98 stretch by Henderson Beach, and Sandestin includes the gulf-front hotels, but outdoor seating is not a view rating. Open the restaurant and read the address.",
                    "/guides/destin-harbor-restaurants/",
                    "Open the Destin Harbor guide",
                ),
            ],
            "Outdoors",
            "Outdoor seating at the harbor, in Sandestin, and at Crystal Beach. A patio is not a view.",
            guide_cover("waterfront-destin", restaurants, areas),
            "Outdoor dining at Destin Harbor, Sandestin, and Crystal Beach. Not a waterfront rating.",
            extra=[
                (filter_href("/restaurants/", [("area", "sandestin"), ("outdoor", "yes")]), "Sandestin outdoors"),
                (filter_href("/map/", [("area", "sandestin"), ("outdoor", "yes")]), "Map Sandestin outdoors"),
                (filter_href("/restaurants/", [("area", "crystal-beach"), ("outdoor", "yes")]), "Crystal Beach outdoors"),
                (filter_href("/map/", [("area", "crystal-beach"), ("outdoor", "yes")]), "Map Crystal Beach outdoors"),
                ("/restaurants/?outdoor=yes", "Every outdoor seat"),
            ],
            extra_label="Outdoor seating",
            directory_label="Destin Harbor outdoors",
            map_label="Map Destin Harbor outdoors",
            list_name="Outdoor dining near the water in Destin",
        ),
        guide_spec(
            "laurens-favorites-destin",
            "Lauren’s Favorites in Destin",
            "Lauren’s Favorites in Destin | Eating in Destin",
            (
                "Lauren’s Favorites in Destin and Miramar Beach, Florida, a short list across the coast, "
                "with the directory and a map of those restaurants."
            ),
            "Favorites",
            [
                "When you don’t want to sort the whole coast, start with Lauren’s Favorites. It’s her short list for Destin and Miramar Beach, not a ranking of every good meal.",
                f"You’ll find them in {human_list(fav_areas)}. {fav_food} {fav_family}",
                "Hours are on the restaurant page. If you want more in the same area, open that area after you’ve looked at Lauren’s pick.",
            ],
            favorites,
            favorites_href,
            favorites_map,
            [
                faq_item(
                    "Where are Lauren’s Favorites?",
                    f"They’re in {human_list(fav_areas)}.",
                    favorites_href,
                    "See them in the directory",
                ),
                faq_item(
                    "Are Lauren’s Favorites all seafood?",
                    fav_food_faq,
                    favorites_href,
                    "Show Lauren’s Favorites",
                ),
                faq_item(
                    "Are Lauren’s Favorites kid friendly?",
                    fav_family_faq,
                    filter_href("/restaurants/", [("laurens", "yes"), ("kids", "yes")]),
                    "Show kid-friendly favorites",
                ),
            ],
            "Favorites",
            "Lauren’s short list for Destin and Miramar Beach.",
            guide_cover("laurens-favorites-destin", restaurants, areas),
            "Restaurants marked Lauren’s Favorites in Destin and Miramar Beach.",
            list_name="Lauren’s Favorites in Destin",
        ),
    ]
    covers = [spec["teaser_image"] for spec in specs]
    if len(covers) != len(set(covers)):
        raise SystemExit(f"guide covers are not unique: {covers}")
    for spec in specs:
        check_meta(spec["title"], spec["description"])
        if not 2 <= len(spec["faqs"]) <= 4:
            raise SystemExit(f"{spec['slug']} needs 2 to 4 FAQ questions, got {len(spec['faqs'])}")
        guard_prose(spec, restaurants)
        if "/images/restaurants/" in spec["teaser_image"]:
            cover_slug = spec["teaser_image"].split("/images/restaurants/", 1)[1].split("/", 1)[0]
            picked = {restaurant["slug"] for restaurant in spec["restaurants"]}
            if cover_slug not in picked:
                raise SystemExit(f"{spec['slug']} cover {cover_slug} is not on that guide")
    return specs


def guide_teaser(spec: dict) -> str:
    import build

    count = len(spec["restaurants"])
    meta = f"{count} {build.restaurant_count_word(count)}"
    return (
        f'<a class="card" href="{build.e(spec["path"])}">'
        f'<div class="card-media"><img src="{build.e(spec["teaser_image"])}" alt="{build.e(spec["teaser_alt"])}" loading="lazy"></div>'
        f'<div class="card-body"><p class="card-area">{build.e(spec["teaser_area"])}</p>'
        f"<h2>{build.e(spec['h1'])}</h2>"
        f'<p class="meta">{build.e(meta)}</p>'
        f'<p class="note">{build.e(spec["teaser_note"])}</p></div></a>'
    )


def write_guide_page(spec: dict) -> None:
    import build

    cards = "".join(build.card(restaurant) for restaurant in spec["restaurants"])
    extra = ""
    if spec["extra"]:
        extra = (
            f'<nav class="section-links" aria-label="{build.e(spec["extra_label"])}">'
            + "".join(text_link(href, label) for href, label in spec["extra"])
            + "</nav>"
        )
    body = (
        '<article class="profile">'
        '<div class="profile-hero">'
        f'<img src="{build.e(spec["teaser_image"])}" alt="{build.e(spec["teaser_alt"])}" loading="eager">'
        "</div>"
        '<div class="wrap page-intro">'
        + build.crumb_nav([("Home", "/"), ("Guides", "/guides/"), (spec["h1"], spec["path"])])
        + f'<p class="kicker">{build.e(spec["kicker"])}</p>'
        f'<h1 class="guide-title">{build.e(spec["h1"])}</h1>'
        + "".join(f'<p class="lede">{build.e(paragraph)}</p>' for paragraph in spec["paragraphs"])
        + f'<p class="action-row"><a class="button" href="{build.e(spec["directory_href"])}">{build.e(spec["directory_label"])}</a> '
        f'<a class="button secondary" href="{build.e(spec["map_href"])}">{build.e(spec["map_label"])}</a></p>'
        f"{extra}"
        f'<div class="card-grid">{cards}</div>'
        f"{faq_html(spec['faqs'])}"
        "</div></article>"
    )
    build.write(
        build.ROOT / "guides" / spec["slug"] / "index.html",
        build.layout(
            spec["title"],
            spec["description"],
            spec["path"],
            "guides",
            body,
            build.json_ld(
                build.graph(
                    {
                        "@type": "CollectionPage",
                        "name": spec["h1"],
                        "headline": spec["h1"],
                        "url": build.ORIGIN + spec["path"],
                        "description": spec["description"],
                        "isPartOf": {"@id": build.ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": spec["list_name"],
                        "numberOfItems": len(spec["restaurants"]),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": restaurant["name"],
                                "url": f"{build.ORIGIN}/restaurants/{restaurant['slug']}/",
                            }
                            for index, restaurant in enumerate(spec["restaurants"], start=1)
                        ],
                    },
                    faq_nodes(spec["faqs"]),
                    build.breadcrumbs([("Home", "/"), ("Guides", "/guides/"), (spec["h1"], spec["path"])]),
                )
            ),
            image=spec["teaser_image"],
            image_alt=spec["teaser_alt"],
        ),
    )


def build_guides(restaurants: list[dict], areas: list[dict]) -> list[dict]:
    import build

    check_meta(GUIDES_INDEX_TITLE, GUIDES_INDEX_DESCRIPTION)
    guide_dir = build.ROOT / "guides"
    if guide_dir.exists():
        shutil.rmtree(guide_dir)
    specs = guide_picks(restaurants, areas)
    for spec in specs:
        write_guide_page(spec)
    teasers = "".join(guide_teaser(spec) for spec in specs)
    index_body = (
        '<div class="wrap page-intro">'
        + build.crumb_nav([("Home", "/"), ("Guides", "/guides/")])
        + '<p class="kicker">For the trip</p>'
        "<h1>Guides for Destin</h1>"
        f'<div class="card-grid">{teasers}</div></div>'
    )
    build.write(
        build.ROOT / "guides" / "index.html",
        build.layout(
            GUIDES_INDEX_TITLE,
            GUIDES_INDEX_DESCRIPTION,
            "/guides/",
            "guides",
            index_body,
            build.json_ld(
                build.graph(
                    {
                        "@type": "CollectionPage",
                        "name": "Guides for Destin",
                        "url": build.ORIGIN + "/guides/",
                        "description": GUIDES_INDEX_DESCRIPTION,
                        "isPartOf": {"@id": build.ORIGIN + "/#website"},
                    },
                    {
                        "@type": "ItemList",
                        "name": "Guides",
                        "numberOfItems": len(specs),
                        "itemListElement": [
                            {
                                "@type": "ListItem",
                                "position": index,
                                "name": spec["h1"],
                                "url": build.ORIGIN + spec["path"],
                            }
                            for index, spec in enumerate(specs, start=1)
                        ],
                    },
                    build.breadcrumbs([("Home", "/"), ("Guides", "/guides/")]),
                )
            ),
            image=build.HERO_IMAGE,
            image_alt=build.HERO_ALT,
        ),
    )
    return specs
