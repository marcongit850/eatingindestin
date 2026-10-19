/**
 * Apply the listing overlay when a public page, the map data, the sitemap,
 * or llms.txt is requested. With no admin rows, the built file is returned
 * unchanged.
 */

import removedSlugs from "./data/removed-slugs.json" with { type: "json" };
import { liveListings, publicRecords } from "./catalog.js";
import { currentCatalog } from "./catalog-store.js";
import { siteId } from "./shared-accounts.js";
import {
  changedListings,
  isCatalogPath,
  listingSlugFromPath,
  patchHtml,
  patchLlms,
  patchSitemap,
  renderProfile,
} from "./public-html.js";

const REMOVED_SLUGS = new Set(removedSlugs);

function htmlResponse(body, status = 200) {
  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
  };
  if (status !== 200) headers["x-robots-tag"] = "noindex";
  return new Response(body, { status, headers });
}

export async function missingPage(request, env, status = 404) {
  const url = new URL(request.url);
  if (env && env.ASSETS) {
    const page = await env.ASSETS.fetch(new Request(new URL("/404.html", url.origin)));
    const headers = new Headers(page.headers);
    headers.set("cache-control", "no-store");
    headers.set("x-robots-tag", "noindex");
    return new Response(page.body, { status, headers });
  }
  return htmlResponse("That page is not on the menu.", status);
}

export async function servePublic(request, response, env) {
  const url = new URL(request.url);
  if (!isCatalogPath(url.pathname)) return response;
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  if (!siteId(env)) return response;
  let merged;
  try {
    merged = (await currentCatalog(env)).merged;
  } catch (error) {
    console.log(JSON.stringify({ event: "catalog_overlay", message: error && error.message }));
    return response;
  }
  const { hidden, placed } = changedListings(merged);
  const slug = listingSlugFromPath(url.pathname);
  if (slug) {
    const listing = merged.find((item) => item.slug === slug);
    if (!listing || listing.deleted || listing.status !== "live") {
      return missingPage(request, env, REMOVED_SLUGS.has(slug) ? 410 : 404);
    }
    if (listing.source === "baseline") return response;
    if (request.method === "HEAD") return new Response(null, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    return htmlResponse(renderProfile(listing, liveListings(merged)));
  }

  // The sitemap is reconciled to live listings even when the overlay is idle,
  // so a stale file cannot keep feeding deleted /restaurants/{slug} URLs.
  const rewriteSitemap = url.pathname === "/sitemap.xml";
  if (!hidden.length && !placed.length && !rewriteSitemap) return response;

  if (request.method === "HEAD") {
    return new Response(null, { status: response.status, headers: { "cache-control": "no-store" } });
  }

  if (url.pathname === "/data/restaurants.json") {
    return new Response(`${JSON.stringify(publicRecords(merged), null, 2)}\n`, {
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const text = await response.text();
  if (rewriteSitemap) {
    return new Response(patchSitemap(text, {
      hidden,
      placed,
      liveSlugs: liveListings(merged).map((item) => item.slug),
    }), {
      headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "no-store" },
    });
  }
  if (url.pathname === "/llms.txt" || url.pathname === "/llms-full.txt") {
    return new Response(patchLlms(text, { hidden, placed }), {
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }
  return new Response(patchHtml(text, url.pathname, { hidden, placed }), {
    status: response.status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}
