/**
 * Patch built HTML, the sitemap, and llms.txt so a draft or deleted listing
 * disappears everywhere a crawler or a visitor would see it. Live edits replace
 * the built card in place. A new live listing is added to the directory, its
 * area page, and the guides it matches.
 */

import siteConfig from "./site.config.json" with { type: "json" };

const ORIGIN = String(siteConfig.origin || "https://www.eatingindestin.com").replace(/\/$/, "");
const WATER_AREAS = new Set(["destin-harbor", "sandestin", "crystal-beach"]);
const MONOGRAM_SKIP = new Set(["the", "and", "at", "of", "a", "an", "by", "for", "on", "in"]);
const GALLERY_WINDOW = 4;
const SHARE_IMAGE = `${ORIGIN}/images/og-destin-harbor.jpg`;
const SHARE_ALT = "Fishing boats in Destin Harbor with shrimp, oysters, and fresh fish on the dock.";
const MUSIC_NOTE = "Live music is seasonal and subject to change — confirm with the restaurant.";
const GA_ID = "G-ZW0KS7V7QV";

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[char]);
}

export function normalizeHtmlPath(pathname) {
  let path = pathname || "/";
  if (path.endsWith("/index.html")) path = path.slice(0, -"index.html".length);
  if (!path.endsWith("/")) path += "/";
  return path;
}

export function listingSlugFromPath(pathname) {
  const match = String(pathname || "").match(/^\/restaurants\/([a-z0-9-]+)(?:\/index\.html|\/)?$/);
  if (!match || match[1] === "index") return "";
  return match[1];
}

export function isCatalogPath(pathname) {
  if (pathname === "/data/restaurants.json" || pathname === "/sitemap.xml") return true;
  if (pathname === "/llms.txt" || pathname === "/llms-full.txt") return true;
  if (pathname === "/" || pathname === "/index.html") return true;
  if (pathname === "/map" || pathname === "/map/" || pathname === "/map/index.html") return true;
  if (pathname === "/restaurants" || pathname === "/restaurants/" || pathname === "/restaurants/index.html") return true;
  if (listingSlugFromPath(pathname)) return true;
  if (pathname.startsWith("/areas/") || pathname.startsWith("/guides/")) return true;
  return false;
}

function snippet(text, limit = 150) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  if (value.length <= limit) return value;
  const cut = value.slice(0, limit).replace(/\s+\S*$/, "");
  return `${cut.replace(/[.,;:]$/, "")}…`;
}

function monogram(name) {
  const cleaned = String(name || "").replace(/[’']/g, "").replace(/&/g, " ");
  let words = (cleaned.match(/[A-Za-z0-9]+/g) || []).filter((word) => !MONOGRAM_SKIP.has(word.toLowerCase()));
  if (!words.length) words = String(name || "").match(/[A-Za-z0-9]+/g) || ["E"];
  return words.slice(0, 2).map((word) => word[0].toUpperCase()).join("");
}

function toneFor(listing) {
  const blob = [...(listing.cuisines || []), ...(listing.foods || []), listing.category || ""].join(" ").toLowerCase();
  if (/coffee|cafe|donut/.test(blob)) return "coffee";
  if (/dessert|ice cream|chocolate|sweet/.test(blob)) return "sweet";
  if (/pizza|italian/.test(blob)) return "italian";
  if (/sushi|japanese/.test(blob)) return "sushi";
  if (/seafood|oyster|fish/.test(blob)) return "seafood";
  if (blob.includes("burger")) return "burger";
  if (/mexican|taco|latin/.test(blob)) return "spice";
  if (/wine|bar/.test(blob)) return "wine";
  return "gulf";
}

function shotLabel(listing) {
  if (listing.foods && listing.foods.length) return listing.foods[0];
  if (listing.cuisines && listing.cuisines.length) return listing.cuisines[0];
  return listing.area || "";
}

function placeholder(tone, label, name, hidden = false) {
  const flag = hidden ? " hidden" : "";
  return `<div class="ph" data-tone="${escapeHtml(tone)}"${flag}><span class="mono" aria-hidden="true">${escapeHtml(monogram(name || label))}</span><span class="ph-label">${escapeHtml(label)}</span></div>`;
}

function photoAlt(listing) {
  return `${listing.name} in ${listing.area}, Destin`;
}

function yesNo(flag) {
  return flag ? "yes" : "no";
}

function cardSearch(listing) {
  if (listing.search) return listing.search;
  return [
    listing.name,
    listing.area,
    listing.subarea,
    listing.label,
    ...(listing.cuisines || []),
    ...(listing.meals || []),
    ...(listing.foods || []),
    listing.category,
    listing.notes,
    listing.price,
  ].filter(Boolean).join(" ").toLowerCase();
}

function mediaBlock(image, alt, tone, label, name, eager = false) {
  if (!image) return placeholder(tone, label, name);
  const loading = eager ? "eager" : "lazy";
  return `<img src="${escapeHtml(image)}" alt="${escapeHtml(alt)}" loading="${loading}" onerror="var p=this.parentElement;this.remove();var f=p&&p.querySelector('.ph');if(f)f.hidden=false">${placeholder(tone, label, name, true)}`;
}

export function renderCard(listing, heading = "h2") {
  const meals = (listing.meals || []).join(" · ");
  const cuisines = (listing.cuisines || []).join(", ");
  const bits = [listing.price, cuisines, meals].filter(Boolean);
  const areaLine = listing.subarea ? `${listing.area} · ${listing.subarea}` : listing.area;
  const note = snippet(listing.notes);
  const noteHtml = note ? `<p class="note">${escapeHtml(note)}</p>` : "";
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const tone = toneFor(listing);
  const label = shotLabel(listing);
  const saveArea = listing.label || listing.area || "";
  const tag = heading === "h3" ? "h3" : "h2";
  const attrs = [
    `id="r-${escapeHtml(listing.slug)}"`,
    'class="card card-place"',
    `data-area="${escapeHtml(listing.areaSlug)}"`,
    `data-meals="${escapeHtml((listing.meals || []).join("|"))}"`,
    `data-cuisines="${escapeHtml((listing.cuisines || []).join("|"))}"`,
    `data-outdoor="${yesNo(listing.outdoor)}"`,
    `data-kids="${yesNo(listing.kids)}"`,
    `data-music="${yesNo(listing.music)}"`,
    `data-laurens="${yesNo(listing.laurensFavorite)}"`,
    `data-reservations="${yesNo(listing.reservations)}"`,
    `data-groups="${yesNo(listing.groups)}"`,
    `data-happyfood="${yesNo(listing.happyFood)}"`,
    `data-happydrinks="${yesNo(listing.happyDrinks)}"`,
    `data-search="${escapeHtml(cardSearch(listing))}"`,
    `data-slug="${escapeHtml(listing.slug)}"`,
    `data-name="${escapeHtml(listing.name)}"`,
    `data-place-area="${escapeHtml(saveArea)}"`,
  ].join(" ");
  return `<article ${attrs}><div class="card-media">${mediaBlock(image, photoAlt(listing), tone, label, listing.name)}</div><a class="card-link" href="/restaurants/${escapeHtml(listing.slug)}/"><div class="card-body"><p class="card-area">${escapeHtml(areaLine)}</p><${tag}>${escapeHtml(listing.name)}</${tag}><p class="meta">${escapeHtml(bits.join(" · "))}</p>${noteHtml}</div></a></article>`;
}

export function guideSlugsFor(listing) {
  const guides = [];
  const notesLabel = `${listing.notes || ""} ${listing.label || ""}`.toLowerCase();
  const label = String(listing.label || "").toLowerCase();
  if ((listing.cuisines || []).includes("Seafood")) guides.push("best-seafood-destin");
  if ((listing.meals || []).includes("Breakfast")) guides.push("breakfast-destin");
  if ((listing.cuisines || []).includes("Cafe")) guides.push("coffee-brunch-destin");
  if (listing.kids) guides.push("kid-friendly-destin");
  if (listing.areaSlug === "sandestin" && (listing.meals || []).includes("Dinner")) guides.push("dinner-sandestin");
  if (listing.areaSlug === "destin-harbor") guides.push("destin-harbor-restaurants");
  if (listing.areaSlug === "miramar-beach") guides.push("miramar-beach-restaurants");
  if (listing.areaSlug === "sandestin") guides.push("sandestin-restaurants");
  if (listing.areaSlug === "grand-boulevard") guides.push("grand-boulevard-restaurants");
  if (listing.areaSlug === "destin-commons" || notesLabel.includes("destin commons")) guides.push("destin-commons-restaurants");
  if (label.startsWith("harborwalk")) guides.push("harborwalk-restaurants");
  if (label.includes("baytowne wharf")) guides.push("baytowne-wharf-restaurants");
  if (listing.outdoor && WATER_AREAS.has(listing.areaSlug)) guides.push("waterfront-destin");
  if (listing.laurensFavorite) guides.push("laurens-favorites-destin");
  return guides;
}

export function pageAcceptsListing(pathname, listing) {
  const path = normalizeHtmlPath(pathname);
  if (path === "/restaurants/") return true;
  if (path === `/areas/${listing.areaSlug}/`) return true;
  const guide = path.match(/^\/guides\/([a-z0-9-]+)\/$/);
  if (!guide || guide[1] === "index") return false;
  return guideSlugsFor(listing).includes(guide[1]);
}

function divBounds(html, openIndex) {
  const openEnd = html.indexOf(">", openIndex);
  if (openEnd < 0) return null;
  const re = /<\/?div\b[^>]*>/gi;
  re.lastIndex = openEnd + 1;
  let depth = 1;
  let match;
  while ((match = re.exec(html))) {
    if (match[0].startsWith("</")) depth -= 1;
    else depth += 1;
    if (depth === 0) return { innerEnd: match.index, end: match.index + match[0].length };
  }
  return null;
}

function articleBounds(html, slug) {
  const id = `id="r-${slug}"`;
  const at = html.indexOf(id);
  if (at < 0) return null;
  const open = html.lastIndexOf("<article", at);
  const end = html.indexOf("</article>", at);
  if (open < 0 || end < 0) return null;
  return { open, end: end + "</article>".length };
}

function removeArticles(html, slugs) {
  let next = html;
  for (const slug of slugs) {
    const bounds = articleBounds(next, slug);
    if (!bounds) continue;
    next = next.slice(0, bounds.open) + next.slice(bounds.end);
  }
  return next;
}

function replaceArticle(html, listing) {
  const bounds = articleBounds(html, listing.slug);
  if (!bounds) return html;
  const heading = /<h3>/.test(html.slice(bounds.open, bounds.end)) ? "h3" : "h2";
  return html.slice(0, bounds.open) + renderCard(listing, heading) + html.slice(bounds.end);
}

function eachCover(html, visit) {
  const finder = /<div class="cover" data-featured/g;
  let result = "";
  let cursor = 0;
  let match;
  while ((match = finder.exec(html))) {
    const bounds = divBounds(html, match.index);
    if (!bounds) return html;
    const chunk = html.slice(match.index, bounds.end);
    result += html.slice(cursor, match.index);
    result += visit(chunk);
    cursor = bounds.end;
    finder.lastIndex = bounds.end;
  }
  return result + html.slice(cursor);
}

function coverSlug(chunk) {
  const match = chunk.match(/\/restaurants\/([a-z0-9-]+)\//);
  return match ? match[1] : "";
}

function renderCover(listing, hidden) {
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const tone = toneFor(listing);
  const media = mediaBlock(image, photoAlt(listing), tone, shotLabel(listing), listing.name, true);
  const meta = [listing.label || listing.area, listing.price, (listing.cuisines || []).join(", ")].filter(Boolean).join(" · ");
  const flag = hidden ? " hidden" : "";
  return `<div class="cover" data-featured${flag}><a class="cover-media" href="/restaurants/${escapeHtml(listing.slug)}/">${media}</a><div class="cover-copy"><p class="kicker">Featured</p><h2>${escapeHtml(listing.name)}</h2><p class="lede">${escapeHtml(snippet(listing.notes, 240))}</p><p class="meta">${escapeHtml(meta)}</p><p><a class="text-link" href="/restaurants/${escapeHtml(listing.slug)}/">View restaurant</a></p></div></div>`;
}

function gridMarker(pathname) {
  const path = normalizeHtmlPath(pathname);
  if (path === "/restaurants/") return '<div id="cards" class="card-grid">';
  if (path.startsWith("/areas/") || /^\/guides\/[a-z0-9-]+\/$/.test(path)) return '<div class="card-grid">';
  return "";
}

function appendCards(html, pathname, listings) {
  const marker = gridMarker(pathname);
  if (!marker || !listings.length) return html;
  const at = html.indexOf(marker);
  if (at < 0) return html;
  const bounds = divBounds(html, at);
  if (!bounds) return html;
  const cards = listings.map((listing) => renderCard(listing)).join("");
  return html.slice(0, bounds.innerEnd) + cards + html.slice(bounds.innerEnd);
}

function stripListItems(html, slugs) {
  let next = html;
  for (const slug of slugs) {
    const url = `${ORIGIN}/restaurants/${slug}/`;
    const pattern = new RegExp(`\\{"@type": "ListItem", "position": \\d+, "name": "(?:\\\\.|[^"\\\\])*", "url": "${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\},?`, "g");
    next = next.replace(pattern, "");
  }
  return next;
}

export function patchHtml(html, pathname, { hidden = [], placed = [] } = {}) {
  const hiddenSlugs = hidden.map((listing) => listing.slug);
  const placedBySlug = new Map(placed.map((listing) => [listing.slug, listing]));
  let next = removeArticles(html, hiddenSlugs);
  next = stripListItems(next, hiddenSlugs);
  next = eachCover(next, (chunk) => {
    const slug = coverSlug(chunk);
    if (hiddenSlugs.includes(slug)) return "";
    const listing = placedBySlug.get(slug);
    if (!listing) return chunk;
    return renderCover(listing, /\shidden[\s>]/.test(chunk.slice(0, 80)));
  });
  const insert = [];
  for (const listing of placed) {
    if (!articleBounds(next, listing.slug)) {
      if (pageAcceptsListing(pathname, listing)) insert.push(listing);
      continue;
    }
    if (pageAcceptsListing(pathname, listing)) next = replaceArticle(next, listing);
    else next = removeArticles(next, [listing.slug]);
  }
  if (insert.length) next = appendCards(next, pathname, insert);
  return next;
}

export function patchSitemap(xml, { hidden = [], placed = [] } = {}) {
  const refresh = new Set([...hidden, ...placed].map((listing) => listing.slug));
  let next = xml;
  for (const slug of refresh) {
    const loc = `${ORIGIN}/restaurants/${slug}/`;
    next = next.replace(new RegExp(`\\s*<url>\\s*<loc>${loc.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</loc>[\\s\\S]*?</url>`, "g"), "");
  }
  const urls = placed.map((listing) => `  <url>\n    <loc>${escapeHtml(`${ORIGIN}/restaurants/${listing.slug}/`)}</loc>\n  </url>`).join("\n");
  if (urls) next = next.replace("</urlset>", `${urls}\n</urlset>`);
  return next;
}

export function patchLlms(text, { hidden = [], placed = [] } = {}) {
  const refresh = new Set([...hidden, ...placed].map((listing) => listing.slug));
  const lines = text.split("\n").filter((line) => {
    for (const slug of refresh) {
      if (line.includes(`/restaurants/${slug}/`)) return false;
    }
    return true;
  });
  const extra = placed.map((listing) => {
    const bits = (listing.cuisines || []).join(", ") || listing.category || "Restaurant";
    const meals = (listing.meals || []).join(", ");
    const where = listing.address || listing.area;
    const tail = meals ? `${bits}; ${meals}` : bits;
    return `- [${listing.name}](${ORIGIN}/restaurants/${listing.slug}/): ${where}. ${tail}.`;
  });
  const areas = lines.findIndex((line) => line.startsWith("## Areas") || line.startsWith("## Towns"));
  if (areas >= 0) lines.splice(areas, 0, ...extra);
  else lines.push(...extra);
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n")}\n`;
}

function telHref(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  if (digits.length === 10) return `tel:+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `tel:+${digits}`;
  return digits ? `tel:${digits}` : "";
}

function hostOf(url) {
  return String(url || "").replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
}

function paragraphs(text) {
  const blocks = String(text || "").split(/\n\s*\n/).map((part) => part.trim()).filter(Boolean);
  return blocks.map((part) => `<p>${escapeHtml(part).replace(/\n/g, "<br>")}</p>`).join("");
}

function galleryCountLabel(end, total) {
  const count = Math.max(0, total);
  const shown = Math.min(count, Math.max(0, end));
  const noun = count === 1 ? "photo" : "photos";
  return `${shown} of ${count} ${noun}`;
}

function galleryArrow(step) {
  const label = step < 0 ? "Previous photos" : "Next photos";
  const path = step < 0 ? "M14.5 5.5 8 12l6.5 6.5" : "M9.5 5.5 16 12l-6.5 6.5";
  return `<button type="button" class="profile-gallery-arrow" data-gallery-step="${step}" aria-label="${label}" hidden><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${path}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path></svg></button>`;
}

function gallery(listing) {
  const photos = listing.photos || [];
  if (!photos.length) return `<div class="profile-hero">${placeholder(toneFor(listing), shotLabel(listing), listing.name)}</div>`;
  const alt = photoAlt(listing);
  const total = photos.length;
  const cells = photos.map((photo, index) => {
    const hidden = index >= GALLERY_WINDOW ? " hidden" : "";
    const loading = index < GALLERY_WINDOW ? "eager" : "lazy";
    return `<div class="profile-gallery-cell"${hidden}><img src="${escapeHtml(photo.src)}" alt="${escapeHtml(alt)}" loading="${loading}"></div>`;
  }).join("");
  const prev = total > GALLERY_WINDOW ? galleryArrow(-1) : "";
  const next = total > GALLERY_WINDOW ? galleryArrow(1) : "";
  const count = galleryCountLabel(Math.min(GALLERY_WINDOW, total), total);
  return `<section class="profile-gallery" data-total="${total}" aria-label="Photos"><div class="profile-gallery-frame">${prev}<div class="profile-gallery-grid" data-count="${total}">${cells}</div>${next}</div><p class="profile-gallery-count" aria-live="polite">${count}</p></section>`;
}

function crumbs(listing) {
  const areaPage = `/areas/${listing.areaSlug}/`;
  return `<nav class="crumbs" aria-label="Breadcrumb"><a href="/">Home</a> <span aria-hidden="true">/</span> <a href="/restaurants/">Restaurants</a> <span aria-hidden="true">/</span> <a href="${escapeHtml(areaPage)}">${escapeHtml(listing.area)}</a> <span aria-hidden="true">/</span> <span aria-current="page">${escapeHtml(listing.name)}</span></nav>`;
}

function listUpdateHref(listing) {
  const params = new URLSearchParams({
    intent: "update",
    restaurant: listing.name,
    listing: `${ORIGIN}/restaurants/${listing.slug}/`,
  });
  return `/list-your-restaurant/?${params.toString()}`;
}

export function renderProfile(listing, nearby = []) {
  const chips = [];
  for (const meal of listing.meals || []) chips.push(`<li><a href="/restaurants/?meal=${escapeHtml(meal)}">${escapeHtml(meal)}</a></li>`);
  for (const cuisine of listing.cuisines || []) chips.push(`<li><a href="/restaurants/?cuisine=${escapeHtml(cuisine)}">${escapeHtml(cuisine)}</a></li>`);
  if (listing.price) chips.push(`<li>${escapeHtml(listing.price)}</li>`);
  const flags = [];
  if (listing.outdoor) flags.push("Outdoor dining");
  if (listing.kids) flags.push("Kid friendly");
  if (listing.music) flags.push("Live music*");
  if (listing.laurensFavorite) flags.push("Lauren's Favorites");
  if (listing.happyDrinks) flags.push("Happy hour drinks");
  if (listing.happyFood) flags.push("Happy hour food");
  if (listing.reservations) flags.push("Takes reservations");
  if (listing.groups) flags.push("Good for groups 12+");
  for (const flag of flags) chips.push(`<li>${escapeHtml(flag)}</li>`);
  const phone = telHref(listing.phone) ? `<a href="${escapeHtml(telHref(listing.phone))}">${escapeHtml(listing.phone)}</a>` : "";
  const website = listing.website ? `<a href="${escapeHtml(listing.website)}" target="_blank" rel="noopener noreferrer">${escapeHtml(hostOf(listing.website))}</a>` : "";
  const directions = listing.lat != null && listing.lng != null
    ? `<a href="https://www.openstreetmap.org/?mlat=${listing.lat}&amp;mlon=${listing.lng}#map=17/${listing.lat}/${listing.lng}">View map</a>`
    : "";
  const socials = [];
  if (listing.instagram) socials.push(`<a href="${escapeHtml(listing.instagram)}" rel="noopener noreferrer">Instagram</a>`);
  if (listing.facebook) socials.push(`<a href="${escapeHtml(listing.facebook)}" rel="noopener noreferrer">Facebook</a>`);
  const facts = [
    ["Hours", listing.hours ? escapeHtml(listing.hours).replace(/\n/g, "<br>") : "Hours not listed"],
    ["Phone", phone],
    ["Website", website],
    ["Address", listing.address ? escapeHtml(listing.address) : ""],
    ["Directions", directions],
    ["Food", escapeHtml((listing.foods || []).join(", "))],
    ["Vibe", escapeHtml((listing.vibes || []).join(", "))],
    ["Category", escapeHtml(listing.category || "")],
    ["Also", socials.join(" · ")],
  ].filter(([, value]) => value).map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${value}</dd></div>`).join("");
  const also = nearby.filter((item) => item.slug !== listing.slug && item.areaSlug === listing.areaSlug).slice(0, 4);
  const alsoHtml = also.map((item) => `<a class="map-hit" href="/restaurants/${escapeHtml(item.slug)}/"><strong>${escapeHtml(item.name)}</strong><span>${escapeHtml(item.price || "")}</span></a>`).join("");
  const image = listing.photos && listing.photos[0] ? listing.photos[0].src : "";
  const title = `${listing.name} in ${listing.area} | Eating in Destin`;
  const description = snippet(`${listing.name} in ${listing.area}, Destin and Miramar Beach, Florida. ${listing.notes || "Hours, the address, and a map are on this page."}`.trim(), 160);
  const path = `/restaurants/${listing.slug}/`;
  const areaPage = `/areas/${listing.areaSlug}/`;
  const areaHref = `/restaurants/?area=${encodeURIComponent(listing.areaSlug || "")}`;
  const areaLine = listing.label || listing.area;
  const priceBit = listing.price ? ` · ${escapeHtml(listing.price)}` : "";
  const categoryBit = listing.category ? ` · ${escapeHtml(listing.category)}` : "";
  const logo = listing.logo ? `<img class="logo" src="${escapeHtml(listing.logo)}" alt="${escapeHtml(listing.name)} logo">` : "";
  const map = listing.lat != null && listing.lng != null
    ? `<div class="wrap profile-map"><div id="detail-map" data-lat="${listing.lat}" data-lng="${listing.lng}" data-name="${escapeHtml(listing.name)}" data-slug="${escapeHtml(listing.slug)}" data-area="${escapeHtml(listing.area)}" data-address="${escapeHtml(listing.address)}" data-image="${escapeHtml(image)}" role="region" aria-label="Map"></div><link rel="stylesheet" href="/vendor/leaflet/leaflet.css"><script src="/vendor/leaflet/leaflet.js"></script></div>`
    : "";
  const claim = `<p class="listing-claim"><a href="${escapeHtml(listUpdateHref(listing))}">Update this listing</a> <span aria-hidden="true">/</span> <a href="/list-your-restaurant/">List your restaurant</a></p>`;
  const more = `<section class="wrap more"><h2>Also in ${escapeHtml(listing.area)}</h2><div class="map-list">${alsoHtml}</div><p><a class="text-link" href="${escapeHtml(areaPage)}">All restaurants in ${escapeHtml(listing.area)}</a></p>${claim}</section>`;
  const story = paragraphs(listing.notes) || `<p>${escapeHtml(listing.name)} is in ${escapeHtml(listing.area)}.</p>`;
  const music = listing.music ? `<p class="music-note">${escapeHtml(MUSIC_NOTE)}</p>` : "";
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<script async src="https://www.googletagmanager.com/gtag/js?id=${GA_ID}"></script>
<script>
window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', '${GA_ID}');
</script>
<title>${escapeHtml(title)}</title>
<meta name="description" content="${escapeHtml(description)}">
<link rel="canonical" href="${escapeHtml(ORIGIN + path)}">
<meta name="robots" content="index,follow">
<meta property="og:title" content="${escapeHtml(title)}">
<meta property="og:description" content="${escapeHtml(description)}">
<meta property="og:url" content="${escapeHtml(ORIGIN + path)}">
<meta property="og:image" content="${escapeHtml(SHARE_IMAGE)}">
<meta property="og:image:alt" content="${escapeHtml(SHARE_ALT)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Eating in Destin">
<meta name="theme-color" content="#102825">
<link rel="icon" href="/favicon.ico" sizes="any">
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<div id="site-header"></div>
<main id="main">
<article class="profile">${gallery(listing)}<div class="wrap profile-head">${crumbs(listing)}<p class="eyebrow"><a href="${escapeHtml(areaHref)}">${escapeHtml(areaLine)}</a>${priceBit}${categoryBit}</p><h1>${escapeHtml(listing.name)}</h1><ul class="chips">${chips.join("")}</ul>${music}</div><div class="wrap profile-grid"><div class="prose profile-story">${story}</div><aside>${logo}<dl class="facts">${facts}</dl></aside></div>${map}${more}</article>
</main>
<div id="site-footer"></div>
<script src="/header.js"></script>
<script src="/footer.js"></script>
<script type="module" src="/site.js"></script>
</body>
</html>`;
}

export function changedListings(merged) {
  const hidden = [];
  const placed = [];
  for (const listing of merged) {
    if (listing.source === "baseline") continue;
    if (listing.deleted || listing.status !== "live") hidden.push(listing);
    else placed.push(listing);
  }
  return { hidden, placed };
}
