import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { describeFilters, featuredIndex, filtersFromParams, framePins, inGuideFrame, mapListCard, markerPopup, matches, monogram, spreadOverlaps, stepFeatured } from "../site.js";

const restaurants = JSON.parse(readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8"));

const blank = { meal: "", area: "", cuisine: "", q: "", outdoor: "", kids: "", music: "" };

test("empty filters keep the full directory", () => {
  assert.equal(restaurants.filter((item) => matches(item, blank)).length, restaurants.length);
  assert.equal(restaurants.length, 203);
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
  assert.doesNotMatch(html, /popup-photo/);
  assert.match(html, /href="\/restaurants\/harbor-docks-destin-harbor\/"/);
  assert.match(html, />View restaurant</);
  assert.doesNotMatch(html, /View profile|https?:\/\//);
});

test("map list cards stay compact", () => {
  assert.equal(monogram("Harbor Docks"), "HD");
  assert.equal(monogram("The Back Porch"), "BP");
  assert.equal(monogram("Beach Walk Cafe"), "BW");
  const harbor = restaurants.find((item) => item.slug === "harbor-docks-destin-harbor");
  const mark = mapListCard(harbor);
  assert.match(mark, /class="map-thumb ph"/);
  assert.match(mark, /aria-hidden="true">HD</);
  assert.match(mark, /<strong>Harbor Docks<\/strong>/);
  assert.match(mark, /class="map-meta">Destin Harbor · \$\$/);
  assert.match(mark, /class="map-address">538 Harbor Blvd/);
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

test("filter label names the town", () => {
  const label = describeFilters(
    { ...blank, meal: "Breakfast", area: "destin-harbor" },
    { "destin-harbor": "Destin Harbor" }
  );
  assert.equal(label, "Breakfast in Destin Harbor");
  assert.equal(describeFilters(blank, {}), "Where to eat");
  assert.equal(describeFilters(blank, {}, "Along the coast"), "Along the coast");
});

test("public json does not carry place ids or owner ids", () => {
  const raw = readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8");
  assert.equal(raw.includes("googlePlaceId"), false);
  assert.equal(raw.includes("ChIJ"), false);
});
