import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { FEATURED_ROTATE_MS, describeFilters, featuredIndex, featuredStatusForStep, filtersAreBlank, filtersFromParams, framePins, inGuideFrame, mapListCard, markerPopup, matches, monogram, shouldAutoRotateFeatured, spreadOverlaps, stepFeatured } from "../site.js";

const restaurants = JSON.parse(readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8"));

const blank = { meal: "", area: "", cuisine: "", q: "", outdoor: "", kids: "", music: "", laurens: "" };

test("empty filters keep the full directory", () => {
  assert.equal(restaurants.filter((item) => matches(item, blank)).length, restaurants.length);
  assert.equal(restaurants.length, 215);
});

test("homepage meal and town query strings filter the directory", () => {
  const dinner = filtersFromParams(new URLSearchParams("meal=Dinner"));
  const dinnerRows = restaurants.filter((item) => matches(item, { ...blank, ...dinner }));
  assert.ok(dinnerRows.length > 0);
  assert.ok(dinnerRows.every((item) => item.meals.includes("Dinner")));
  assert.ok(dinnerRows.length < restaurants.length);

  const harbor = filtersFromParams(new URLSearchParams("area=destin-harbor"));
  const harborRows = restaurants.filter((item) => matches(item, { ...blank, ...harbor }));
  assert.ok(harborRows.length > 0);
  assert.ok(harborRows.every((item) => item.areaSlug === "destin-harbor"));

  const both = filtersFromParams(new URLSearchParams("meal=Dinner&area=destin-harbor"));
  const bothRows = restaurants.filter((item) => matches(item, { ...blank, ...both }));
  assert.ok(bothRows.length > 0);
  assert.ok(bothRows.every((item) => item.areaSlug === "destin-harbor" && item.meals.includes("Dinner")));
  assert.ok(bothRows.length < harborRows.length || bothRows.length < dinnerRows.length);
});

test("cuisine and search are case insensitive and exact for cuisine", () => {
  const oyster = restaurants.filter((item) => matches(item, { ...blank, q: "OYSTER" }));
  assert.ok(oyster.length > 0);
  const italian = restaurants.filter((item) => matches(item, { ...blank, cuisine: "italian" }));
  assert.ok(italian.length > 0);
  assert.ok(italian.every((item) => item.cuisines.some((cuisine) => cuisine.toLowerCase() === "italian")));
  const miss = restaurants.filter((item) => matches(item, { ...blank, cuisine: "not-a-cuisine" }));
  assert.equal(miss.length, 0);
});

test("amenity filters require a yes flag", () => {
  const outdoor = restaurants.filter((item) => matches(item, { ...blank, outdoor: "yes" }));
  assert.ok(outdoor.length > 0);
  assert.ok(outdoor.every((item) => item.outdoor));
  assert.ok(outdoor.length < restaurants.length);
});

test("Lauren's Favorites shows only the tagged restaurants", () => {
  const favorites = restaurants.filter((item) => matches(item, { ...blank, laurens: "yes" }));
  assert.deepEqual(
    favorites.map((item) => item.name).sort(),
    [
      "McGuire's Irish Pub",
      "Ruth's Chris Steak House",
      "Seagar's Prime Steaks & Seafood",
      "The Crab Trap Destin",
      "The Melting Pot",
    ]
  );
  assert.equal(restaurants.filter((item) => item.laurensFavorite).length, favorites.length);
  assert.ok(favorites.every((item) => item.laurensFavorite === true));
  const sandestin = restaurants.filter((item) => matches(item, { ...blank, laurens: "yes", area: "sandestin" }));
  assert.deepEqual(sandestin.map((item) => item.slug), ["seagar-s-prime-steaks-and-seafood-sandestin"]);
  const fromUrl = filtersFromParams(new URLSearchParams("laurens=yes"));
  assert.equal(fromUrl.laurens, "yes");
  assert.equal(describeFilters({ ...blank, laurens: "yes" }, {}), "Lauren's Favorites");
});

test("every restaurant with coordinates gets its own map pin", () => {
  assert.equal(restaurants.every((item) => typeof item.lat === "number" && typeof item.lng === "number"), true);
  assert.equal(restaurants.every((item) => item.address), true);
  const placed = spreadOverlaps(restaurants);
  assert.equal(placed.length, restaurants.length);
  assert.equal(new Set(placed.map((item) => item.slug)).size, restaurants.length);
});

test("map popups show the name, address, and profile", () => {
  const harbor = restaurants.find((item) => item.slug === "harbor-docks-destin-harbor");
  const html = markerPopup(harbor);
  assert.match(html, /Harbor Docks/);
  assert.match(html, /538 Harbor Blvd/);
  assert.match(html, /class="popup-address"/);
  assert.match(html, /class="popup-photo"/);
  assert.match(html, /\/images\/restaurants\/harbor-docks-destin-harbor\/01\.jpg/);
  assert.match(html, /href="\/restaurants\/harbor-docks-destin-harbor\/"/);
  assert.match(html, />View restaurant</);
  assert.doesNotMatch(html, /View profile|https?:\/\//);

  const plain = restaurants.find((item) => item.slug === "sundries-general-market-sandestin");
  const plainHtml = markerPopup(plain);
  assert.match(plainHtml, /Sundries General Market/);
  assert.match(plainHtml, /class="popup-address"/);
  assert.doesNotMatch(plainHtml, /popup-photo/);
});

test("map list cards stay compact", () => {
  assert.equal(monogram("Harbor Docks"), "HD");
  assert.equal(monogram("The Back Porch"), "BP");
  assert.equal(monogram("Beach Walk Cafe"), "BW");
  const harbor = restaurants.find((item) => item.slug === "harbor-docks-destin-harbor");
  const photo = mapListCard(harbor);
  assert.match(photo, /class="map-thumb"/);
  assert.match(photo, /harbor-docks-destin-harbor\/01\.jpg/);
  assert.match(photo, /<strong>Harbor Docks<\/strong>/);
  assert.match(photo, /class="map-meta">Destin Harbor · \$\$/);
  assert.match(photo, /class="map-address">538 Harbor Blvd/);
  assert.doesNotMatch(photo, /class="map-thumb ph"/);
  const plain = restaurants.find((item) => item.slug === "sundries-general-market-sandestin");
  const mark = mapListCard(plain);
  assert.match(mark, /class="map-thumb ph"/);
  assert.match(mark, /aria-hidden="true">SG</);
  assert.match(mark, /class="map-meta">Sandestin · \$</);
  assert.doesNotMatch(mark, /<img/);
});

test("the opening map frame stays on Destin when a geocode is outside the corridor", () => {
  assert.equal(inGuideFrame(30.393, -86.51), true);
  assert.equal(inGuideFrame(47.3, -122.5), false);
  const framed = framePins([
    { slug: "harbor", pinLat: 30.393, pinLng: -86.51 },
    { slug: "tacoma", pinLat: 47.3, pinLng: -122.5 },
  ]);
  assert.deepEqual(framed.map((item) => item.slug), ["harbor"]);
  const onlyOutlier = framePins([{ slug: "tacoma", pinLat: 47.3, pinLng: -122.5 }]);
  assert.deepEqual(onlyOutlier.map((item) => item.slug), ["tacoma"]);
});

test("stacked pins at the same coordinate are pulled apart", () => {
  const placed = spreadOverlaps([
    { slug: "a", lat: 30.35, lng: -86.25 },
    { slug: "b", lat: 30.35, lng: -86.25 },
  ]);
  assert.equal(placed.length, 2);
  assert.notEqual(placed[0].pinLat, placed[1].pinLat);
});

test("featured cover rotates once per UTC day", () => {
  assert.equal(featuredIndex(4, 0), 0);
  assert.equal(featuredIndex(4, 86400000), 1);
  assert.equal(featuredIndex(4, 86400000 * 5 + 3600000), 1);
  assert.equal(featuredIndex(4, Date.UTC(2026, 8, 29, 0, 30)), featuredIndex(4, Date.UTC(2026, 8, 29, 23, 30)));
  assert.notEqual(featuredIndex(4, Date.UTC(2026, 8, 29)), featuredIndex(4, Date.UTC(2026, 8, 30)));
  assert.equal(featuredIndex(1, 86400000 * 9), 0);
  assert.equal(featuredIndex(0, 86400000), 0);
});

test("featured arrows cycle every listing and wrap", () => {
  assert.equal(stepFeatured(0, 1, 4), 1);
  assert.equal(stepFeatured(3, 1, 4), 0);
  assert.equal(stepFeatured(0, -1, 4), 3);
  assert.equal(stepFeatured(2, -1, 4), 1);
  assert.equal(stepFeatured(featuredIndex(4, Date.UTC(2026, 8, 29)), 1, 4), stepFeatured(featuredIndex(4, Date.UTC(2026, 8, 29, 18)), 1, 4));
  assert.equal(stepFeatured(1, 0, 4), 1);
  assert.equal(stepFeatured(0, 1, 0), 0);
});

test("featured auto-rotate waits eight seconds unless someone is using the cover", () => {
  assert.equal(FEATURED_ROTATE_MS, 8000);
  const running = { reducedMotion: false, hovering: false, focused: false, hidden: false, count: 3 };
  assert.equal(shouldAutoRotateFeatured(running), true);
  assert.equal(shouldAutoRotateFeatured({ ...running, reducedMotion: true }), false);
  assert.equal(shouldAutoRotateFeatured({ ...running, hovering: true }), false);
  assert.equal(shouldAutoRotateFeatured({ ...running, focused: true }), false);
  assert.equal(shouldAutoRotateFeatured({ ...running, hidden: true }), false);
  assert.equal(shouldAutoRotateFeatured({ ...running, count: 1 }), false);
  assert.equal(shouldAutoRotateFeatured({ ...running, count: 0 }), false);
  assert.equal(shouldAutoRotateFeatured(), false);
});

test("featured status is announced only for a user step", () => {
  assert.equal(featuredStatusForStep("Harbor Docks", 0, 3), null);
  assert.equal(featuredStatusForStep("Harbor Docks", 0, 3, { announce: false }), null);
  assert.equal(featuredStatusForStep("The Back Porch", 1, 3, { announce: true }), "The Back Porch, 2 of 3");
  assert.equal(featuredStatusForStep("  ", 2, 3, { announce: true }), "");
});

test("filter label names the town", () => {
  const label = describeFilters(
    { ...blank, meal: "Breakfast", area: "destin-harbor" },
    { "destin-harbor": "Destin Harbor" }
  );
  assert.equal(label, "Breakfast in Destin Harbor");
  assert.equal(describeFilters(blank, {}), "Restaurants in Destin");
  assert.equal(
    describeFilters({ ...blank, area: "destin-harbor" }, { "destin-harbor": "Destin Harbor" }),
    "Restaurants in Destin Harbor",
  );
  assert.equal(
    describeFilters({ ...blank, area: "miramar-beach" }, { "miramar-beach": "Miramar Beach" }, "Around Destin"),
    "Around Miramar Beach",
  );
  assert.equal(describeFilters(blank, {}, "Along the coast"), "Along the coast");
  assert.equal(filtersAreBlank(blank), true);
  assert.equal(filtersAreBlank({ ...blank, q: "oysters" }), false);
});

test("public json does not carry place ids or owner ids", () => {
  const raw = readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8");
  assert.equal(raw.includes("googlePlaceId"), false);
  assert.equal(raw.includes("ChIJ"), false);
});
