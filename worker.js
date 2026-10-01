import listingOptions from "./data/listing-options.json" with { type: "json" };

/**
 * Static assets are served by the assets binding.
 * /api/subscribe accepts a coupon signup and /api/listing accepts a restaurant
 * correction, edit, deletion, new listing, or other note. A restaurant name is
 * optional. /api/list-restaurant accepts the full new-listing or update form.
 * When the secrets exist, each of these emails CONTACT_EMAIL through Resend
 * (https://resend.com). Nothing is emailed until all three are set:
 * RESEND_API_KEY, SUBSCRIBE_FROM (a verified Resend sender), CONTACT_EMAIL.
 * A coupon signup is also appended through an Apps Script webhook when
 * GOOGLE_SHEETS_WEBHOOK_URL and GOOGLE_SHEETS_WEBHOOK_TOKEN are set.
 * `delivered` is the Resend result and `recorded` is the sheet result.
 * The sheet is recorded only when the webhook returns JSON with `ok: true`.
 * An HTTP 200 HTML error, other non-JSON body, or `{ok:false}` is not a
 * recording. A sheet miss leaves a Resend success as a success.
 * Listing requests are not written to the sheet.
 *
 * Spam: a filled honeypot is answered with the normal success response and is
 * not emailed or recorded. Subscribe and the short listing form treat
 * `company`, `hp_field`, and `website` as the honeypot. The full restaurant
 * form treats `company` and `hp_field` only, because `website` is the
 * restaurant site. Bodies over 16 KB are rejected, except the full restaurant
 * form, which allows 32 KB. Each Cloudflare IP may POST five times a minute
 * across the forms.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LISTING_TYPES = {
  update: "Update",
  edit: "Edit",
  deletion: "Deletion",
  new: "New listing",
  other: "Other",
};
const LISTING_TYPE_ERROR = "Choose update, edit, deletion, new listing, or other.";
const MAX_BODY = 16000;
const MAX_RESTAURANT_BODY = 32000;
const WINDOW_MS = 60 * 1000;
const MAX_PER_WINDOW = 5;
const recentHits = new Map();

export function parseSubscribe(body) {
  if (!body || typeof body !== "object") return { error: "Send the signup as JSON." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  const audience = String(body.audience || "").trim().toLowerCase();
  if (audience && audience !== "local" && audience !== "visitor") return { error: "Choose Local or Visitor." };
  return { value: { email, audience, coupons: Boolean(body.coupons) } };
}

function resendReady(env) {
  const key = env && env.RESEND_API_KEY;
  const to = env && env.CONTACT_EMAIL;
  const from = env && env.SUBSCRIBE_FROM;
  if (!key || !to || !from) return null;
  return { key, to, from };
}

async function postResend(env, message, fetchImpl, failure) {
  const ready = resendReady(env);
  if (!ready) return { ok: true, delivered: false };
  const response = await fetchImpl("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${ready.key}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from: ready.from, to: [ready.to], ...message }),
  });
  if (!response.ok) return { ok: false, delivered: false, error: failure };
  return { ok: true, delivered: true };
}

function sheetsReady(env) {
  const url = env && env.GOOGLE_SHEETS_WEBHOOK_URL;
  const token = env && env.GOOGLE_SHEETS_WEBHOOK_TOKEN;
  if (!url || !token) return null;
  return { url, token };
}

function sheetPayload(payload, token) {
  const body = {
    token,
    site: "Destin",
    email: payload.email,
    coupons: Boolean(payload.coupons),
    sourcePage: `https://${CANONICAL_HOST}/`,
  };
  if (payload.audience === "local" || payload.audience === "visitor") body.audience = payload.audience;
  return body;
}

async function sheetRecorded(response) {
  if (!response.ok) return false;
  let data;
  try {
    data = await response.json();
  } catch {
    return false;
  }
  return Boolean(data && typeof data === "object" && !Array.isArray(data) && data.ok === true);
}

async function postSheets(payload, env, fetchImpl) {
  const ready = sheetsReady(env);
  if (!ready) return { recorded: false };
  try {
    const response = await fetchImpl(ready.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sheetPayload(payload, ready.token)),
    });
    return { recorded: await sheetRecorded(response) };
  } catch {
    return { recorded: false };
  }
}

export async function deliverSubscribe(payload, env, fetchImpl = fetch) {
  const who = payload.audience === "local" ? "Local" : payload.audience === "visitor" ? "Visitor" : "Not specified";
  const mailed = await postResend(
    env,
    {
      subject: "Eating in Destin coupon signup",
      text: `Email: ${payload.email}\nI am a: ${who}\nCoupons: ${payload.coupons ? "yes" : "no"}`,
    },
    fetchImpl,
    "The signup could not be sent.",
  );
  const sheet = await postSheets(payload, env, fetchImpl);
  return { ...mailed, recorded: sheet.recorded };
}

function oneLine(value, max) {
  const text = String(value || "").replace(/[\u0000-\u001F\u007F]+/g, " ").replace(/\s+/g, " ").trim();
  if (!text || text.length > max) return "";
  return text;
}

export function parseListing(body) {
  if (!body || typeof body !== "object") return { error: "Send the request as JSON." };
  const restaurant = oneLine(body.restaurant, 160);
  if (String(body.restaurant || "").trim() && !restaurant) return { error: "Keep the restaurant name under 160 characters." };
  const town = oneLine(body.town, 120);
  if (String(body.town || "").trim() && !town) return { error: "Town is too long." };
  const type = String(body.type || "").trim().toLowerCase();
  if (!Object.prototype.hasOwnProperty.call(LISTING_TYPES, type)) {
    return { error: LISTING_TYPE_ERROR };
  }
  const details = String(body.details || "").replace(/\r\n/g, "\n").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "").trim();
  if (!details) return { error: "Tell us what should change." };
  if (details.length > 4000) return { error: "Keep the details under 4,000 characters." };
  const name = oneLine(body.name, 120);
  if (!name) return { error: "Enter your name." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  return { value: { restaurant, town, type, details, name, email } };
}

export async function deliverListing(payload, env, fetchImpl = fetch) {
  const label = LISTING_TYPES[payload.type] || payload.type;
  const restaurant = payload.restaurant || "Not specified";
  const town = payload.town || "Not specified";
  return postResend(
    env,
    {
      reply_to: payload.email,
      subject: `Eating in Destin listing: ${label} — ${restaurant}`,
      text: `Request: ${label}\nRestaurant: ${restaurant}\nTown: ${town}\nFrom: ${payload.name} <${payload.email}>\n\n${payload.details}`,
    },
    fetchImpl,
    "The request could not be sent.",
  );
}

function plain(value, max) {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim();
  return { text, tooLong: text.length > max };
}

function phoneField(value, { required, missing, invalid, label }) {
  const raw = String(value || "").trim();
  if (!raw) return required ? { error: missing } : { value: "" };
  const text = oneLine(value, 40);
  if (!text) return { error: `Keep the ${label} under 40 characters.` };
  const digits = text.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 15 || !/^[0-9+().\-\s]+$/.test(text)) return { error: invalid };
  return { value: text };
}

function optionalUrl(value, label) {
  const raw = String(value || "").trim();
  if (!raw) return { value: "" };
  const text = oneLine(value, 500);
  if (!text) return { error: `Keep the ${label} under 500 characters.` };
  if (!/^https?:\/\/\S+$/i.test(text)) return { error: `Enter a full ${label} starting with https://.` };
  return { value: text };
}

function choiceList(value, allowed, min, missing, invalid) {
  const raw = Array.isArray(value) ? value : value == null || String(value).trim() === "" ? [] : [value];
  if (raw.length > 40) return { error: invalid };
  const picked = [];
  for (const item of raw) {
    const text = oneLine(item, 80);
    if (!text || !allowed.includes(text)) return { error: invalid };
    if (!picked.includes(text)) picked.push(text);
  }
  if (picked.length < min) return { error: missing };
  return { value: picked };
}

function yesNo(value, label) {
  const text = String(value || "").trim().toLowerCase();
  if (text !== "yes" && text !== "no") return { error: `Choose yes or no for ${label}.` };
  return { value: text };
}

function authorizedYes(value) {
  return value === true || String(value || "").trim().toLowerCase() === "yes";
}

function showValue(value) {
  if (Array.isArray(value)) return value.length ? value.join(", ") : "Not provided";
  const text = String(value ?? "").trim();
  return text || "Not provided";
}

function yesNoLabel(value) {
  return value === "yes" ? "Yes" : "No";
}

export function parseListRestaurant(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { error: "Send the listing as JSON." };
  const nameRaw = String(body.name || "").trim();
  const name = oneLine(body.name, 120);
  if (!nameRaw) return { error: "Enter your name." };
  if (!name) return { error: "Keep your name under 120 characters." };
  const role = String(body.role || "").trim().toLowerCase();
  const roleOption = listingOptions.roles.find((item) => item.value === role);
  if (!roleOption) return { error: "Choose owner, manager, marketing, or other." };
  const email = String(body.email || "").trim();
  if (!EMAIL.test(email) || email.length > 200) return { error: "Enter a valid email." };
  const yourPhone = phoneField(body.yourPhone, {
    required: false,
    missing: "",
    invalid: "Enter a valid phone number.",
    label: "phone number",
  });
  if (yourPhone.error) return yourPhone;
  const bestRaw = String(body.bestTime || "").trim();
  const bestTime = oneLine(body.bestTime, 120);
  if (bestRaw && !bestTime) return { error: "Keep the best time under 120 characters." };
  const intent = String(body.intent || "").trim().toLowerCase();
  if (intent !== "new" && intent !== "update") return { error: "Choose new listing or update an existing listing." };
  const existingRaw = String(body.existing || "").trim();
  const existing = oneLine(body.existing, 300);
  if (intent === "update") {
    if (!existingRaw) return { error: "Enter the current listing URL or restaurant name." };
    if (!existing) return { error: "Keep the current listing under 300 characters." };
  } else if (existingRaw && !existing) {
    return { error: "Keep the current listing under 300 characters." };
  }
  const restaurantRaw = String(body.restaurant || "").trim();
  const restaurant = oneLine(body.restaurant, 160);
  if (!restaurantRaw) return { error: "Enter the restaurant name." };
  if (!restaurant) return { error: "Keep the restaurant name under 160 characters." };
  const areaSlug = oneLine(body.area, 80);
  const area = listingOptions.areas.find((item) => item.slug === areaSlug);
  if (!area) return { error: "Choose an area." };
  const addressRaw = String(body.address || "").trim();
  const address = oneLine(body.address, 200);
  if (!addressRaw) return { error: "Enter the street address." };
  if (!address) return { error: "Keep the street address under 200 characters." };
  const phone = phoneField(body.phone, {
    required: true,
    missing: "Enter the restaurant phone.",
    invalid: "Enter a valid restaurant phone.",
    label: "restaurant phone",
  });
  if (phone.error) return phone;
  const website = optionalUrl(body.website, "website");
  if (website.error) return website;
  const price = String(body.price || "").trim();
  if (!listingOptions.prices.includes(price)) return { error: "Choose a price range." };
  const description = plain(body.description, 800);
  if (!description.text) return { error: "Enter a short description." };
  if (description.tooLong) return { error: "Keep the description under 800 characters." };
  const hours = {};
  for (const day of listingOptions.days) {
    const raw = String(body[day.name] || "").trim();
    const text = oneLine(body[day.name], 80);
    if (!raw) return { error: `Enter hours for ${day.label}.` };
    if (!text) return { error: `Keep ${day.label} hours under 80 characters.` };
    hours[day.name] = text;
  }
  const seasonal = plain(body.seasonal, 300);
  if (seasonal.tooLong) return { error: "Keep the seasonal note under 300 characters." };
  const cuisines = choiceList(
    body.cuisines,
    listingOptions.cuisines,
    1,
    "Choose at least one cuisine type.",
    "Choose cuisine types from the list.",
  );
  if (cuisines.error) return cuisines;
  const meals = choiceList(body.meals, listingOptions.meals, 1, "Choose at least one meal.", "Choose meals from the list.");
  if (meals.error) return meals;
  const foods = choiceList(body.foods, listingOptions.foods, 0, "", "Choose food styles from the list.");
  if (foods.error) return foods;
  const amenities = {};
  for (const item of listingOptions.amenities) {
    const answer = yesNo(body[item.name], item.label.toLowerCase());
    if (answer.error) return answer;
    amenities[item.name] = answer.value;
  }
  const urls = {};
  for (const [key, label] of [
    ["facebook", "Facebook URL"],
    ["instagram", "Instagram URL"],
    ["logoUrl", "logo URL"],
    ["listPhotoUrl", "list photo URL"],
    ["detailPhotoUrl", "detail photo URL"],
    ["videoUrl", "video URL"],
  ]) {
    const url = optionalUrl(body[key], label);
    if (url.error) return url;
    urls[key] = url.value;
  }
  const notes = plain(body.notes, 2000);
  if (notes.tooLong) return { error: "Keep the notes under 2,000 characters." };
  if (!authorizedYes(body.authorized)) return { error: "Confirm you are authorized to submit this listing." };
  return {
    value: {
      name,
      role,
      roleLabel: roleOption.label,
      email,
      yourPhone: yourPhone.value,
      bestTime: bestTime || "",
      intent,
      existing: existing || "",
      restaurant,
      area: area.slug,
      areaName: area.name,
      address,
      phone: phone.value,
      website: website.value,
      price,
      description: description.text,
      hours,
      seasonal: seasonal.text,
      cuisines: cuisines.value,
      meals: meals.value,
      foods: foods.value,
      amenities,
      ...urls,
      notes: notes.text,
      authorized: true,
    },
  };
}

export async function deliverListRestaurant(payload, env, fetchImpl = fetch) {
  const intentLabel = payload.intent === "new" ? "New listing" : "Update an existing listing";
  const hourLines = listingOptions.days.map((day) => `${day.label}: ${payload.hours[day.name]}`);
  const amenityLines = listingOptions.amenities.map((item) => `${item.label}: ${yesNoLabel(payload.amenities[item.name])}`);
  const musicNote = listingOptions.amenities.find((item) => item.name === "music");
  const text = [
    "About you",
    `Your name: ${payload.name}`,
    `Role: ${payload.roleLabel}`,
    `Email: ${payload.email}`,
    `Phone: ${showValue(payload.yourPhone)}`,
    `Best time to reach you: ${showValue(payload.bestTime)}`,
    "",
    "What is this for?",
    `Request: ${intentLabel}`,
    `Current listing: ${showValue(payload.existing)}`,
    "",
    "Basics",
    `Restaurant name: ${payload.restaurant}`,
    `Area: ${payload.areaName}`,
    `Street address: ${payload.address}`,
    `Phone: ${payload.phone}`,
    `Website: ${showValue(payload.website)}`,
    `Price range: ${payload.price}`,
    "Short description / vibe:",
    payload.description,
    "",
    "Hours",
    ...hourLines,
    `Seasonal note: ${showValue(payload.seasonal)}`,
    "",
    "What they serve",
    `Cuisine types: ${payload.cuisines.join(", ")}`,
    `Meals: ${payload.meals.join(", ")}`,
    `Food style: ${showValue(payload.foods)}`,
    "",
    "Amenities",
    ...amenityLines,
    `Live music note: ${musicNote && musicNote.note ? musicNote.note : "Seasonal / subject to change."}`,
    "",
    "Social and media",
    `Facebook URL: ${showValue(payload.facebook)}`,
    `Instagram: ${showValue(payload.instagram)}`,
    `Logo URL: ${showValue(payload.logoUrl)}`,
    `List photo URL: ${showValue(payload.listPhotoUrl)}`,
    `Detail photo URL: ${showValue(payload.detailPhotoUrl)}`,
    `Video URL: ${showValue(payload.videoUrl)}`,
    "",
    "Anything else",
    "Notes:",
    showValue(payload.notes),
    "Authorized to submit: Yes",
  ].join("\n");
  return postResend(
    env,
    {
      reply_to: payload.email,
      subject: `Eating in Destin restaurant listing: ${intentLabel}: ${payload.restaurant}`,
      text,
    },
    fetchImpl,
    "The listing could not be sent.",
  );
}

export const CANONICAL_HOST = "www.eatingindestin.com";

const ALTERNATE_HOSTS = new Set([
  "eatingindestin.com",
  "eatingindestin.352marc.workers.dev",
]);

export function canonicalRedirect(url, method = "GET") {
  const host = String(url.hostname || "").toLowerCase();
  if (!ALTERNATE_HOSTS.has(host)) return null;
  if (String(url.pathname || "").startsWith("/api/")) return null;
  const target = new URL(url.toString());
  target.protocol = "https:";
  target.hostname = CANONICAL_HOST;
  target.port = "";
  const status = method === "GET" || method === "HEAD" ? 301 : 308;
  return { location: target.toString(), status };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function thanksPage(message, status) {
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>${message} | Eating in Destin</title></head><body style="margin:0;background:#fbf7f1;color:#172421;font-family:Georgia,serif"><main style="max-width:36rem;margin:4rem auto;padding:0 1.25rem"><h1>${message}</h1><p><a href="/">Back to the guide</a></p></main></body></html>`;
  return new Response(html, {
    status,
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" },
  });
}

function clientIp(request) {
  return String(request.headers.get("cf-connecting-ip") || "").trim();
}

function rateLimited(ip) {
  // Workers set cf-connecting-ip. Requests without it are not counted so
  // local tests stay independent of each other.
  if (!ip) return false;
  const now = Date.now();
  const stamps = (recentHits.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  if (stamps.length >= MAX_PER_WINDOW) {
    recentHits.set(ip, stamps);
    return true;
  }
  stamps.push(now);
  recentHits.set(ip, stamps);
  if (recentHits.size > 1000) {
    for (const [key, times] of recentHits) {
      const fresh = times.filter((time) => now - time < WINDOW_MS);
      if (fresh.length) recentHits.set(key, fresh);
      else recentHits.delete(key);
    }
  }
  return false;
}

function honeypotFilled(data, keys) {
  if (!data || typeof data !== "object" || Array.isArray(data)) return false;
  const names = keys || ["company", "hp_field", "website"];
  return names.some((key) => {
    const raw = data[key];
    if (raw == null) return false;
    return String(raw).trim().length > 0;
  });
}

function wantsHtml(request) {
  const type = request.headers.get("content-type") || "";
  return !type.includes("application/json");
}

function rejectPost(request, error, status) {
  return wantsHtml(request) ? thanksPage(error, status) : json({ ok: false, error }, status);
}

function fakeSuccess(request, kind) {
  if (wantsHtml(request)) {
    const message = kind === "restaurant"
      ? "Thanks. We have your listing."
      : kind === "listing"
        ? "Thanks. We have your note."
        : "Thanks. We have your signup.";
    return thanksPage(message, 200);
  }
  if (kind === "subscribe") return json({ ok: true, delivered: false, recorded: false }, 200);
  return json({ ok: true, delivered: false }, 200);
}

function tooLongMessage(kind) {
  if (kind === "restaurant") return "That listing is too long.";
  if (kind === "listing") return "That request is too long.";
  return "That signup is too long.";
}

function unreadableMessage(kind) {
  if (kind === "restaurant") return "Send the listing as JSON.";
  if (kind === "listing") return "Send the request as JSON.";
  return "Send the signup as JSON.";
}

async function readFields(request, kind, options = {}) {
  const maxBody = options.maxBody || MAX_BODY;
  const lengthHeader = Number(request.headers.get("content-length") || 0);
  if (Number.isFinite(lengthHeader) && lengthHeader > maxBody) {
    return { response: rejectPost(request, tooLongMessage(kind), 413) };
  }
  if (rateLimited(clientIp(request))) {
    return { response: rejectPost(request, "Please wait a minute and try again.", 429) };
  }
  let raw = "";
  try {
    raw = await request.text();
  } catch {
    return { response: rejectPost(request, unreadableMessage(kind), 400) };
  }
  if (raw.length > maxBody) {
    return { response: rejectPost(request, tooLongMessage(kind), 413) };
  }

  const html = wantsHtml(request);
  let data;
  if (!html) {
    try {
      data = raw.trim() ? JSON.parse(raw) : null;
    } catch {
      return { response: rejectPost(request, unreadableMessage(kind), 400) };
    }
  } else {
    const params = new URLSearchParams(raw);
    data = {};
    for (const key of new Set(params.keys())) {
      const all = params.getAll(key);
      data[key] = all.length > 1 ? all : all[0];
    }
  }
  if (honeypotFilled(data, options.honeypotKeys)) return { response: fakeSuccess(request, kind) };

  if (kind === "listing") return { html, parsed: parseListing(data) };
  if (kind === "restaurant") return { html, parsed: parseListRestaurant(data) };
  const body = data && typeof data === "object" && !Array.isArray(data)
    ? {
        email: data.email,
        audience: data.audience,
        coupons: html ? data.coupons === "yes" : Boolean(data.coupons),
      }
    : data;
  return { html, parsed: parseSubscribe(body) };
}

export async function handleSubscribe(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const read = await readFields(request, "subscribe");
  if (read.response) return read.response;
  const { html, parsed } = read;
  if (parsed.error) {
    return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  }
  const result = await deliverSubscribe(parsed.value, env, fetchImpl);
  if (!result.ok) {
    return html ? thanksPage(result.error, 502) : json(result, 502);
  }
  return html ? thanksPage("Thanks. We have your signup.", 200) : json(result, 200);
}

export async function handleListing(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const read = await readFields(request, "listing");
  if (read.response) return read.response;
  const { html, parsed } = read;
  if (parsed.error) {
    return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  }
  const result = await deliverListing(parsed.value, env, fetchImpl);
  if (!result.ok) {
    return html ? thanksPage(result.error, 502) : json(result, 502);
  }
  return html ? thanksPage("Thanks. We have your note.", 200) : json(result, 200);
}

export async function handleListRestaurant(request, env, fetchImpl = fetch) {
  if (request.method !== "POST") return json({ ok: false, error: "Use POST." }, 405);
  const read = await readFields(request, "restaurant", {
    maxBody: MAX_RESTAURANT_BODY,
    honeypotKeys: ["company", "hp_field"],
  });
  if (read.response) return read.response;
  const { html, parsed } = read;
  if (parsed.error) {
    return html ? thanksPage(parsed.error, 400) : json({ ok: false, error: parsed.error }, 400);
  }
  const result = await deliverListRestaurant(parsed.value, env, fetchImpl);
  if (!result.ok) {
    return html ? thanksPage(result.error, 502) : json(result, 502);
  }
  return html ? thanksPage("Thanks. We have your listing.", 200) : json(result, 200);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const redirect = canonicalRedirect(url, request.method);
    if (redirect) {
      return new Response(null, {
        status: redirect.status,
        headers: {
          location: redirect.location,
          "cache-control": "public, max-age=3600",
        },
      });
    }
    if (url.pathname === "/api/subscribe") return handleSubscribe(request, env);
    if (url.pathname === "/api/listing") return handleListing(request, env);
    if (url.pathname === "/api/list-restaurant") return handleListRestaurant(request, env);
    return env.ASSETS.fetch(request);
  },
};
