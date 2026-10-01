import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import listingOptions from "../data/listing-options.json" with { type: "json" };
import worker, { deliverListRestaurant, handleListRestaurant, handleListing, parseListRestaurant } from "../worker.js";

const restaurants = JSON.parse(readFileSync(new URL("../data/restaurants.json", import.meta.url), "utf8"));
const locations = JSON.parse(readFileSync(new URL("../data/locations.json", import.meta.url), "utf8"));

function sample(overrides = {}) {
  const body = {
    name: "Jamie Cook",
    role: "manager",
    email: "jamie@example.com",
    yourPhone: "(850) 555-0199",
    bestTime: "Weekday mornings",
    intent: "update",
    existing: "https://www.eatingindestin.com/restaurants/harbor-docks-destin-harbor/",
    restaurant: "Harbor Docks",
    area: "destin-harbor",
    address: "538 Harbor Blvd, Destin, FL 32541",
    phone: "(850) 837-2506",
    website: "https://www.harbordocks.com/",
    price: "$$",
    description: "Waterfront seafood on the harbor.",
    seasonal: "Winter hours can run shorter.",
    cuisines: ["Seafood", "American"],
    meals: ["Lunch", "Dinner", "Late night"],
    foods: ["Seafood", "Oyster Bar"],
    facebook: "https://www.facebook.com/harbordocks",
    instagram: "https://www.instagram.com/harbordocks/",
    logoUrl: "https://example.com/logo.png",
    listPhotoUrl: "https://example.com/list.jpg",
    detailPhotoUrl: "https://example.com/detail.jpg",
    videoUrl: "",
    notes: "Use the dock photo.",
    authorized: true,
    outdoor: "yes",
    happyDrinks: "yes",
    happyFood: "no",
    reservations: "yes",
    kids: "yes",
    groups: "no",
    music: "yes",
    mon: "11am to 10pm",
    tue: "11am to 10pm",
    wed: "11am to 10pm",
    thu: "11am to 10pm",
    fri: "11am to 11pm",
    sat: "11am to 11pm",
    sun: "Closed",
  };
  return { ...body, ...overrides };
}

const mailEnv = {
  RESEND_API_KEY: "re_test",
  CONTACT_EMAIL: "marc@example.com",
  SUBSCRIBE_FROM: "Eating in Destin <listings@example.com>",
};

function postJson(body, ip = "203.0.113.10") {
  return new Request("https://www.eatingindestin.com/api/list-restaurant", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("listing options stay aligned with the published restaurants and areas", () => {
  const cuisines = [...new Set(restaurants.flatMap((item) => item.cuisines))].sort();
  const foods = [...new Set(restaurants.flatMap((item) => item.foods))].sort();
  assert.deepEqual(listingOptions.cuisines, cuisines);
  assert.deepEqual(listingOptions.foods, foods);
  assert.deepEqual(
    listingOptions.areas,
    locations.map((area) => ({ slug: area.slug, name: area.name })),
  );
  assert.deepEqual(listingOptions.meals, ["Breakfast", "Brunch", "Lunch", "Dinner", "Late night"]);
  assert.equal(listingOptions.amenities.find((item) => item.name === "music").note, "Seasonal / subject to change.");
});

test("parseListRestaurant requires the fields a listing stores", () => {
  assert.equal(parseListRestaurant(null).error, "Send the listing as JSON.");
  assert.equal(parseListRestaurant({}).error, "Enter your name.");
  assert.equal(parseListRestaurant(sample({ role: "chef" })).error, "Choose owner, manager, marketing, or other.");
  assert.equal(parseListRestaurant(sample({ email: "nope" })).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(sample({ intent: "edit" })).error, "Choose new listing or update an existing listing.");
  assert.equal(parseListRestaurant(sample({ existing: "" })).error, "Enter the current listing URL or restaurant name.");
  assert.equal(parseListRestaurant(sample({ intent: "new", existing: "" })).value.intent, "new");
  assert.equal(parseListRestaurant(sample({ area: "seaside" })).error, "Choose an area.");
  assert.equal(parseListRestaurant(sample({ price: "free" })).error, "Choose a price range.");
  assert.equal(parseListRestaurant(sample({ phone: "call us" })).error, "Enter a valid restaurant phone.");
  assert.equal(parseListRestaurant(sample({ website: "harbordocks.com" })).error, "Enter a full website starting with https://.");
  assert.equal(parseListRestaurant(sample({ cuisines: ["Not a cuisine"] })).error, "Choose cuisine types from the list.");
  assert.equal(parseListRestaurant(sample({ meals: [] })).error, "Choose at least one meal.");
  assert.equal(parseListRestaurant(sample({ meals: ["Desserts"] })).error, "Choose meals from the list.");
  assert.equal(parseListRestaurant(sample({ mon: "" })).error, "Enter hours for Monday.");
  assert.equal(parseListRestaurant(sample({ music: "" })).error, "Choose yes or no for live music.");
  assert.equal(parseListRestaurant(sample({ authorized: false })).error, "Confirm you are authorized to submit this listing.");
  const parsed = parseListRestaurant(sample({ foods: [] }));
  assert.deepEqual(parsed.value.foods, []);
  assert.equal(parsed.value.areaName, "Destin Harbor");
  assert.equal(parsed.value.roleLabel, "Manager");
  assert.deepEqual(parsed.value.meals, ["Lunch", "Dinner", "Late night"]);
});

test("all three secrets email every labeled field", async () => {
  let init = null;
  const result = await deliverListRestaurant(parseListRestaurant(sample()).value, mailEnv, (url, nextInit) => {
    init = nextInit;
    assert.equal(url, "https://api.resend.com/emails");
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  const body = JSON.parse(init.body);
  assert.equal(body.from, "Eating in Destin <listings@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.equal(body.reply_to, "jamie@example.com");
  assert.equal(body.subject, "Eating in Destin restaurant listing: Update an existing listing: Harbor Docks");
  for (const line of [
    "Your name: Jamie Cook",
    "Role: Manager",
    "Email: jamie@example.com",
    "Phone: (850) 555-0199",
    "Best time to reach you: Weekday mornings",
    "Request: Update an existing listing",
    "Current listing: https://www.eatingindestin.com/restaurants/harbor-docks-destin-harbor/",
    "Restaurant name: Harbor Docks",
    "Area: Destin Harbor",
    "Street address: 538 Harbor Blvd, Destin, FL 32541",
    "Phone: (850) 837-2506",
    "Website: https://www.harbordocks.com/",
    "Price range: $$",
    "Waterfront seafood on the harbor.",
    "Monday: 11am to 10pm",
    "Sunday: Closed",
    "Seasonal note: Winter hours can run shorter.",
    "Cuisine types: Seafood, American",
    "Meals: Lunch, Dinner, Late night",
    "Food style: Seafood, Oyster Bar",
    "Outdoor dining: Yes",
    "Happy hour (drinks): Yes",
    "Happy hour (food): No",
    "Reservations: Yes",
    "Kid friendly: Yes",
    "Groups of 12+: No",
    "Live music: Yes",
    "Live music note: Seasonal / subject to change.",
    "Facebook URL: https://www.facebook.com/harbordocks",
    "Instagram: https://www.instagram.com/harbordocks/",
    "Logo URL: https://example.com/logo.png",
    "List photo URL: https://example.com/list.jpg",
    "Detail photo URL: https://example.com/detail.jpg",
    "Video URL: Not provided",
    "Use the dock photo.",
    "Authorized to submit: Yes",
  ]) {
    assert.ok(body.text.includes(line), line);
  }
});

test("a new listing can leave the current listing blank", async () => {
  let init = null;
  const result = await deliverListRestaurant(
    parseListRestaurant(sample({ intent: "new", existing: "", yourPhone: "", bestTime: "", notes: "" })).value,
    mailEnv,
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.delivered, true);
  const body = JSON.parse(init.body);
  assert.match(body.subject, /New listing: Harbor Docks/);
  assert.match(body.text, /Current listing: Not provided/);
  assert.match(body.text, /Best time to reach you: Not provided/);
  assert.match(body.text, /Notes:\nNot provided/);
});

test("missing secrets accept the restaurant form and do not call Resend", async () => {
  let called = false;
  const result = await deliverListRestaurant(parseListRestaurant(sample()).value, {}, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false });
});

test("a Resend error on the restaurant form is not reported as delivered", async () => {
  const result = await deliverListRestaurant(parseListRestaurant(sample()).value, mailEnv, () => Promise.resolve(new Response("no", { status: 422 })));
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.error, "The listing could not be sent.");
});

test("a restaurant website is emailed and is not treated as the honeypot", async () => {
  let called = false;
  const response = await handleListRestaurant(
    postJson({ ...sample(), company: "", website: "https://www.harbordocks.com/" }, "203.0.113.20"),
    mailEnv,
    () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true });
});

test("a filled honeypot on the restaurant form looks successful and is not emailed", async () => {
  let called = false;
  const response = await handleListRestaurant(
    postJson({ ...sample(), company: "Acme Bots", website: "https://example.com" }, "203.0.113.21"),
    mailEnv,
    () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("an HTML form post keeps repeated cuisine and meal values", async () => {
  const fields = sample({ authorized: "yes", company: "" });
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => params.append(key, item));
    else params.append(key, value);
  }
  let init = null;
  const response = await handleListRestaurant(
    new Request("https://www.eatingindestin.com/api/list-restaurant", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.22" },
      body: params,
    }),
    mailEnv,
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your listing\./);
  const mailed = JSON.parse(init.body);
  assert.match(mailed.text, /Cuisine types: Seafood, American/);
  assert.match(mailed.text, /Meals: Lunch, Dinner, Late night/);
  assert.match(mailed.text, /Live music note: Seasonal \/ subject to change\./);
});

test("a restaurant form over 32 KB is rejected before mail is sent", async () => {
  let called = false;
  const body = JSON.stringify(sample({ notes: "x".repeat(33000) }));
  assert.ok(body.length > 32000);
  const response = await handleListRestaurant(postJson(body, "203.0.113.23"), mailEnv, () => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(called, false);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too long/i);
});

test("a long restaurant note under the body cap is validated instead of rejected as too large", async () => {
  const body = JSON.stringify(sample({ notes: "x".repeat(20000) }));
  assert.ok(body.length > 16000 && body.length < 32000);
  const response = await handleListRestaurant(postJson(body, "203.0.113.24"), mailEnv, () => Promise.resolve(new Response("{}", { status: 200 })));
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Keep the notes under 2,000 characters.");
});

test("the sixth form post from one IP in a minute is rate limited across both listing forms", async () => {
  const ip = "203.0.113.25";
  let calls = 0;
  const sendRestaurant = () => handleListRestaurant(postJson(sample(), ip), mailEnv, () => {
    calls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  const note = {
    restaurant: "Harbor Docks",
    type: "update",
    details: "Hours changed.",
    name: "Jamie Cook",
    email: "jamie@example.com",
  };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    assert.equal((await sendRestaurant()).status, 200);
  }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await handleListing(
      new Request("https://www.eatingindestin.com/api/listing", {
        method: "POST",
        headers: { "content-type": "application/json", "cf-connecting-ip": ip },
        body: JSON.stringify(note),
      }),
      mailEnv,
      () => {
        calls += 1;
        return Promise.resolve(new Response("{}", { status: 200 }));
      },
    );
    assert.equal(response.status, 200);
  }
  const blocked = await sendRestaurant();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /wait a minute/i);
  assert.equal(calls, 5);
});

test("the worker routes /api/list-restaurant without touching static assets", async () => {
  let assets = false;
  const response = await worker.fetch(postJson(sample(), "203.0.113.26"), {
    ASSETS: {
      fetch() {
        assets = true;
        return Promise.resolve(new Response("asset"));
      },
    },
  });
  assert.equal(assets, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("a non-POST restaurant request is rejected", async () => {
  const response = await handleListRestaurant(new Request("https://www.eatingindestin.com/api/list-restaurant"), {});
  assert.equal(response.status, 405);
});
