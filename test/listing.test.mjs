import assert from "node:assert/strict";
import test from "node:test";
import worker, { deliverListing, handleListing, parseListing } from "../worker.js";

const note = {
  restaurant: "Bud & Alley's",
  type: "update",
  details: "The phone number on the page is out of date.",
  name: "Jamie Cook",
  email: "jamie@example.com",
};

test("parseListing requires a known request type, details, a name, and an email", () => {
  assert.equal(parseListing({}).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe" }).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "closed" }).error, "Choose update, edit, deletion, new listing, or other.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "edit" }).error, "Tell us what should change.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "edit", details: "Hours" }).error, "Enter your name.");
  assert.equal(parseListing({ restaurant: "Cafe", type: "new", details: "Add it", name: "Jamie", email: "nope" }).error, "Enter a valid email.");
  assert.equal(parseListing({ ...note, details: "x".repeat(4001) }).error, "Keep the details under 4,000 characters.");
  assert.equal(parseListing({ ...note, restaurant: "x".repeat(161) }).error, "Keep the restaurant name under 160 characters.");
  assert.deepEqual(parseListing(note).value, { ...note, town: "" });
  assert.deepEqual(parseListing({ ...note, town: "" }).value, { ...note, town: "" });
  assert.deepEqual(parseListing({ ...note, town: "Seaside" }).value, { ...note, town: "Seaside" });
  const question = {
    restaurant: "",
    type: "other",
    details: "Do you cover food trucks?",
    name: "Jamie Cook",
    email: "jamie@example.com",
  };
  assert.deepEqual(parseListing(question).value, { ...question, town: "" });
  assert.deepEqual(parseListing({ ...question, restaurant: "   " }).value, { ...question, town: "" });
});

test("missing secrets accept the listing note and do not call Resend", async () => {
  let called = false;
  const result = await deliverListing(note, { RESEND_API_KEY: "key-only" }, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false });
});

test("all three secrets post the listing note to CONTACT_EMAIL", async () => {
  let url = "";
  let init = null;
  const result = await deliverListing(
    { ...note, type: "deletion", town: "" },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating in Destin <listings@example.com>",
    },
    (nextUrl, nextInit) => {
      url = nextUrl;
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(url, "https://api.resend.com/emails");
  const body = JSON.parse(init.body);
  assert.equal(body.from, "Eating in Destin <listings@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.equal(body.reply_to, "jamie@example.com");
  assert.match(body.subject, /Deletion/);
  assert.match(body.subject, /Bud & Alley's/);
  assert.match(body.text, /Restaurant: Bud & Alley's/);
  assert.match(body.text, /Town: Not specified/);
  assert.match(body.text, /Jamie Cook/);
  assert.match(body.text, /phone number/);
});

test("an Other request can omit the restaurant name", async () => {
  let init = null;
  const result = await deliverListing(
    { ...note, restaurant: "", type: "other", details: "Do you cover food trucks?" },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating in Destin <listings@example.com>",
    },
    (_url, nextInit) => {
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  const body = JSON.parse(init.body);
  assert.match(body.subject, /Other — Not specified/);
  assert.match(body.text, /Request: Other/);
  assert.match(body.text, /Restaurant: Not specified/);
  assert.match(body.text, /food trucks/);
});

test("a Resend error on a listing note is not reported as delivered", async () => {
  const result = await deliverListing(
    note,
    { RESEND_API_KEY: "re_test", CONTACT_EMAIL: "marc@example.com", SUBSCRIBE_FROM: "from@example.com" },
    () => Promise.resolve(new Response("no", { status: 422 })),
  );
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.error, "The request could not be sent.");
});

test("POST JSON without secrets returns delivered false", async () => {
  const request = new Request("https://eatingindestin.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  const response = await handleListing(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false });
});

test("a non-POST listing request is rejected", async () => {
  const request = new Request("https://eatingindestin.example/api/listing");
  const response = await handleListing(request, {});
  assert.equal(response.status, 405);
});

test("a listing form post returns an HTML thanks page", async () => {
  const request = new Request("https://eatingindestin.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams(note),
  });
  const response = await handleListing(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your note\./);
});

test("the worker routes /api/listing without touching static assets", async () => {
  let assets = false;
  const request = new Request("https://eatingindestin.example/api/listing", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(note),
  });
  const response = await worker.fetch(request, {
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

const mailEnv = {
  RESEND_API_KEY: "re_test",
  CONTACT_EMAIL: "marc@example.com",
  SUBSCRIBE_FROM: "Eating in Destin <listings@example.com>",
};

function postNote(body, ip) {
  return new Request("https://www.eatingindestin.com/api/listing", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("a filled honeypot looks successful and does not send the listing note", async () => {
  let called = false;
  const response = await handleListing(
    postNote({ ...note, company: "Acme Bots" }, "198.51.100.20"),
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

test("a honeypot on an incomplete listing note still looks successful", async () => {
  let called = false;
  const response = await handleListing(
    postNote({ hp_field: "bot" }, "198.51.100.21"),
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

test("a blank honeypot still sends the listing note", async () => {
  let called = false;
  const response = await handleListing(
    postNote({ ...note, company: "" }, "198.51.100.22"),
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

test("a filled honeypot on a listing form post returns the HTML thanks page", async () => {
  let called = false;
  const request = new Request("https://www.eatingindestin.com/api/listing", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "198.51.100.23",
    },
    body: new URLSearchParams({ ...note, company: "Acme Bots" }),
  });
  const response = await handleListing(request, mailEnv, () => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your note\./);
});

test("an oversized listing note is rejected before mail is sent", async () => {
  let called = false;
  const body = JSON.stringify({ ...note, details: "x".repeat(16000) });
  assert.ok(body.length > 16000);
  const response = await handleListing(postNote(body, "198.51.100.24"), mailEnv, () => {
    called = true;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(called, false);
  assert.equal(response.status, 413);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /too long/i);
});

test("the sixth listing note from one IP in a minute is rate limited", async () => {
  const ip = "198.51.100.25";
  let calls = 0;
  const send = () => handleListing(postNote(note, ip), mailEnv, () => {
    calls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await send();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, delivered: true });
  }
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /wait a minute/i);
  assert.equal(calls, 5);
  const other = await handleListing(postNote(note, "198.51.100.26"), mailEnv, () => {
    calls += 1;
    return Promise.resolve(new Response("{}", { status: 200 }));
  });
  assert.equal(other.status, 200);
  assert.equal(calls, 6);
});
