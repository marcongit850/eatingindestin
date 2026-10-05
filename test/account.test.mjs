import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleAccount } from "../account-api.js";
import worker from "../worker.js";

const origin = "https://www.eatingindestin.com";

function envWith(fetchImpl) {
  return {
    ACCOUNT_SITE: "destin",
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_ORIGIN: "https://eating-accounts.352marc.workers.dev",
    ACCOUNTS: { fetch: fetchImpl },
  };
}

test("sign-in coupon checkboxes are off unless the visitor checks them", () => {
  const html = readFileSync(new URL("../account/index.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const coupons30a = html.match(/<input name="coupons30a"[^>]*>/);
  const couponsDestin = html.match(/<input name="couponsDestin"[^>]*>/);
  assert.ok(coupons30a, "30A coupon checkbox should be on the sign-in page");
  assert.ok(couponsDestin, "Destin coupon checkbox should be on the sign-in page");
  assert.equal(coupons30a[0].includes("checked"), false);
  assert.equal(couponsDestin[0].includes("checked"), false);
  assert.equal(html.includes('name="marketing"'), false);
  assert.match(html, /Email me coupons and updates from Eating on 30A\./);
  assert.match(html, /Email me coupons and updates from Eating in Destin\./);
  assert.match(html, /Leave both unchecked if you only want the sign-in link\./);
  assert.match(client, /coupons30a: coupons30a/);
  assert.match(client, /couponsDestin: couponsDestin/);
  assert.match(client, /marketingOptIn: coupons30a \|\| couponsDestin/);
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("–"), false);
  assert.match(html, /gtag\('config', 'G-ZW0KS7V7QV'\)/);
  assert.equal(html.includes("2157446775153374"), false);
});

test("list and grid cards reuse the listing save controls", () => {
  const js = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  assert.match(js, /\.card\[data-slug\]\[data-name\], \.map-hit\[data-slug\]\[data-name\]/);
  assert.match(js, /data-place-area/);
  assert.match(js, /method: "PUT"/);
  assert.match(js, /\/api\/account\/saves/);
  assert.match(js, /\/account\/\?next=/);
  assert.match(js, /MutationObserver/);
  assert.equal(js.includes("—"), false);
  assert.equal(js.includes("–"), false);
});

test("my places page names both guides", () => {
  const html = readFileSync(new URL("../my-places/index.html", import.meta.url), "utf8");
  assert.match(html, /data-tab="favorite"/);
  assert.match(html, /data-tab="want"/);
  assert.match(html, /data-site-filter="30a"/);
  assert.match(html, /data-site-filter="destin"/);
  assert.match(html, /Each card is labeled 30A or Destin/);
  assert.equal(html.includes("—"), false);
});

test("destin requests stay on this guide and do not opt in by default", async () => {
  const calls = [];
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": "203.0.113.8" },
    body: JSON.stringify({ email: "guest@example.com", next: "/restaurants/harbor-docks-destin-harbor/" }),
  }), envWith((request) => {
    calls.push(request);
    return Promise.resolve(new Response(JSON.stringify({ ok: true, delivered: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  }));
  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(new URL(calls[0].url).pathname, "/v1/magic-link");
  assert.equal(calls[0].headers.get("authorization"), "Bearer test-secret");
  assert.equal(calls[0].headers.get("x-account-site"), "destin");
  assert.equal(calls[0].headers.get("x-forwarded-for"), "203.0.113.8");
  const body = await calls[0].json();
  assert.equal(body.site, "destin");
  assert.equal(body.marketingOptIn, false);
  assert.equal(body.returnTo, `${origin}/api/account/finish?next=%2Frestaurants%2Fharbor-docks-destin-harbor%2F`);
});

test("a checked marketing box is forwarded as an opt-in and does not write a sheet", async () => {
  let body = null;
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", marketingOptIn: true }),
  }), sheetEnv(async (request) => {
    body = await request.json();
    return new Response(JSON.stringify({ ok: true, delivered: true }), { status: 200 });
  }), () => {
    throw new Error("legacy opt-in should not write a sheet");
  });
  assert.equal(response.status, 200);
  assert.equal(body.marketingOptIn, true);
  assert.equal(body.site, "destin");
});

const sheetUrl = "https://script.google.com/macros/s/example/exec";

function sheetEnv(fetchImpl, extra = {}) {
  return {
    ...envWith(fetchImpl),
    GOOGLE_SHEETS_WEBHOOK_URL: sheetUrl,
    GOOGLE_SHEETS_WEBHOOK_TOKEN: "destin-token",
    GOOGLE_SHEETS_WEBHOOK_TOKEN_30A: "thirty-token",
    RESEND_API_KEY: "re_test",
    CONTACT_EMAIL: "marc@example.com",
    SUBSCRIBE_FROM: "Eating in Destin <coupons@example.com>",
    ...extra,
  };
}

function acceptedAccounts() {
  return () => Promise.resolve(new Response(JSON.stringify({ ok: true, delivered: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

async function requestCoupons(body, env, fetchImpl = () => {
  throw new Error("sheet should not be called");
}) {
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "Guest@example.com", next: "/my-places/", ...body }),
  }), env, fetchImpl);
  return { response, payload: await response.json() };
}

test("checked coupon boxes opt in and append one sheet row per guide", async () => {
  const sheets = [];
  const { response, payload } = await requestCoupons(
    { coupons30a: true, couponsDestin: true, marketingOptIn: true },
    sheetEnv(acceptedAccounts()),
    async (url, init) => {
      sheets.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, delivered: true });
  assert.deepEqual(sheets.map((call) => call.url), [sheetUrl, sheetUrl]);
  assert.deepEqual(sheets.map((call) => JSON.parse(call.init.body)), [
    {
      token: "destin-token",
      site: "Destin",
      email: "Guest@example.com",
      coupons: true,
      sourcePage: "https://www.eatingindestin.com/account/",
    },
    {
      token: "thirty-token",
      site: "30A",
      email: "Guest@example.com",
      coupons: true,
      sourcePage: "https://www.eatingindestin.com/account/",
    },
  ]);
  assert.equal(sheets.some((call) => String(call.url).includes("resend.com")), false);
});

test("only the checked guide is written, and a missing 30A token skips that row", async () => {
  const sheets = [];
  const onlyDestin = await requestCoupons(
    { coupons30a: false, couponsDestin: true },
    sheetEnv(acceptedAccounts()),
    async (url, init) => {
      sheets.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(onlyDestin.payload.ok, true);
  assert.deepEqual(sheets, [{
    token: "destin-token",
    site: "Destin",
    email: "Guest@example.com",
    coupons: true,
    sourcePage: "https://www.eatingindestin.com/account/",
  }]);

  const skipped = [];
  const missingToken = await requestCoupons(
    { coupons30a: true, couponsDestin: true },
    sheetEnv(acceptedAccounts(), { GOOGLE_SHEETS_WEBHOOK_TOKEN_30A: "" }),
    async (url, init) => {
      skipped.push(JSON.parse(init.body).site);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(missingToken.response.status, 200);
  assert.deepEqual(missingToken.payload, { ok: true, delivered: true });
  assert.deepEqual(skipped, ["Destin"]);
});

test("a sheet failure still returns the accepted magic link", async () => {
  const thrown = await requestCoupons(
    { couponsDestin: true },
    sheetEnv(acceptedAccounts()),
    () => Promise.reject(new Error("webhook down")),
  );
  assert.equal(thrown.response.status, 200);
  assert.deepEqual(thrown.payload, { ok: true, delivered: true });

  const rejected = await requestCoupons(
    { coupons30a: "yes" },
    sheetEnv(acceptedAccounts()),
    () => Promise.resolve(new Response("no", { status: 500 })),
  );
  assert.equal(rejected.response.status, 200);
  assert.equal(rejected.payload.ok, true);
});

test("a refused magic link does not write the sheet", async () => {
  let sheetCalled = false;
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", couponsDestin: true, coupons30a: true }),
  }), sheetEnv(() => Promise.resolve(new Response(JSON.stringify({
    ok: false,
    error: "The sign-in email could not be sent.",
  }), { status: 502 }))), () => {
    sheetCalled = true;
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  assert.equal(response.status, 502);
  assert.equal(sheetCalled, false);
});

test("a form post with one coupon box opts in without calling Resend", async () => {
  let magic = null;
  const sheets = [];
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "guest@example.com", coupons30a: "yes" }),
  }), sheetEnv(async (request) => {
    magic = await request.json();
    return new Response(JSON.stringify({ ok: true, delivered: true }), { status: 200 });
  }), async (url, init) => {
    sheets.push(JSON.parse(init.body));
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(magic.marketingOptIn, true);
  assert.equal(magic.site, "destin");
  assert.deepEqual(sheets, [{
    token: "thirty-token",
    site: "30A",
    email: "guest@example.com",
    coupons: true,
    sourcePage: "https://www.eatingindestin.com/account/",
  }]);
});

test("finish sets a host-only session cookie and does not set Domain", async () => {
  const response = await handleAccount(new Request(`${origin}/api/account/finish?code=${"ab".repeat(32)}&next=/my-places/`), envWith(() => Promise.resolve(new Response(JSON.stringify({
    ok: true,
    token: "session-token",
    user: { email: "guest@example.com", marketingOptIn: false },
  }), { status: 200 }))));
  assert.equal(response.status, 302);
  assert.equal(response.headers.get("location"), `${origin}/my-places/`);
  const cookie = response.headers.get("set-cookie");
  assert.match(cookie, /^ea_session=session-token;/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  assert.match(cookie, /Secure/);
  assert.equal(cookie.includes("Domain="), false);
});

test("the site worker answers account config without touching assets", async () => {
  const response = await worker.fetch(new Request(`${origin}/api/account/config`), {
    ACCOUNT_SITE: "destin",
    ACCOUNTS_ORIGIN: "https://eating-accounts.352marc.workers.dev",
    ASSETS: { fetch() { throw new Error("assets should not be called"); } },
  });
  assert.deepEqual(await response.json(), {
    ok: true,
    site: "destin",
    accountsOrigin: "https://eating-accounts.352marc.workers.dev",
  });
});
