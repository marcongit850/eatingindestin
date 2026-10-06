import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import { handleAccount } from "../account-api.js";
import worker from "../worker.js";
import { ZOHO_LISTSUBSCRIBE_URL, ZOHO_TOKEN_URL } from "../zoho.js";

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

test("my places page names both guides and keeps coupon opt-in quiet", () => {
  const html = readFileSync(new URL("../my-places/index.html", import.meta.url), "utf8");
  const client = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const subscribe = readFileSync(new URL("../subscribe.js", import.meta.url), "utf8");
  assert.match(html, /data-tab="favorite"/);
  assert.match(html, /data-tab="want"/);
  assert.match(html, /data-site-filter="30a"/);
  assert.match(html, /data-site-filter="destin"/);
  assert.match(html, /Each card is labeled 30A or Destin/);
  assert.match(html, /Notes stay private on your account\. Shown on My places for each saved restaurant \(Favorites and Want to try\)\./);
  assert.match(html, /data-places-coupons hidden/);
  assert.match(html, /<summary>Coupons and updates<\/summary>/);
  assert.equal(html.includes("<dialog"), false);
  assert.equal(html.includes("subscribe-popup"), false);
  assert.equal(html.includes('type="email"'), false);
  const coupons30a = html.match(/<input name="coupons30a"[^>]*>/);
  const couponsDestin = html.match(/<input name="couponsDestin"[^>]*>/);
  assert.ok(coupons30a, "30A coupon checkbox should be on My places");
  assert.ok(couponsDestin, "Destin coupon checkbox should be on My places");
  assert.equal(coupons30a[0].includes("checked"), false);
  assert.equal(couponsDestin[0].includes("checked"), false);
  assert.match(html, /Email me coupons and updates from Eating on 30A\./);
  assert.match(html, /Email me coupons and updates from Eating in Destin\./);
  assert.match(html, /This uses the email on your account\./);
  assert.match(client, /JSON\.stringify\(\{ coupons30a: coupons30a, couponsDestin: couponsDestin \}\)/);
  assert.match(client, /coupons\.hidden = false/);
  assert.equal(client.includes("showModal"), false);
  assert.match(subscribe, /data-account-page="places"/);
  assert.match(subscribe, /\/api\/account\/me/);
  assert.equal(html.includes("—"), false);
  assert.equal(html.includes("–"), false);
});

function loadCouponPopup(options = {}) {
  const fetches = [];
  const dialog = {
    open: false,
    shown: 0,
    showModal() {
      this.open = true;
      this.shown += 1;
    },
    close() {
      this.open = false;
    },
    querySelectorAll() {
      return [];
    },
    addEventListener() {},
  };
  const session = new Map();
  const local = new Map();
  function memory(map) {
    return {
      getItem(key) {
        return map.has(key) ? map.get(key) : null;
      },
      setItem(key, value) {
        map.set(key, String(value));
      },
    };
  }
  const timers = [];
  const windowStub = {
    sessionStorage: memory(session),
    localStorage: memory(local),
    setTimeout(fn, ms) {
      timers.push({ fn, ms });
      return timers.length;
    },
  };
  if (options.sid) windowStub.sessionStorage.setItem("eidestin-sid", options.sid);
  if (options.dismissed) windowStub.localStorage.setItem("eidestin-coupon-popup", options.dismissed);
  const documentStub = {
    getElementById(id) {
      return id === "subscribe-popup" ? dialog : null;
    },
    querySelectorAll() {
      return [];
    },
    querySelector(selector) {
      if (selector === '[data-account-page="places"]' && options.places) return { hidden: false };
      return null;
    },
  };
  const sandbox = {
    window: windowStub,
    document: documentStub,
    fetch(url, init) {
      fetches.push({ url: String(url), init });
      if (options.fail) return Promise.reject(new Error("offline"));
      const body = options.body === undefined ? { ok: true, user: options.user ?? null } : options.body;
      return Promise.resolve({
        ok: true,
        json() {
          if (options.invalidJson) return Promise.reject(new Error("bad json"));
          return Promise.resolve(body);
        },
      });
    },
  };
  vm.runInNewContext(readFileSync(new URL("../subscribe.js", import.meta.url), "utf8"), sandbox);
  return { dialog, timers, fetches };
}

async function firePopup(popup) {
  const scheduled = popup.timers.splice(0, popup.timers.length);
  for (const timer of scheduled) timer.fn();
  await new Promise((resolve) => setImmediate(resolve));
}

test("coupon popup stays closed when account/me reports a user", async () => {
  const signedIn = loadCouponPopup({ user: { email: "guest@example.com" } });
  assert.equal(signedIn.timers.length, 1);
  assert.ok(signedIn.timers[0].ms <= 30000 && signedIn.timers[0].ms > 29000);
  await firePopup(signedIn);
  assert.equal(signedIn.fetches.length, 1);
  assert.equal(signedIn.fetches[0].url, "/api/account/me");
  assert.equal(signedIn.fetches[0].init.credentials, "same-origin");
  assert.equal(signedIn.dialog.shown, 0);
  assert.equal(signedIn.dialog.open, false);

  const signedOut = loadCouponPopup({ user: null });
  await firePopup(signedOut);
  assert.equal(signedOut.fetches[0].url, "/api/account/me");
  assert.equal(signedOut.dialog.shown, 1);
  assert.equal(signedOut.dialog.open, true);

  const offline = loadCouponPopup({ fail: true });
  await firePopup(offline);
  assert.equal(offline.dialog.shown, 1);

  const broken = loadCouponPopup({ invalidJson: true });
  await firePopup(broken);
  assert.equal(broken.dialog.shown, 1);

  const places = loadCouponPopup({ places: true, user: null });
  assert.equal(places.timers.length, 0);
  assert.equal(places.fetches.length, 0);

  const dismissed = loadCouponPopup({ sid: "visit-1", dismissed: "visit-1", user: null });
  assert.equal(dismissed.timers.length, 0);
  assert.equal(dismissed.fetches.length, 0);
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
const zohoEnv = {
  ZOHO_CLIENT_ID: "zoho-client",
  ZOHO_CLIENT_SECRET: "zoho-secret",
  ZOHO_REFRESH_TOKEN: "zoho-refresh",
  ZOHO_LIST_KEY_DESTIN: "destin-list-key",
  ZOHO_LIST_KEY_30A: "thirty-list-key",
};

function zohoAwareFetch(calls) {
  return async (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === ZOHO_TOKEN_URL) {
      return new Response(JSON.stringify({ access_token: "zoho-access" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  };
}

function zohoLists(calls) {
  return calls
    .filter((call) => call.url.startsWith(ZOHO_LISTSUBSCRIBE_URL))
    .map((call) => new URL(call.url));
}

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

function signedIn(email = "guest@example.com") {
  return (request) => {
    assert.equal(new URL(request.url).pathname, "/v1/me");
    assert.equal(request.headers.get("x-session"), "session-token");
    return Promise.resolve(new Response(JSON.stringify({
      ok: true,
      user: { email },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };
}

function placesRequest(body, { jsonBody = true, cookie = "ea_session=session-token" } = {}) {
  const headers = {};
  if (cookie) headers.cookie = cookie;
  let payload = body;
  if (jsonBody) {
    headers["content-type"] = "application/json";
    payload = JSON.stringify(body);
  } else {
    headers["content-type"] = "application/x-www-form-urlencoded";
  }
  return new Request(`${origin}/api/account/coupons`, { method: "POST", headers, body: payload });
}

test("a signed-in My places opt-in appends sheet rows for the session email", async () => {
  const sheets = [];
  const response = await handleAccount(
    placesRequest({ coupons30a: true, couponsDestin: true, email: "other@example.com" }),
    sheetEnv(signedIn("Guest@example.com")),
    async (url, init) => {
      sheets.push({ url, init });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(sheets.map((call) => call.url), [sheetUrl, sheetUrl]);
  assert.deepEqual(sheets.map((call) => JSON.parse(call.init.body)), [
    {
      token: "destin-token",
      site: "Destin",
      email: "Guest@example.com",
      coupons: true,
      sourcePage: "https://www.eatingindestin.com/my-places/",
    },
    {
      token: "thirty-token",
      site: "30A",
      email: "Guest@example.com",
      coupons: true,
      sourcePage: "https://www.eatingindestin.com/my-places/",
    },
  ]);
  assert.equal(sheets.some((call) => String(call.url).includes("resend.com")), false);
});

test("My places writes only the checked guide and skips a missing 30A token", async () => {
  const sheets = [];
  const only30a = await handleAccount(
    placesRequest(new URLSearchParams({ coupons30a: "yes", email: "other@example.com" }), { jsonBody: false }),
    sheetEnv(signedIn()),
    async (url, init) => {
      sheets.push(JSON.parse(init.body));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(only30a.status, 200);
  assert.deepEqual(sheets, [{
    token: "thirty-token",
    site: "30A",
    email: "guest@example.com",
    coupons: true,
    sourcePage: "https://www.eatingindestin.com/my-places/",
  }]);

  const skipped = [];
  const missing = await handleAccount(
    placesRequest({ coupons30a: true, couponsDestin: true }),
    sheetEnv(signedIn(), { GOOGLE_SHEETS_WEBHOOK_TOKEN_30A: "" }),
    async (url, init) => {
      skipped.push(JSON.parse(init.body).site);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  );
  assert.equal(missing.status, 200);
  assert.deepEqual(await missing.json(), { ok: true });
  assert.deepEqual(skipped, ["Destin"]);
});

test("My places opt-in refuses a signed-out visitor and an empty choice", async () => {
  let called = false;
  const signedOut = await handleAccount(
    placesRequest({ couponsDestin: true }, { cookie: "" }),
    sheetEnv(() => {
      called = true;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }),
    () => {
      called = true;
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    },
  );
  assert.equal(signedOut.status, 401);
  assert.equal(called, false);

  const anonymous = await handleAccount(
    placesRequest({ couponsDestin: true }),
    sheetEnv(() => Promise.resolve(new Response(JSON.stringify({ ok: true, user: null }), { status: 200 }))),
    () => {
      throw new Error("sheet should not be called");
    },
  );
  assert.equal(anonymous.status, 401);

  const empty = await handleAccount(
    placesRequest({ coupons30a: false, couponsDestin: false, email: "guest@example.com" }),
    sheetEnv(signedIn()),
    () => {
      throw new Error("sheet should not be called");
    },
  );
  assert.equal(empty.status, 400);
  assert.deepEqual(await empty.json(), { ok: false, error: "Choose at least one list." });
});

test("a My places sheet failure still accepts the opt-in and does not call Resend", async () => {
  const urls = [];
  const response = await handleAccount(
    placesRequest({ couponsDestin: true }),
    sheetEnv(signedIn()),
    (url) => {
      urls.push(String(url));
      return Promise.reject(new Error("webhook down"));
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(urls, [sheetUrl]);
});

test("checked coupon boxes subscribe the matching Zoho lists beside the sheet rows", async () => {
  const calls = [];
  const { response, payload } = await requestCoupons(
    { coupons30a: true, couponsDestin: true },
    sheetEnv(acceptedAccounts(), zohoEnv),
    zohoAwareFetch(calls),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, delivered: true });
  assert.deepEqual(calls.filter((call) => call.url === sheetUrl).map((call) => JSON.parse(call.init.body)), [
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
  const tokenCalls = calls.filter((call) => call.url === ZOHO_TOKEN_URL);
  assert.equal(tokenCalls.length, 1);
  const token = new URLSearchParams(tokenCalls[0].init.body);
  assert.equal(token.get("grant_type"), "refresh_token");
  assert.equal(token.get("client_id"), "zoho-client");
  assert.equal(token.get("client_secret"), "zoho-secret");
  assert.equal(token.get("refresh_token"), "zoho-refresh");
  const lists = zohoLists(calls);
  assert.deepEqual(lists.map((url) => url.searchParams.get("listkey")), ["destin-list-key", "thirty-list-key"]);
  assert.deepEqual(lists.map((url) => url.searchParams.get("resfmt")), ["JSON", "JSON"]);
  assert.deepEqual(lists.map((url) => url.searchParams.get("contactinfo")), [
    "{Contact Email:Guest@example.com}",
    "{Contact Email:Guest@example.com}",
  ]);
  assert.deepEqual(lists.map((url) => url.searchParams.get("source")), [
    "eatingindestin-account",
    "eatingindestin-account",
  ]);
  const listCall = calls.find((call) => call.url.startsWith(ZOHO_LISTSUBSCRIBE_URL));
  assert.equal(listCall.init.method, "POST");
  assert.equal(listCall.init.headers.authorization, "Zoho-oauthtoken zoho-access");
  assert.equal(calls.some((call) => String(call.url).includes("resend.com")), false);
});

test("only the checked guide is subscribed in Zoho", async () => {
  const calls = [];
  const onlyDestin = await requestCoupons(
    { coupons30a: false, couponsDestin: true },
    sheetEnv(acceptedAccounts(), zohoEnv),
    zohoAwareFetch(calls),
  );
  assert.equal(onlyDestin.payload.ok, true);
  assert.deepEqual(calls.filter((call) => call.url === sheetUrl).map((call) => JSON.parse(call.init.body).site), ["Destin"]);
  assert.deepEqual(zohoLists(calls).map((url) => url.searchParams.get("listkey")), ["destin-list-key"]);
});

test("a missing 30A Zoho list key skips that list and still writes both sheet rows", async () => {
  const calls = [];
  const { payload } = await requestCoupons(
    { coupons30a: true, couponsDestin: true },
    sheetEnv(acceptedAccounts(), { ...zohoEnv, ZOHO_LIST_KEY_30A: "" }),
    zohoAwareFetch(calls),
  );
  assert.equal(payload.ok, true);
  assert.deepEqual(calls.filter((call) => call.url === sheetUrl).map((call) => JSON.parse(call.init.body).site), ["Destin", "30A"]);
  assert.deepEqual(zohoLists(calls).map((url) => url.searchParams.get("listkey")), ["destin-list-key"]);
});

test("missing Zoho OAuth secrets skip listsubscribe and still write the sheet", async () => {
  const calls = [];
  const { response, payload } = await requestCoupons(
    { coupons30a: true, couponsDestin: true },
    sheetEnv(acceptedAccounts(), { ...zohoEnv, ZOHO_CLIENT_SECRET: "" }),
    zohoAwareFetch(calls),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, delivered: true });
  assert.deepEqual(calls.map((call) => call.url), [sheetUrl, sheetUrl]);
});

test("a marketing opt-in without a coupon box does not subscribe in Zoho", async () => {
  let called = false;
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", marketingOptIn: true }),
  }), sheetEnv(async () => new Response(JSON.stringify({ ok: true, delivered: true }), { status: 200 }), zohoEnv), () => {
    called = true;
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  assert.equal(response.status, 200);
  assert.equal(called, false);
});

test("a Zoho failure still returns the accepted magic link and the sheet rows", async () => {
  const sites = [];
  const { response, payload } = await requestCoupons(
    { couponsDestin: true, coupons30a: true },
    sheetEnv(acceptedAccounts(), zohoEnv),
    async (url, init) => {
      const href = String(url);
      if (href === sheetUrl) {
        sites.push(JSON.parse(init.body).site);
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      throw new Error("zoho down");
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(payload, { ok: true, delivered: true });
  assert.deepEqual(sites, ["Destin", "30A"]);
});

test("a refused magic link does not subscribe in Zoho", async () => {
  let called = false;
  const response = await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", couponsDestin: true, coupons30a: true }),
  }), sheetEnv(() => Promise.resolve(new Response(JSON.stringify({
    ok: false,
    error: "The sign-in email could not be sent.",
  }), { status: 502 })), zohoEnv), () => {
    called = true;
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
  });
  assert.equal(response.status, 502);
  assert.equal(called, false);
});

test("My places opt-in subscribes the session email to the checked Zoho lists", async () => {
  const calls = [];
  const response = await handleAccount(
    placesRequest({ coupons30a: true, couponsDestin: true, email: "other@example.com" }),
    sheetEnv(signedIn("Guest@example.com"), zohoEnv),
    zohoAwareFetch(calls),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  const sheets = calls.filter((call) => call.url === sheetUrl).map((call) => JSON.parse(call.init.body));
  assert.equal(sheets[0].email, "Guest@example.com");
  assert.equal(sheets[1].email, "Guest@example.com");
  assert.equal(sheets[0].sourcePage, "https://www.eatingindestin.com/my-places/");
  assert.equal(sheets[1].sourcePage, "https://www.eatingindestin.com/my-places/");
  const lists = zohoLists(calls);
  assert.deepEqual(lists.map((url) => url.searchParams.get("listkey")), ["destin-list-key", "thirty-list-key"]);
  assert.deepEqual(lists.map((url) => url.searchParams.get("contactinfo")), [
    "{Contact Email:Guest@example.com}",
    "{Contact Email:Guest@example.com}",
  ]);
  assert.deepEqual(lists.map((url) => url.searchParams.get("source")), [
    "eatingindestin-account",
    "eatingindestin-account",
  ]);
  assert.equal(calls.some((call) => call.url.includes("other@example.com")), false);
  assert.equal(calls.some((call) => String(call.url).includes("resend.com")), false);
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
  assert.match(cookie, /Max-Age=604800/);
  assert.equal(cookie.includes("Domain="), false);
});

test("personal notes stay on the account pages and off public cards", () => {
  const script = readFileSync(new URL("../account.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const page = readFileSync(new URL("../restaurants/harbor-docks-destin-harbor/index.html", import.meta.url), "utf8");
  const directory = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  const cards = script.slice(script.indexOf("function mountCardSaves"), script.indexOf("function watchMapList"));
  assert.match(script, /Add a personal note\.\.\./);
  assert.match(script, /Only you can see this\. It also shows on My places\. About 280 characters\./);
  assert.match(script, /data-note-save/);
  assert.match(script, /data-note-clear/);
  assert.match(script, /Save note/);
  assert.match(script, /maxlength="280"/);
  assert.match(script, /maxLength = 280/);
  assert.match(script, /editor\.value = save\.note \|\| ""/);
  assert.match(script, /panel\.hidden = true/);
  const listingNote = script.slice(script.indexOf("function mountSaves"), script.indexOf("function mountCardSaves"));
  const placesNoteUi = script.slice(script.indexOf("noteWrap.className = \"place-note\""), script.indexOf("root.querySelectorAll(\"[data-tab]\")"));
  assert.match(listingNote, /<textarea maxlength="280" rows="3" placeholder="Add a personal note\.\.\."><\/textarea>/);
  assert.equal(listingNote.includes("Add note"), false);
  assert.equal(listingNote.includes("Edit note"), false);
  assert.match(placesNoteUi, /editor\.placeholder = "Add a personal note\.\.\."/);
  assert.match(placesNoteUi, /editor\.value = save\.note \|\| ""/);
  assert.equal(placesNoteUi.includes("editor.hidden"), false);
  assert.equal(placesNoteUi.includes("Add note"), false);
  assert.equal(placesNoteUi.includes("Edit note"), false);
  assert.equal(script.includes("Add note"), false);
  assert.equal(script.includes("Edit note"), false);
  const noteWrites = [];
  const marker = "putSave({";
  let index = 0;
  while ((index = script.indexOf(marker, index)) !== -1) {
    const start = index + "putSave(".length;
    let depth = 0;
    let end = start;
    for (; end < script.length; end += 1) {
      if (script[end] === "{") depth += 1;
      else if (script[end] === "}") {
        depth -= 1;
        if (depth === 0) {
          end += 1;
          break;
        }
      }
    }
    const body = script.slice(start, end);
    if (/\bnote\s*:/.test(body)) noteWrites.push(body);
    index = end;
  }
  assert.equal(noteWrites.length, 2);
  for (const body of noteWrites) {
    assert.match(body, /saved:\s*true/);
    assert.equal(/\bsaved:\s*false/.test(body), false);
  }
  const placesNote = noteWrites.find((body) => /site:\s*save\.site/.test(body));
  assert.ok(placesNote);
  assert.match(placesNote, /note:\s*text/);
  assert.equal(script.includes("—"), false);
  assert.equal(script.includes("–"), false);
  assert.equal(cards.includes("personal-note"), false);
  assert.equal(cards.includes("Your note"), false);
  assert.match(css, /\.personal-note \{/);
  assert.match(css, /\.place-note-input \{/);
  assert.equal(css.includes(".place-note-empty"), false);
  assert.equal(css.includes(".place-note-view"), false);
  assert.match(css, /var\(--ink\)/);
  assert.match(css, /var\(--gulf\)/);
  assert.equal(page.includes("personal-note"), false);
  assert.equal(page.includes("Only you can see this"), false);
  assert.equal(directory.includes("personal-note"), false);
  assert.equal(directory.includes("Your note"), false);
});

test("a save forwards the note, and a cross-guide note update does not create a save", async () => {
  const calls = [];
  const env = envWith(async (request) => {
    calls.push({ method: request.method, path: new URL(request.url).pathname, body: await request.json() });
    return new Response(JSON.stringify({ ok: true, saved: true, note: "Window seat." }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  const saved = await handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: "ea_session=session-token" },
    body: JSON.stringify({
      slug: "harbor-docks-destin-harbor",
      name: "Harbor Docks",
      area: "Destin Harbor",
      kind: "favorite",
      saved: true,
      note: "  Window seat.  ",
    }),
  }), env);
  assert.equal(saved.status, 200);
  assert.deepEqual(await saved.json(), { ok: true, saved: true, note: "Window seat." });
  assert.deepEqual(calls, [{
    method: "PUT",
    path: "/v1/saves",
    body: {
      slug: "harbor-docks-destin-harbor",
      name: "Harbor Docks",
      area: "Destin Harbor",
      kind: "favorite",
      site: "destin",
      saved: true,
      note: "  Window seat.  ",
    },
  }]);

  calls.length = 0;
  const cross = await handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: "ea_session=session-token" },
    body: JSON.stringify({
      slug: "the-donut-hole-inlet-beach",
      name: "The Donut Hole",
      area: "Inlet Beach",
      kind: "want",
      site: "30a",
      note: "Booth by the window.",
    }),
  }), env);
  assert.equal(cross.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].body.site, "30a");
  assert.equal(calls[0].body.note, "Booth by the window.");
  assert.equal(Object.hasOwn(calls[0].body, "saved"), false);

  calls.length = 0;
  const edited = await handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: "ea_session=session-token" },
    body: JSON.stringify({
      slug: "the-donut-hole-inlet-beach",
      name: "The Donut Hole",
      area: "Inlet Beach",
      kind: "want",
      site: "30a",
      saved: true,
      note: "Booth by the window.",
    }),
  }), env);
  assert.equal(edited.status, 200);
  assert.equal(calls[0].body.site, "30a");
  assert.equal(calls[0].body.saved, true);
  assert.equal(calls[0].body.note, "Booth by the window.");

  const blocked = await handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: "ea_session=session-token" },
    body: JSON.stringify({
      slug: "new-30a-place",
      name: "New Place",
      area: "Inlet Beach",
      kind: "favorite",
      site: "30a",
      saved: true,
    }),
  }), env);
  assert.equal(blocked.status, 400);
  assert.deepEqual(await blocked.json(), { ok: false, error: "Save this place on its own guide." });
  assert.equal(calls.length, 1);

  const empty = await handleAccount(new Request(`${origin}/api/account/saves`, {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: "ea_session=session-token" },
    body: JSON.stringify({ slug: "harbor-docks-destin-harbor", kind: "favorite" }),
  }), env);
  assert.equal(empty.status, 400);
  assert.equal(calls.length, 1);
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
