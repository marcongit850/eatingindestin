import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANONICAL_HOST, canonicalRedirect } from "../worker.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const config = JSON.parse(readFileSync(join(root, "site.config.json"), "utf8"));
const ORIGIN = config.origin.replace(/\/$/, "");

function read(rel) {
  return readFileSync(join(root, rel), "utf8");
}

function decode(value) {
  return value
    .replaceAll("&amp;", "&")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&#x27;", "'");
}

function attr(html, pattern) {
  const match = html.match(pattern);
  assert.ok(match, pattern.toString());
  return decode(match[1]);
}

function jsonLd(html) {
  const blocks = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
  assert.equal(blocks.length, 1, "expected one JSON-LD block");
  return JSON.parse(blocks[0][1]);
}

function typesOf(node) {
  const value = node["@type"];
  return Array.isArray(value) ? value : [value];
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".git" || name === "vendor" || name === ".wrangler") continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const htmlPages = walk(root).filter((path) => path.endsWith(".html") && !path.includes(`${join(root, "includes")}`));
const titles = new Set();
const descriptions = new Set();

for (const path of htmlPages) {
  const html = readFileSync(path, "utf8");
  const rel = path.slice(root.length);
  const title = attr(html, /<title>([^<]+)<\/title>/);
  const description = attr(html, /<meta name="description" content="([^"]+)">/);
  assert.equal(titles.has(title), false, "duplicate title " + title);
  assert.equal(descriptions.has(description), false, "duplicate description " + description);
  titles.add(title);
  descriptions.add(description);
  assert.ok(title.length >= 20 && title.length <= 70, rel + " title length " + title.length + " " + title);
  assert.ok(description.length >= 110 && description.length <= 165, rel + " description length " + description.length);
  assert.match(description, /Destin/);
  const canonical = attr(html, /<link rel="canonical" href="([^"]+)">/);
  assert.ok(canonical.startsWith(ORIGIN), rel + " canonical " + canonical);
  assert.equal(canonical.startsWith(`https://${CANONICAL_HOST}`), true, rel);
  assert.equal(canonical.includes("workers.dev"), false, rel);
  assert.equal(attr(html, /<meta property="og:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta property="og:description" content="([^"]+)">/), description);
  assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), canonical);
  assert.equal(attr(html, /<meta property="og:site_name" content="([^"]+)">/), "Eating in Destin");
  assert.equal(attr(html, /<meta property="og:locale" content="([^"]+)">/), "en_US");
  assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), "website");
  const image = attr(html, /<meta property="og:image" content="([^"]+)">/);
  assert.ok(image.startsWith("https://"), rel);
  assert.equal(attr(html, /<meta name="twitter:card" content="([^"]+)">/), "summary_large_image");
  assert.equal(attr(html, /<meta name="twitter:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta name="twitter:description" content="([^"]+)">/), description);
  assert.equal(attr(html, /<meta name="twitter:image" content="([^"]+)">/), image);
  const imageAlt = attr(html, /<meta property="og:image:alt" content="([^"]+)">/);
  assert.ok(imageAlt.length > 10, rel);
  assert.equal(attr(html, /<meta name="twitter:image:alt" content="([^"]+)">/), imageAlt);
  assert.ok(attr(html, /<meta property="og:image:width" content="([^"]+)">/));
  const data = jsonLd(html);
  assert.equal(data["@context"], "https://schema.org");
  const h1s = html.match(/<h1[\s>]/g) || [];
  assert.equal(h1s.length, 1, rel + " h1 count");
}

const home = jsonLd(read("index.html"));
assert.deepEqual(home["@graph"].map((node) => node["@type"]), ["Organization", "WebSite", "ItemList"]);
assert.equal(home["@graph"][1].publisher["@id"], `${ORIGIN}/#organization`);

const directory = jsonLd(read("restaurants/index.html"));
const list = directory["@graph"].find((node) => node["@type"] === "ItemList");
assert.equal(list.numberOfItems, 215);
assert.equal(directory["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);

const profile = jsonLd(read("restaurants/harbor-docks-destin-harbor/index.html"));
const restaurant = profile["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.ok(typesOf(restaurant).includes("LocalBusiness"));
assert.equal(restaurant.name, "Harbor Docks");
assert.equal(restaurant.url, `${ORIGIN}/restaurants/harbor-docks-destin-harbor/`);
assert.equal(restaurant.address.addressCountry, "US");
assert.ok(restaurant.address.streetAddress);
assert.equal(restaurant.containedInPlace.name, "Destin Harbor");
assert.equal(restaurant.containedInPlace.url, `${ORIGIN}/areas/destin-harbor/`);
assert.ok(restaurant.servesCuisine.includes("Seafood"));
assert.ok(restaurant.openingHours.includes("Mo 11:00-22:30"));
assert.equal(typeof restaurant.geo.latitude, "number");
assert.equal(typeof restaurant.geo.longitude, "number");
assert.ok(restaurant.telephone);
assert.equal(profile["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);
assert.equal(profile["@graph"].find((node) => node["@type"] === "BreadcrumbList").itemListElement[2].name, "Destin Harbor");
assert.match(restaurant.image, /\/images\/restaurants\/harbor-docks-destin-harbor\/01\.jpg$/);
assert.equal(restaurant.acceptsReservations, true);
assert.equal(restaurant.aggregateRating, undefined);
assert.equal(restaurant.review, undefined);
assert.match(restaurant.description, /Harbor Docks/);
assert.match(restaurant.description, /\bDestin\b/);

const harborHtml = read("restaurants/harbor-docks-destin-harbor/index.html");
assert.match(harborHtml, /<h1>Harbor Docks<\/h1>/);
assert.equal(/h1-place|Related guides|Other locations/.test(harborHtml), false);
assert.match(harborHtml, /Harbor Docks is a casual bar and restaurant in Destin Harbor/);
assert.match(harborHtml, /The address is 538 Harbor Blvd/);
assert.match(harborHtml, /Also in Destin Harbor/);
assert.match(harborHtml, /href="\/areas\/destin-harbor\/"/);
assert.match(attr(harborHtml, /<title>([^<]+)<\/title>/), /Harbor Docks/);
assert.match(attr(harborHtml, /<title>([^<]+)<\/title>/), /Destin Harbor/);

const seaLevel = jsonLd(read("restaurants/sea-level-crystal-beach/index.html"));
const seaLevelRestaurant = seaLevel["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.equal(seaLevelRestaurant.acceptsReservations, undefined);
assert.equal(seaLevelRestaurant.openingHours, undefined);
assert.equal(seaLevelRestaurant.aggregateRating, undefined);
assert.ok(seaLevelRestaurant.telephone);
assert.ok(seaLevelRestaurant.address.streetAddress);
const seaLevelHtml = read("restaurants/sea-level-crystal-beach/index.html");
assert.match(seaLevelHtml, /<h1>Sea Level<\/h1>/);
assert.equal(/h1-place|Related guides|Other locations/.test(seaLevelHtml), false);

const profilePages = walk(join(root, "restaurants")).filter(
  (path) => path.endsWith(`${join("index.html")}`) && !path.endsWith(`${join("restaurants", "index.html")}`),
);
assert.equal(profilePages.length, 215);
for (const path of profilePages) {
  const data = jsonLd(readFileSync(path, "utf8"));
  const listing = data["@graph"].find((node) => typesOf(node).includes("Restaurant"));
  assert.ok(listing, path);
  assert.ok(typesOf(listing).includes("LocalBusiness"), path);
  assert.ok(listing.name, path);
  assert.ok(listing.url.startsWith(`${ORIGIN}/restaurants/`), path);
  assert.ok(listing.address.streetAddress, path);
  assert.ok(listing.address.addressLocality, path);
  assert.equal(listing.address.addressCountry, "US");
  assert.ok(listing.servesCuisine.length, path);
  assert.ok(listing.containedInPlace.name, path);
  assert.ok(listing.containedInPlace.url.includes("/areas/"), path);
}

for (const path of walk(join(root, "areas")).filter((entry) => entry.endsWith(".html"))) {
  const html = readFileSync(path, "utf8");
  if (path.endsWith(`${join("areas", "index.html")}`)) {
    assert.match(html, /<h1>Restaurant areas in Destin<\/h1>/);
  } else {
    assert.match(html, /<h1>Restaurants in [^<]+<\/h1>/);
    assert.match(html, /Find restaurants and food in /);
  }
}

const sundries = jsonLd(read("restaurants/sundries-general-market-sandestin/index.html"));
const sundriesRestaurant = sundries["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.equal(JSON.stringify(sundriesRestaurant).includes('"image"'), false);

const town = jsonLd(read("areas/destin-harbor/index.html"));
assert.equal(town["@graph"].some((node) => node["@type"] === "ItemList"), true);
assert.equal(town["@graph"].some((node) => node["@type"] === "BreadcrumbList"), true);

const missing = read("404.html");
assert.match(missing, /noindex/);
assert.equal(read("index.html").includes("noindex"), false);

const robots = read("robots.txt");
assert.match(robots, /User-agent: \*\nAllow: \/\n/);
assert.equal(robots.includes("Disallow"), false);
assert.match(robots, new RegExp(`Sitemap: ${ORIGIN.replaceAll(".", "\\.")}/sitemap\\.xml`));
assert.match(robots, new RegExp(`${ORIGIN.replaceAll(".", "\\.")}/llms\\.txt`));
assert.match(robots, new RegExp(`${ORIGIN.replaceAll(".", "\\.")}/llms-full\\.txt`));
for (const agent of [
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
]) {
  assert.match(robots, new RegExp(`User-agent: ${agent}\\nAllow: /\\n`), agent);
}

const sitemap = read("sitemap.xml");
const locs = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((match) => match[1]);
assert.equal(locs.includes(`${ORIGIN}/`), true);
assert.equal(locs.includes(`${ORIGIN}/restaurants/`), true);
assert.equal(locs.includes(`${ORIGIN}/restaurants/harbor-docks-destin-harbor/`), true);
assert.equal(locs.includes(`${ORIGIN}/404.html`), false);
assert.equal(locs.includes(`${ORIGIN}/guides/`), true);
assert.equal(locs.includes(`${ORIGIN}/guides/best-seafood-destin/`), true);
assert.equal(locs.length, 7 + 14 + 7 + 215);

const llms = read("llms.txt");
const llmsFull = read("llms-full.txt");
assert.ok(llmsFull.length > llms.length);
for (const url of [`${ORIGIN}/`, `${ORIGIN}/restaurants/`, `${ORIGIN}/map/`, `${ORIGIN}/areas/`, `${ORIGIN}/about/`, `${ORIGIN}/contact/`, `${ORIGIN}/sitemap.xml`, `${ORIGIN}/restaurants/harbor-docks-destin-harbor/`]) {
  assert.ok(llms.includes(url), "llms.txt missing " + url);
  assert.ok(llmsFull.includes(url), "llms-full.txt missing " + url);
}
assert.equal(llms.includes("<"), false);
assert.equal(llmsFull.includes("<"), false);
assert.match(llms, /Search by restaurant name/);
assert.match(llms, /Miramar Beach/);

const apex = canonicalRedirect(new URL("https://eatingindestin.com/restaurants/harbor-docks-destin-harbor/?q=1"), "GET");
assert.equal(apex.status, 301);
assert.equal(apex.location, `${ORIGIN}/restaurants/harbor-docks-destin-harbor/?q=1`);
const preview = canonicalRedirect(new URL("https://eatingindestin.352marc.workers.dev/map/"), "HEAD");
assert.equal(preview.status, 301);
assert.equal(preview.location, `${ORIGIN}/map/`);
assert.equal(canonicalRedirect(new URL(`${ORIGIN}/`), "GET"), null);
assert.equal(canonicalRedirect(new URL("https://eatingindestin.com/api/listing"), "POST"), null);
assert.equal(canonicalRedirect(new URL("https://eatingindestin.com/restaurants/"), "POST").status, 308);
assert.equal(config.origin.replace(/\/$/, ""), `https://${CANONICAL_HOST}`);

for (const path of walk(root)) {
  if (!path.endsWith(".html") && path !== join(root, "site.js")) continue;
  const html = readFileSync(path, "utf8");
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const alt = tag.match(/\salt="([^"]*)"/);
    assert.ok(alt, "missing alt " + path);
    assert.ok(alt[1].trim().length > 0, "empty alt " + path);
  }
}
