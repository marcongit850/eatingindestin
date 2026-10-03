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

test("parseListRestaurant requires a name and email and lets every other field stay blank", () => {
  assert.equal(parseListRestaurant(null).error, "Send the listing as JSON.");
  assert.equal(parseListRestaurant({}).error, "Enter your name.");
  assert.equal(parseListRestaurant({ name: "Jamie Cook" }).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(sample({ role: "chef" })).error, "Choose owner, manager, marketing, or other.");
  assert.equal(parseListRestaurant(sample({ email: "nope" })).error, "Enter a valid email.");
  assert.equal(parseListRestaurant(sample({ intent: "edit" })).error, "Choose new listing or update an existing listing.");
  assert.equal(parseListRestaurant(sample({ existing: "" })).value.existing, "");
  assert.equal(parseListRestaurant(sample({ intent: "new", existing: "" })).value.intent, "new");
  assert.equal(parseListRestaurant(sample({ area: "seaside" })).error, "Choose an area.");
  assert.equal(parseListRestaurant(sample({ area: "" })).value.area, "");
  assert.equal(parseListRestaurant(sample({ price: "free" })).error, "Choose a price range.");
  assert.equal(parseListRestaurant(sample({ price: "" })).value.price, "");
  assert.equal(parseListRestaurant(sample({ phone: "call us" })).error, "Enter a valid restaurant phone.");
  assert.equal(parseListRestaurant(sample({ phone: "" })).value.phone, "");
  assert.equal(parseListRestaurant(sample({ website: "harbordocks.com" })).error, "Enter a full website starting with https://.");
  assert.equal(parseListRestaurant(sample({ cuisines: ["Not a cuisine"] })).error, "Choose cuisine types from the list.");
  assert.deepEqual(parseListRestaurant(sample({ meals: [] })).value.meals, []);
  assert.equal(parseListRestaurant(sample({ meals: ["Desserts"] })).error, "Choose meals from the list.");
  assert.equal(parseListRestaurant(sample({ mon: "" })).value.hours.mon, "");
  assert.equal(parseListRestaurant(sample({ music: "" })).value.amenities.music, "");
  assert.equal(parseListRestaurant(sample({ music: "maybe" })).error, "Choose yes or no for live music.");
  assert.equal(parseListRestaurant(sample({ authorized: false })).value.authorized, false);
  const parsed = parseListRestaurant(sample({ foods: [] }));
  assert.deepEqual(parsed.value.foods, []);
  assert.equal(parsed.value.areaName, "Destin Harbor");
  assert.equal(parsed.value.roleLabel, "Manager");
  assert.deepEqual(parsed.value.meals, ["Lunch", "Dinner", "Late night"]);
  const bare = parseListRestaurant({ name: "Jamie Cook", email: "jamie@example.com" });
  assert.equal(bare.value.restaurant, "");
  assert.equal(bare.value.intent, "");
  assert.equal(bare.value.role, "");
  assert.equal(bare.value.description, "");
  assert.deepEqual(bare.value.cuisines, []);
  assert.equal(bare.value.authorized, false);
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
    "Video URL: Not provided",
    "Images: Not provided",
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

test("a name and email are enough to send the listing email", async () => {
  let init = null;
  const response = await handleListRestaurant(
    postJson({ name: "Jamie Cook", email: "jamie@example.com" }, "203.0.113.27"),
    mailEnv,
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true });
  const body = JSON.parse(init.body);
  assert.equal(body.reply_to, "jamie@example.com");
  assert.equal(body.subject, "Eating in Destin restaurant listing: Not provided: Not provided");
  for (const line of [
    "Your name: Jamie Cook",
    "Role: Not provided",
    "Email: jamie@example.com",
    "Request: Not provided",
    "Restaurant name: Not provided",
    "Area: Not provided",
    "Street address: Not provided",
    "Phone: Not provided",
    "Price range: Not provided",
    "Short description / vibe:\nNot provided",
    "Monday: Not provided",
    "Cuisine types: Not provided",
    "Meals: Not provided",
    "Outdoor dining: Not provided",
    "Live music: Not provided",
    "Images: Not provided",
    "Authorized to submit: Not provided",
  ]) {
    assert.ok(body.text.includes(line), line);
  }
  assert.equal(body.attachments, undefined);
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
  assert.match(await response.text(), /Thanks!  We will review and get back to you shortly\./);
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

const PNG_1X1 = Uint8Array.from(Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
));

function imageFile(name, type, bytes) {
  return new File([bytes], name, { type });
}

function jpegBytes(size) {
  const bytes = new Uint8Array(size);
  bytes[0] = 0xff;
  bytes[1] = 0xd8;
  bytes[2] = 0xff;
  return bytes;
}

function postMultipart(files, ip, overrides = {}, accept = "application/json") {
  const fields = sample({ company: "", authorized: "yes", ...overrides });
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) value.forEach((item) => form.append(key, String(item)));
    else form.append(key, value == null ? "" : String(value));
  }
  for (const file of files) form.append("photos", file, file.name);
  const headers = { "cf-connecting-ip": ip };
  if (accept) headers.accept = accept;
  return new Request("https://www.eatingindestin.com/api/list-restaurant", {
    method: "POST",
    headers,
    body: form,
  });
}

test("listing images are attached to the same email and are not stored", async () => {
  let init = null;
  const png = imageFile("Harbor Logo.PNG", "image/png", PNG_1X1);
  const webp = imageFile("patio.webp", "image/webp", Uint8Array.from([
    0x52, 0x49, 0x46, 0x46, 0x1a, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    0x56, 0x50, 0x38, 0x20, 0x0a, 0x00, 0x00, 0x00,
  ]));
  const response = await handleListRestaurant(
    postMultipart([png, webp], "203.0.113.40"),
    mailEnv,
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true });
  const body = JSON.parse(init.body);
  assert.match(body.text, /Images: Harbor-Logo\.png, patio\.webp/);
  assert.doesNotMatch(body.text, /Logo URL|List photo URL|Detail photo URL/);
  assert.equal(body.attachments.length, 2);
  assert.equal(body.attachments[0].filename, "Harbor-Logo.png");
  assert.equal(body.attachments[0].content_type, "image/png");
  assert.deepEqual(Buffer.from(body.attachments[0].content, "base64"), Buffer.from(PNG_1X1));
  assert.equal(body.attachments[1].filename, "patio.webp");
  assert.equal(body.attachments[1].content_type, "image/webp");
});

test("a browser form post without JavaScript still attaches the images", async () => {
  let init = null;
  const response = await handleListRestaurant(
    postMultipart([imageFile("logo.jpg", "image/jpeg", jpegBytes(40000))], "203.0.113.41", {}, ""),
    mailEnv,
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks!  We will review and get back to you shortly\./);
  const body = JSON.parse(init.body);
  assert.match(body.text, /Images: logo\.jpg/);
  assert.equal(body.attachments[0].content_type, "image/jpeg");
});

test("the wrong image type is rejected and not emailed", async () => {
  let called = false;
  const gif = imageFile("menu.gif", "image/gif", Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]));
  const spoofed = imageFile("logo.png", "image/png", Uint8Array.from([0x3c, 0x68, 0x74, 0x6d, 0x6c, 0x3e]));
  for (const [file, ip] of [[gif, "203.0.113.42"], [spoofed, "203.0.113.43"]]) {
    const response = await handleListRestaurant(postMultipart([file], ip), mailEnv, () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error, "Use a JPEG, PNG, or WebP image.");
  }
  assert.equal(called, false);
});

test("an image over 2 MB is rejected before mail is sent", async () => {
  let called = false;
  const response = await handleListRestaurant(
    postMultipart([imageFile("cover.jpg", "image/jpeg", jpegBytes(2 * 1024 * 1024 + 1))], "203.0.113.44"),
    mailEnv,
    () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Each image must be 2 MB or smaller.");
});

test("too many images are rejected", async () => {
  const files = Array.from({ length: 7 }, (_, index) => imageFile(`photo-${index}.jpg`, "image/jpeg", jpegBytes(32)));
  const response = await handleListRestaurant(postMultipart(files, "203.0.113.45"), mailEnv, () => {
    throw new Error("mail should not be sent");
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Attach up to 6 images.");
});

test("images over 6 MB together are rejected", async () => {
  const files = [
    imageFile("one.jpg", "image/jpeg", jpegBytes(2 * 1024 * 1024)),
    imageFile("two.jpg", "image/jpeg", jpegBytes(2 * 1024 * 1024)),
    imageFile("three.jpg", "image/jpeg", jpegBytes(2 * 1024 * 1024)),
    imageFile("four.jpg", "image/jpeg", jpegBytes(32)),
  ];
  const response = await handleListRestaurant(postMultipart(files, "203.0.113.46"), mailEnv, () => {
    throw new Error("mail should not be sent");
  });
  assert.equal(response.status, 400);
  assert.equal((await response.json()).error, "Keep the images to 6 MB or less together.");
});

test("a filled honeypot with images looks successful and is not emailed", async () => {
  let called = false;
  const response = await handleListRestaurant(
    postMultipart([imageFile("logo.png", "image/png", PNG_1X1)], "203.0.113.47", { company: "Acme Bots" }),
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

test("a multipart restaurant body over 7 MB is rejected before mail is sent", async () => {
  let called = false;
  const response = await handleListRestaurant(
    new Request("https://www.eatingindestin.com/api/list-restaurant", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=----listing",
        "content-length": String(7 * 1024 * 1024 + 1),
        accept: "application/json",
        "cf-connecting-ip": "203.0.113.48",
      },
      body: "----listing--",
    }),
    mailEnv,
    () => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 413);
  assert.match((await response.json()).error, /too long/i);
});
