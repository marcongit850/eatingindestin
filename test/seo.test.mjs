import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import worker, {
  CANONICAL_HOST,
  ampersandRedirect,
  canonicalRedirect,
  legacyRedirect,
  locationRedirect,
  notFoundPathStatus,
  rejectSoftNotFound,
  removedRestaurantStatus,
  promoteSlashRedirect,
  sisterRedirect,
  stripMissingCanonical,
} from "../worker.js";
import { patchSitemap, renderProfile } from "../public-html.js";

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
const canonicals = new Set();
const EXACT_DESCRIPTIONS = new Set([
  "Bricktop's in Miramar Beach at Grand Boulevard. Hours, reservations, location and photos before you go.",
  "Every restaurant at Baytowne Wharf in Sandestin, from casual bites to date night spots, with hours, menus and local picks.",
  "Every restaurant at Grand Boulevard Destin, including Bricktop's. Hours and maps.",
]);
const ROBOTS_INDEX = "index,follow,max-image-preview:large,max-snippet:-1,max-video-preview:-1";

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
  if (title.includes(" | Eating in Destin")) {
    assert.ok(title.length <= 60, rel + " brand suffix pushes the title over 60: " + title);
  }
  if (EXACT_DESCRIPTIONS.has(description)) {
    assert.ok(description.length <= 165, rel + " description length " + description.length);
    assert.equal(description.includes("\u2013") || description.includes("\u2014"), false, rel);
    assert.equal(title.includes("\u2013") || title.includes("\u2014"), false, rel);
  } else {
    assert.ok(description.length >= 110 && description.length <= 160, rel + " description length " + description.length);
    assert.match(description, /Destin/);
  }
  assert.equal(description.includes("\u2026"), false, rel + " description ellipsis");
  const isMissing = path.endsWith("404.html");
  assert.equal(attr(html, /<meta property="og:title" content="([^"]+)">/), title);
  assert.equal(attr(html, /<meta property="og:description" content="([^"]+)">/), description);
  if (isMissing) {
    assert.equal(html.includes('rel="canonical"'), false, rel);
    assert.equal(html.includes("404.html"), false, rel);
    assert.match(html, /<meta name="robots" content="noindex">/);
  } else {
    const canonical = attr(html, /<link rel="canonical" href="([^"]+)">/);
    assert.ok(canonical.startsWith(ORIGIN), rel + " canonical " + canonical);
    assert.equal(canonical.startsWith(`https://${CANONICAL_HOST}`), true, rel);
    assert.equal(canonical.includes("workers.dev"), false, rel);
    assert.equal(canonicals.has(canonical), false, "duplicate canonical " + canonical);
    canonicals.add(canonical);
    assert.equal(attr(html, /<meta property="og:url" content="([^"]+)">/), canonical);
  }
  assert.equal(attr(html, /<meta property="og:site_name" content="([^"]+)">/), "Eating in Destin");
  assert.equal(attr(html, /<meta property="og:locale" content="([^"]+)">/), "en_US");
  const listingPage = rel.includes(`${join("restaurants", "")}`) && !rel.endsWith(`${join("restaurants", "index.html")}`);
  assert.equal(attr(html, /<meta property="og:type" content="([^"]+)">/), listingPage ? "restaurant.restaurant" : "website");
  if (html.includes('content="noindex"')) {
    assert.equal(html.includes("max-image-preview"), false, rel);
  } else {
    assert.match(html, new RegExp(`<meta name="robots" content="${ROBOTS_INDEX}">`), rel);
  }
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
assert.equal(list.numberOfItems, 236);
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
assert.ok(Array.isArray(restaurant.openingHoursSpecification));
assert.ok(restaurant.openingHoursSpecification.some((slot) => slot.opens && slot.closes && slot.dayOfWeek));
assert.equal(restaurant.menu, undefined);
assert.equal(restaurant.hasMenu, undefined);
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
assert.match(harborHtml, /<dt>Address<\/dt><dd>538 Harbor Blvd/);
const harborStory = harborHtml.split('class="prose profile-story">')[1].split("</div>")[0];
assert.equal(harborStory.includes("The address is"), false);
assert.equal(harborStory.includes("Hours are on this page"), false);
assert.equal(harborStory.includes("on the listing"), false);
assert.equal((harborStory.match(/<p>/g) || []).length, 1);
assert.match(harborHtml, /Also in Destin Harbor/);
assert.match(harborHtml, /class="map-hit"/);
assert.match(harborHtml, />All restaurants in Destin Harbor<\/a>/);
assert.match(harborHtml, /class="listing-claim"/);
assert.equal(harborHtml.includes('class="card-grid"'), false);
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
assert.equal(profilePages.length, 236);
const seenProfiles = new Set();
for (const path of profilePages) {
  const html = readFileSync(path, "utf8");
  const data = jsonLd(html);
  const listing = data["@graph"].find((node) => typesOf(node).includes("Restaurant"));
  assert.ok(listing, path);
  assert.match(html, /<h1>/, path);
  assert.match(html, /<dt>Address<\/dt><dd>[^<]+/, path);
  assert.match(html, /<dt>Hours<\/dt><dd>/, path);
  const h1 = attr(html, /<h1>([^<]+)<\/h1>/);
  const address = attr(html, /<dt>Address<\/dt><dd>([^<]+)/);
  const story = (html.split('class="prose profile-story">')[1] || "").split("</div>")[0];
  const identity = `${h1}\n${address}\n${story}`;
  assert.equal(seenProfiles.has(identity), false, "near-identical restaurant page " + path);
  seenProfiles.add(identity);
  assert.equal(listing.url, attr(html, /<link rel="canonical" href="([^"]+)">/), path);
  assert.ok(typesOf(listing).includes("LocalBusiness"), path);
  assert.ok(listing.name, path);
  assert.ok(listing.url.startsWith(`${ORIGIN}/restaurants/`), path);
  assert.ok(listing.address.streetAddress, path);
  assert.ok(listing.address.addressLocality, path);
  assert.equal(listing.address.addressCountry, "US");
  assert.ok(listing.servesCuisine.length, path);
  assert.ok(listing.containedInPlace.name, path);
  assert.ok(listing.containedInPlace.url.includes("/areas/"), path);
  assert.equal(listing.menu, undefined, path);
  assert.equal(listing.hasMenu, undefined, path);
  if (listing.openingHours) assert.ok(listing.openingHoursSpecification.length, path);
  const org = data["@graph"].find((node) => node["@type"] === "Organization");
  const site = data["@graph"].find((node) => node["@type"] === "WebSite");
  assert.ok(org && org.logo && org.url, path);
  assert.equal(org.sameAs, undefined, path);
  assert.equal(site.potentialAction["@type"], "SearchAction", path);
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
assert.match(missing, /<meta name="robots" content="noindex">/);
assert.equal(missing.includes('rel="canonical"'), false);
assert.equal(missing.includes("404.html"), false);
assert.equal(missing.includes('property="og:url"'), false);
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
const liveSlugs = JSON.parse(read("data/restaurants.json")).map((item) => item.slug);
assert.equal(patchSitemap(sitemap, { liveSlugs }), sitemap);
const withoutHarbor = patchSitemap(sitemap, { liveSlugs: liveSlugs.filter((slug) => slug !== "harbor-docks-destin-harbor") });
assert.equal(withoutHarbor.includes("harbor-docks-destin-harbor"), false);
assert.equal(withoutHarbor.includes(`${ORIGIN}/areas/destin-harbor/`), true);
assert.equal(withoutHarbor.includes(`${ORIGIN}/restaurants/`), true);
const withAmp = sitemap.replace(
  "</urlset>",
  `  <url>\n    <loc>${ORIGIN}/restaurants/aj's-seafood-&amp;-oyster-bar/</loc>\n  </url>\n</urlset>`,
);
assert.equal(patchSitemap(withAmp, { liveSlugs }).includes("aj's-seafood-"), false);
assert.equal(patchSitemap(withAmp, { liveSlugs }).includes("aj-s-seafood-and-oyster-bar-destin-harbor"), true);
const legacyRedirects = JSON.parse(read("data/legacy-redirects.json"));
const removedSlugList = JSON.parse(read("data/removed-slugs.json"));
const removedSlugSet = new Set(removedSlugList);
for (const loc of locs) {
  assert.equal(loc.includes("&"), false, loc);
  assert.equal(loc.startsWith(`${ORIGIN}/`), true, loc);
  const path = loc.slice(ORIGIN.length);
  const file = path === "/" ? join(root, "index.html") : join(root, path.replace(/^\//, ""), "index.html");
  assert.equal(existsSync(file), true, "sitemap entry is not a live page " + loc);
  const canonical = attr(readFileSync(file, "utf8"), /<link rel="canonical" href="([^"]+)">/);
  assert.equal(canonical, loc, "sitemap canonical " + loc);
  if (loc.includes("/restaurants/") && !loc.endsWith("/restaurants/")) {
    const slug = loc.slice(loc.indexOf("/restaurants/") + "/restaurants/".length).replace(/\/$/, "");
    assert.equal(liveSlugs.includes(slug), true, loc);
    assert.equal(Object.hasOwn(legacyRedirects, slug), false, "sitemap lists a redirected slug " + slug);
    assert.equal(removedSlugSet.has(slug), false, "sitemap lists a removed slug " + slug);
  }
}
assert.equal(locs.includes(`${ORIGIN}/guides/`), true);
assert.equal(locs.includes(`${ORIGIN}/guides/best-seafood-destin/`), true);
assert.equal(locs.includes(`${ORIGIN}/list-your-restaurant/`), true);
assert.equal(locs.length, 8 + 14 + 7 + 236);

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
assert.equal(canonicalRedirect(new URL(`${ORIGIN}/restaurants/?meal=Lunch`), "GET"), null);
assert.equal(canonicalRedirect(new URL("https://eatingindestin.com/api/listing"), "POST"), null);
assert.equal(canonicalRedirect(new URL("https://eatingindestin.com/restaurants/"), "POST").status, 308);
assert.equal(ampersandRedirect(new URL(`${ORIGIN}/restaurants/?meal=Lunch`), "GET"), null);
assert.equal(ampersandRedirect(new URL(`${ORIGIN}/restaurants/aj-s-seafood-and-oyster-bar-destin-harbor/`), "GET"), null);
const ajOld = ampersandRedirect(new URL(`${ORIGIN}/restaurants/aj%27s-seafood-%26-oyster-bar/`), "GET");
assert.equal(ajOld.status, 301);
assert.equal(ajOld.location, `${ORIGIN}/restaurants/aj-s-seafood-and-oyster-bar-destin-harbor/`);
assert.equal(ampersandRedirect(new URL(`${ORIGIN}/restaurants/east-pass-seafood-%26-oyster-house/`), "GET"), null);
const camilleOld = legacyRedirect(new URL(`${ORIGIN}/restaurants/${encodeURIComponent("camille's-at-crystal-beach")}/`), "GET");
assert.equal(camilleOld.status, 301);
assert.equal(camilleOld.location, `${ORIGIN}/restaurants/camille-s-at-crystal-beach-crystal-beach/`);
const lagniappeOld = legacyRedirect(new URL(`${ORIGIN}/restaurants/louisiana-lagniappe/`), "GET");
assert.equal(lagniappeOld.status, 301);
assert.equal(lagniappeOld.location, `${ORIGIN}/restaurants/louisiana-lagniappe-destin-harbor/`);
const brickOld = legacyRedirect(new URL(`${ORIGIN}/restaurants/${encodeURIComponent("bricktop's")}/?q=1`), "GET");
assert.equal(brickOld.status, 301);
assert.equal(brickOld.location, `${ORIGIN}/restaurants/bricktop-s-grand-boulevard/?q=1`);
assert.equal(legacyRedirect(new URL(`${ORIGIN}/restaurants/bricktop-s/`), "GET").location, `${ORIGIN}/restaurants/bricktop-s-grand-boulevard/`);
assert.equal(legacyRedirect(new URL(`${ORIGIN}/restaurants/bricktop-s-grand-boulevard/`), "GET"), null);
assert.equal(legacyRedirect(new URL(`${ORIGIN}/restaurants/o-ku/`), "GET"), null);
assert.equal(removedRestaurantStatus("/restaurants/o-ku/"), 0);
assert.equal(removedRestaurantStatus("/restaurants/cowgirl-kitchen/"), 0);
assert.equal(removedRestaurantStatus("/restaurants/mi-casita/"), 0);
assert.equal(removedRestaurantStatus("/restaurants/hooters-destin/"), 410);
assert.equal(sisterRedirect(new URL(`${ORIGIN}/restaurants/o-ku/`), "GET").location, "https://www.eatingon30a.com/restaurants/o-ku-alys-beach/");
assert.equal(sisterRedirect(new URL(`${ORIGIN}/restaurants/cuvee-30a/`), "GET").location, "https://www.eatingon30a.com/restaurants/cuvee-30a-inlet-beach/");
assert.equal(sisterRedirect(new URL(`${ORIGIN}/restaurants/vue-on-30a/`), "GET"), null);
assert.equal(removedRestaurantStatus("/restaurants/vue-on-30a"), 410);
assert.equal(removedRestaurantStatus("/restaurants/vue-on-30a/"), 410);
assert.equal(sisterRedirect(new URL(`${ORIGIN}/restaurants/the-donut-hole/`), "GET").location, "https://www.eatingon30a.com/restaurants/the-donut-hole-inlet-beach/");
assert.equal(sisterRedirect(new URL(`${ORIGIN}/restaurants/goatfeathers-seafood-market/`), "GET").location, "https://www.eatingon30a.com/restaurants/goatfeathers-seafood-market-inlet-beach/");
assert.equal(locationRedirect(new URL(`${ORIGIN}/location/dune-allen-beach/`), "GET").location, "https://www.eatingon30a.com/areas/dune-allen-beach/");
assert.equal(locationRedirect(new URL(`${ORIGIN}/location/seagrove-beach`), "GET").location, "https://www.eatingon30a.com/areas/seagrove-beach/");
assert.equal(locationRedirect(new URL(`${ORIGIN}/location/all-of-30a/`), "GET").location, "https://www.eatingon30a.com/areas/");
const curlyAj = ampersandRedirect(new URL(`${ORIGIN}/restaurants/${encodeURIComponent("aj\u2019s-seafood-&-oyster-bar")}/`), "GET");
assert.equal(curlyAj.status, 301);
assert.equal(curlyAj.location, `${ORIGIN}/restaurants/aj-s-seafood-and-oyster-bar-destin-harbor/`);
assert.equal(removedRestaurantStatus("/restaurants/louisiana-lagniappe/"), 0);
assert.equal(removedRestaurantStatus("/restaurants/harbor-docks-destin-harbor/"), 0);
assert.equal(notFoundPathStatus("/404"), 404);
assert.equal(notFoundPathStatus("/404.html"), 404);
assert.equal(notFoundPathStatus("/restaurants/o-ku/"), 0);
const soft = await rejectSoftNotFound(new Response("<title>Page not found | Eating in Destin</title><h1>That page is not on the menu.</h1>", {
  status: 200,
  headers: { "content-type": "text/html; charset=utf-8" },
}));
assert.equal(soft.status, 404);
assert.equal(soft.headers.get("x-robots-tag"), "noindex");
assert.equal((await soft.text()).includes("canonical"), false);
const routeEnv = {
  ACCOUNT_SITE: "destin",
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      const html = `<link rel="canonical" href="${ORIGIN}/404.html"><title>Page not found | Eating in Destin</title><h1>That page is not on the menu.</h1>`;
      if (path === "/404.html") {
        return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      if (path === "/404" || path === "/404/") {
        return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
      }
      return new Response("missing", { status: 404, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  },
};
const prettyMissing = await worker.fetch(new Request(`${ORIGIN}/404`), routeEnv);
assert.equal(prettyMissing.status, 404);
assert.equal((await prettyMissing.text()).includes("canonical"), false);
const fileMissing = await worker.fetch(new Request(`${ORIGIN}/404.html`), routeEnv);
assert.equal(fileMissing.status, 404);
const gonePage = await worker.fetch(new Request(`${ORIGIN}/restaurants/hooters-destin/`), routeEnv);
assert.equal(gonePage.status, 410);
assert.equal(gonePage.headers.get("x-robots-tag"), "noindex");
assert.equal((await gonePage.text()).includes("canonical"), false);
const camilleMoved = await worker.fetch(new Request(`${ORIGIN}/restaurants/${encodeURIComponent("camille's-at-crystal-beach")}/`), routeEnv);
assert.equal(camilleMoved.status, 301);
assert.equal(camilleMoved.headers.get("location"), `${ORIGIN}/restaurants/camille-s-at-crystal-beach-crystal-beach/`);
const brickHtml = read("restaurants/bricktop-s-grand-boulevard/index.html");
assert.equal(attr(brickHtml, /<title>([^<]+)<\/title>/), "Bricktop's Destin at Grand Boulevard: Hours and Reservations");
assert.equal(attr(brickHtml, /<meta name="description" content="([^"]+)">/), "Bricktop's in Miramar Beach at Grand Boulevard. Hours, reservations, location and photos before you go.");
assert.equal(attr(brickHtml, /<meta property="og:title" content="([^"]+)">/), attr(brickHtml, /<title>([^<]+)<\/title>/));
assert.equal(attr(brickHtml, /<meta property="og:description" content="([^"]+)">/), attr(brickHtml, /<meta name="description" content="([^"]+)">/));
assert.match(brickHtml, /<h1>Bricktop&#x27;s Destin at Grand Boulevard<\/h1>/);
const baytowneHtml = read("guides/baytowne-wharf-restaurants/index.html");
assert.equal(attr(baytowneHtml, /<title>([^<]+)<\/title>/), "Baytowne Wharf Restaurants: Where to Eat in Sandestin (2026 Guide)");
assert.equal(attr(baytowneHtml, /<meta name="description" content="([^"]+)">/), "Every restaurant at Baytowne Wharf in Sandestin, from casual bites to date night spots, with hours, menus and local picks.");
const baytowneLd = jsonLd(baytowneHtml);
assert.equal(baytowneLd["@graph"].some((node) => node["@type"] === "ItemList"), true);
assert.equal(baytowneLd["@graph"].some((node) => node["@type"] === "FAQPage"), true);
assert.equal(baytowneLd["@graph"].some((node) => node["@type"] === "WebSite"), true);
const edgeLd = jsonLd(read("restaurants/the-edge-seafood-restaurant-and-skybar-destin-harbor/index.html"));
const edgeRestaurant = edgeLd["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.ok(edgeRestaurant);
assert.ok(edgeRestaurant.openingHoursSpecification.length);
assert.equal(edgeRestaurant.menu, undefined);
assert.equal(edgeRestaurant.hasMenu, undefined);
const unknownRestaurant = await worker.fetch(new Request(`${ORIGIN}/restaurants/not-a-real-restaurant/`), routeEnv);
assert.equal(unknownRestaurant.status, 404);
const moved30a = await worker.fetch(new Request(`${ORIGIN}/restaurants/cuvee-30a/`), routeEnv);
assert.equal(moved30a.status, 301);
assert.equal(moved30a.headers.get("location"), "https://www.eatingon30a.com/restaurants/cuvee-30a-inlet-beach/");
const grandHtml = read("areas/grand-boulevard/index.html");
assert.equal(attr(grandHtml, /<title>([^<]+)<\/title>/), "Grand Boulevard Restaurants in Sandestin | Eating in Destin");
assert.equal(attr(grandHtml, /<meta name="description" content="([^"]+)">/), "Every restaurant at Grand Boulevard Destin, including Bricktop's. Hours and maps.");
assert.equal(attr(grandHtml, /<meta property="og:title" content="([^"]+)">/), attr(grandHtml, /<title>([^<]+)<\/title>/));
assert.equal(attr(grandHtml, /<meta property="og:description" content="([^"]+)">/), attr(grandHtml, /<meta name="description" content="([^"]+)">/));
assert.match(grandHtml, /<h1>Restaurants in Grand Boulevard<\/h1>/);
const lagniappeHtml = read("restaurants/louisiana-lagniappe-destin-harbor/index.html");
assert.equal(lagniappeHtml.includes("facebook.com/2008/fbml"), false);
const lagniappeSchema = jsonLd(lagniappeHtml)["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.ok(lagniappeSchema.openingHours.includes("Mo 16:00-21:00"));
assert.match(lagniappeHtml, /<h1>Louisiana Lagniappe<\/h1>/);
assert.match(lagniappeHtml, /775 Gulf Shore/);
const camilleHtml = read("restaurants/camille-s-at-crystal-beach-crystal-beach/index.html");
assert.equal(attr(camilleHtml, /<link rel="canonical" href="([^"]+)">/), `${ORIGIN}/restaurants/camille-s-at-crystal-beach-crystal-beach/`);
assert.match(camilleHtml, /<h1>Camille/);
assert.match(camilleHtml, /2931 Scenic/);
const bad404 = `<link rel="canonical" href="${ORIGIN}/404.html">\n<meta property="og:url" content="${ORIGIN}/404.html">\n<script type="application/ld+json">{"name": "Page not found", "url": "${ORIGIN}/404.html", "isPartOf": {}}</script>`;
const cleaned404 = stripMissingCanonical(bad404);
assert.equal(cleaned404.includes("404.html"), false);
assert.equal(cleaned404.includes('rel="canonical"'), false);
assert.equal(config.origin.replace(/\/$/, ""), `https://${CANONICAL_HOST}`);

for (const path of walk(root)) {
  if (!path.endsWith(".html") && path !== join(root, "site.js")) continue;
  const html = readFileSync(path, "utf8");
  for (const match of html.matchAll(/<img\b[^>]*>/g)) {
    const tag = match[0];
    const alt = tag.match(/\salt="([^"]*)"/);
    assert.ok(alt, "missing alt " + path);
    assert.ok(alt[1].trim().length > 0, "empty alt " + path);
    if (/src="\/images\//.test(tag) || /src="\/favicon/.test(tag)) {
      assert.match(tag, /\swidth="/, "missing width " + path);
      assert.match(tag, /\sheight="/, "missing height " + path);
    }
  }
}

const everbowl = jsonLd(read("restaurants/everbowl-miramar-beach/index.html"))["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.match(everbowl.image, /\/images\/restaurants\/everbowl-miramar-beach\/logo\.svg$/);
const commelfo = jsonLd(read("restaurants/commelfo-restaurant-miramar-beach/index.html"))["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.equal(commelfo.openingHoursSpecification, undefined);
assert.equal(commelfo.telephone, "(850) 353-2991");
const oceanClub = jsonLd(read("restaurants/the-ocean-club-restaurant-miramar-beach/index.html"))["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.equal(oceanClub.openingHoursSpecification, undefined);

const edgeOverlay = renderProfile({
  slug: "the-edge-seafood-restaurant-and-skybar-destin-harbor",
  name: "The Edge Seafood Restaurant & SkyBar",
  area: "Destin Harbor",
  areaSlug: "destin-harbor",
  price: "$$$",
  phone: "(850) 659-3549",
  hours: "Sunday\u2013Thursday: 11am\u201310pm\nFriday\u2013Saturday: 11am\u201311pm",
  notes: "The Edge Seafood Restaurant & SkyBar is an upscale restaurant and bar in Destin Harbor.",
  cuisines: ["Seafood"],
  meals: ["Dinner"],
  photos: [{ src: "/images/restaurants/the-edge-seafood-restaurant-and-skybar-destin-harbor/01.jpg" }, { src: "/images/restaurants/the-edge-seafood-restaurant-and-skybar-destin-harbor/02.jpg" }, { src: "/images/restaurants/the-edge-seafood-restaurant-and-skybar-destin-harbor/03.jpg" }],
  address: "302 Harbor Blvd, Destin, FL 32541",
}, []);
const edgeOverlayLd = jsonLd(edgeOverlay);
assert.equal(edgeOverlayLd["@graph"].some((node) => node["@type"] === "WebSite"), true);
assert.equal(edgeOverlayLd["@graph"].some((node) => node["@type"] === "Organization"), true);
const edgeOverlayRestaurant = edgeOverlayLd["@graph"].find((node) => typesOf(node).includes("Restaurant"));
assert.equal(edgeOverlayRestaurant.priceRange, "$$$");
assert.equal(edgeOverlayRestaurant.telephone, "(850) 659-3549");
assert.match(edgeOverlayRestaurant.image, /\/01\.jpg$/);
assert.ok(edgeOverlayRestaurant.openingHoursSpecification.some((slot) => slot.dayOfWeek.endsWith("/Sunday") && slot.opens === "11:00" && slot.closes === "22:00"));
assert.ok(edgeOverlayRestaurant.openingHoursSpecification.some((slot) => slot.dayOfWeek.endsWith("/Friday") && slot.opens === "11:00" && slot.closes === "23:00"));
assert.equal(edgeOverlayRestaurant.openingHoursSpecification.length, 7);
assert.match(edgeOverlay, /src="\/images\/restaurants\/the-edge-seafood-restaurant-and-skybar-destin-harbor\/01\.jpg"[^>]*width="639" height="417"/);
assert.equal(edgeOverlay.includes("hasMenu"), false);

const slashEnv = {
  ACCOUNT_SITE: "destin",
  ASSETS: {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/restaurants" || path === "/map" || path === "/guides/best-seafood-destin" || path === "/about") {
        return new Response("redirect", { status: 307, headers: { location: `${path}/` } });
      }
      if (path === "/about/index.html") {
        return new Response("redirect", { status: 307, headers: { location: "/about/" } });
      }
      if (path === "/restaurants/not-a-redirect") {
        return new Response("redirect", { status: 307, headers: { location: "/somewhere-else/" } });
      }
      return new Response("<h1>Page</h1>", { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    },
  },
};
for (const path of ["/restaurants", "/map", "/guides/best-seafood-destin", "/about"]) {
  const moved = await worker.fetch(new Request(`${ORIGIN}${path}`), slashEnv);
  assert.equal(moved.status, 301, path);
  assert.equal(moved.headers.get("location"), `${ORIGIN}${path}/`);
}
const indexMoved = await worker.fetch(new Request(`${ORIGIN}/about/index.html`), slashEnv);
assert.equal(indexMoved.status, 301);
assert.equal(indexMoved.headers.get("location"), `${ORIGIN}/about/`);
const postMoved = await worker.fetch(new Request(`${ORIGIN}/about`, { method: "POST" }), slashEnv);
assert.equal(postMoved.status, 308);
assert.equal(postMoved.headers.get("location"), `${ORIGIN}/about/`);
const unrelated = await worker.fetch(new Request(`${ORIGIN}/restaurants/not-a-redirect`), slashEnv);
assert.equal(unrelated.status, 307);
assert.equal(unrelated.headers.get("location"), "/somewhere-else/");
const direct = promoteSlashRedirect(new Response(null, { status: 307, headers: { location: "/map/" } }), new Request(`${ORIGIN}/map`));
assert.equal(direct.status, 301);
assert.equal(direct.headers.get("location"), `${ORIGIN}/map/`);
const vueGone = await worker.fetch(new Request(`${ORIGIN}/restaurants/vue-on-30a`), routeEnv);
assert.equal(vueGone.status, 410);
