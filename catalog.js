/**
 * Merge the built catalog with admin rows from the accounts Worker.
 * A missing row means the built listing is live. Draft and deleted rows
 * stay out of the public guide. Created rows exist only in the overlay.
 */

import { publicRecord, searchText, slugify } from "./listing-model.js";

function photosOf(value) {
  const list = Array.isArray(value) ? value : [];
  const photos = [];
  for (const item of list) {
    if (typeof item === "string" && item.startsWith("/")) photos.push({ id: null, src: item });
    else if (item && typeof item.src === "string" && item.src.startsWith("/")) {
      photos.push({ id: item.id || null, src: item.src });
    }
  }
  return photos;
}

export function presentListing(raw) {
  const area = raw.area || "";
  const listing = {
    ...raw,
    name: raw.name || "",
    area,
    areaSlug: slugify(area),
    subarea: raw.subarea || "",
    label: raw.label || "",
    address: raw.address || "",
    lat: raw.lat ?? null,
    lng: raw.lng ?? null,
    phone: raw.phone || "",
    website: raw.website || "",
    facebook: raw.facebook || "",
    instagram: raw.instagram || "",
    price: raw.price || "",
    notes: raw.notes || "",
    hours: raw.hours || "",
    cuisines: raw.cuisines || [],
    meals: raw.meals || [],
    foods: raw.foods || [],
    vibes: raw.vibes || [],
    category: raw.category || "",
    outdoor: Boolean(raw.outdoor),
    // Only an explicit true is tagged. Boolean("yes") and a missing key are not.
    waterfront: raw.waterfront === true,
    bar: raw.bar === true,
    kids: Boolean(raw.kids),
    music: Boolean(raw.music),
    reservations: Boolean(raw.reservations),
    groups: Boolean(raw.groups),
    happyFood: Boolean(raw.happyFood),
    happyDrinks: Boolean(raw.happyDrinks),
    laurensFavorite: Boolean(raw.laurensFavorite),
    photos: photosOf(raw.photos),
    logo: raw.logo || "",
    search: raw.search || "",
    status: raw.status === "draft" ? "draft" : raw.status === "inactive" ? "inactive" : "live",
    deleted: Boolean(raw.deleted),
    source: raw.source || "baseline",
  };
  if (!listing.search) listing.search = searchText(listing);
  return listing;
}

export function mergeCatalog(baseline, rows) {
  const map = new Map();
  for (const item of baseline || []) {
    map.set(item.slug, presentListing({ ...item, status: "live", deleted: false, source: "baseline" }));
  }
  for (const row of rows || []) {
    const previous = map.get(row.slug);
    const payload = row.payload || {};
    // The baseline listing is spread first. An override that omits waterfront
    // or bar keeps that value. presentListing then keeps only === true, so a
    // missing key is not rewritten to false.
    map.set(row.slug, presentListing({
      ...(previous || {}),
      ...payload,
      logo: payload.logo || (previous && previous.logo) || "",
      slug: row.slug,
      status: row.status === "draft" ? "draft" : row.status === "inactive" ? "inactive" : "live",
      deleted: Boolean(row.deleted),
      source: previous ? "override" : "created",
      updatedAt: row.updatedAt || null,
    }));
  }
  return [...map.values()].sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), undefined, { sensitivity: "base" }));
}

export function isPublicListing(listing) {
  return Boolean(listing) && !listing.deleted && listing.status === "live";
}

export function liveListings(merged) {
  return merged.filter(isPublicListing);
}

export function publicRecords(merged) {
  return liveListings(merged).map(publicRecord);
}

export function bySlug(merged) {
  return new Map(merged.map((listing) => [listing.slug, listing]));
}
