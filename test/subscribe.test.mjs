import assert from "node:assert/strict";
import test from "node:test";
import { ZOHO_LISTSUBSCRIBE_URL, ZOHO_TOKEN_URL } from "../zoho.js";
import { CANONICAL_HOST, deliverSubscribe, handleSubscribe, parseSubscribe } from "../worker.js";

const signup = { email: "guest@example.com", audience: "local", coupons: true };
const resendEnv = {
  RESEND_API_KEY: "re_test",
  CONTACT_EMAIL: "marc@example.com",
  SUBSCRIBE_FROM: "Eating in Destin <coupons@example.com>",
};
const sheetsEnv = {
  GOOGLE_SHEETS_WEBHOOK_URL: "https://script.google.com/macros/s/example/exec",
  GOOGLE_SHEETS_WEBHOOK_TOKEN: "sheet-token",
};
const bothEnv = { ...resendEnv, ...sheetsEnv };
const zohoEnv = {
  ZOHO_CLIENT_ID: "zoho-client",
  ZOHO_CLIENT_SECRET: "zoho-secret",
  ZOHO_REFRESH_TOKEN: "zoho-refresh",
  ZOHO_LIST_KEY_DESTIN: "destin-list-key",
  ZOHO_LIST_KEY_30A: "thirty-list-key",
};

function tokenResponse() {
  return Promise.resolve(new Response(JSON.stringify({ access_token: "zoho-access", expires_in: 3600 }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function okResponse() {
  return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  }));
}

function sheetResponse(body, status = 200, contentType = "application/json") {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return Promise.resolve(new Response(text, {
    status,
    headers: { "content-type": contentType },
  }));
}

test("parseSubscribe rejects a bad email and an unknown audience", () => {
  assert.equal(parseSubscribe({ email: "nope" }).error, "Enter a valid email.");
  assert.equal(parseSubscribe({ email: "guest@example.com", audience: "other" }).error, "Choose Local or Visitor.");
  assert.deepEqual(parseSubscribe(signup).value, signup);
});

test("missing secrets accept the signup and do not call Resend or Sheets", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { RESEND_API_KEY: "key-only" }, () => {
    called = true;
    return Promise.resolve(new Response(""));
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("all three secrets post the signup to Resend", async () => {
  let url = "";
  let init = null;
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "visitor", coupons: false },
    {
      RESEND_API_KEY: "re_test",
      CONTACT_EMAIL: "marc@example.com",
      SUBSCRIBE_FROM: "Eating in Destin <coupons@example.com>",
    },
    (nextUrl, nextInit) => {
      url = nextUrl;
      init = nextInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.delivered, true);
  assert.equal(result.recorded, false);
  assert.equal(url, "https://api.resend.com/emails");
  const body = JSON.parse(init.body);
  assert.equal(body.from, "Eating in Destin <coupons@example.com>");
  assert.deepEqual(body.to, ["marc@example.com"]);
  assert.match(body.text, /guest@example.com/);
  assert.match(body.text, /Visitor/);
  assert.match(body.text, /Coupons: no/);
});

test("a Resend error is not reported as delivered", async () => {
  const result = await deliverSubscribe(
    signup,
    { RESEND_API_KEY: "re_test", CONTACT_EMAIL: "marc@example.com", SUBSCRIBE_FROM: "from@example.com" },
    () => Promise.resolve(new Response("no", { status: 422 })),
  );
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.recorded, false);
});

test("POST JSON without secrets returns delivered false", async () => {
  const request = new Request("https://eatingindestin.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signup),
  });
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false, recorded: false });
});

test("a non-POST is rejected", async () => {
  const request = new Request("https://eatingindestin.example/api/subscribe");
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 405);
});

test("a form post returns an HTML thanks page", async () => {
  const request = new Request("https://eatingindestin.example/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "guest@example.com", audience: "local", coupons: "yes" }),
  });
  const response = await handleSubscribe(request, {});
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
});

test("Resend and Sheets are called independently and both reported", async () => {
  const calls = [];
  const result = await deliverSubscribe(signup, bothEnv, (url, init) => {
    calls.push({ url, init });
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.deepEqual(calls.map((call) => call.url), [
    "https://api.resend.com/emails",
    sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL,
  ]);
  const sheet = JSON.parse(calls[1].init.body);
  assert.equal(calls[1].init.method, "POST");
  assert.equal(calls[1].init.headers["content-type"], "application/json");
  assert.deepEqual(sheet, {
    token: "sheet-token",
    site: "Destin",
    email: "guest@example.com",
    audience: "local",
    coupons: true,
    sourcePage: `https://${CANONICAL_HOST}/`,
  });
  assert.equal(sheet.sourcePage, "https://www.eatingindestin.com/");
  const mail = JSON.parse(calls[0].init.body);
  assert.equal(mail.text.includes("sheet-token"), false);
});

test("Sheets payload omits a blank audience", async () => {
  let sheet = null;
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "", coupons: false },
    sheetsEnv,
    (url, init) => {
      assert.equal(url, sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL);
      sheet = JSON.parse(init.body);
      return okResponse();
    },
  );
  assert.deepEqual(result, { ok: true, delivered: false, recorded: true });
  assert.equal(Object.hasOwn(sheet, "audience"), false);
  assert.equal(sheet.coupons, false);
  assert.equal(sheet.site, "Destin");
});

test("a partial Sheets secret skips the webhook", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { GOOGLE_SHEETS_WEBHOOK_URL: sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL }, () => {
    called = true;
    return okResponse();
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("a Sheets error still counts the Resend signup as delivered", async () => {
  const result = await deliverSubscribe(signup, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return okResponse();
    return Promise.resolve(new Response("no", { status: 500 }));
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Sheets network error still counts the Resend signup as delivered", async () => {
  const result = await deliverSubscribe(signup, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return okResponse();
    return Promise.reject(new Error("webhook down"));
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Resend error still reports a Sheets recording", async () => {
  const result = await deliverSubscribe(signup, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return Promise.resolve(new Response("no", { status: 422 }));
    return okResponse();
  });
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.recorded, true);
  assert.equal(result.error, "The signup could not be sent.");
});

test("POST JSON reports delivered and recorded separately", async () => {
  const request = new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", audience: "visitor", coupons: false }),
  });
  const response = await handleSubscribe(request, bothEnv, (url, init) => {
    if (url === sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL) {
      const sheet = JSON.parse(init.body);
      assert.equal(sheet.audience, "visitor");
      assert.equal(sheet.coupons, false);
      assert.equal(sheet.site, "Destin");
    }
    return okResponse();
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true, recorded: true });
});

test("POST JSON stays successful when Sheets fails after Resend succeeds", async () => {
  const request = new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(signup),
  });
  const response = await handleSubscribe(request, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return okResponse();
    return Promise.resolve(new Response("no", { status: 502 }));
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true, recorded: false });
});

test("an Apps Script HTML 200 is not recorded", async () => {
  const result = await deliverSubscribe(signup, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return okResponse();
    return sheetResponse("Script function not found: doPost", 200, "text/html; charset=utf-8");
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Sheets JSON body with ok false is not recorded", async () => {
  const result = await deliverSubscribe(signup, bothEnv, (url) => {
    if (url === "https://api.resend.com/emails") return okResponse();
    return sheetResponse({ ok: false });
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: false });
});

test("a Sheets JSON body without ok true is not recorded", async () => {
  const result = await deliverSubscribe(signup, sheetsEnv, () => sheetResponse({}));
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("a non-JSON Sheets body is not recorded", async () => {
  const result = await deliverSubscribe(signup, sheetsEnv, () => sheetResponse("recorded", 200, "text/plain"));
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("Sheets JSON ok true is recorded without changing a Resend miss", async () => {
  const result = await deliverSubscribe(signup, sheetsEnv, () => sheetResponse({ ok: true, row: 4 }));
  assert.deepEqual(result, { ok: true, delivered: false, recorded: true });
});

test("a form post still returns HTML when Sheets is configured", async () => {
  const calls = [];
  const request = new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ email: "guest@example.com", audience: "local", coupons: "yes" }),
  });
  const response = await handleSubscribe(request, bothEnv, (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return okResponse();
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].body.email, "guest@example.com");
  assert.equal(calls[1].body.coupons, true);
  assert.equal(calls[1].body.audience, "local");
});

function postSignup(body, ip, headers = {}) {
  return new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", "cf-connecting-ip": ip, ...headers },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

test("a filled honeypot looks successful and does not send the signup", async () => {
  let called = false;
  const response = await handleSubscribe(
    postSignup({ ...signup, company: "Acme Bots" }, "198.51.100.10"),
    bothEnv,
    () => {
      called = true;
      return okResponse();
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false, recorded: false });
});

test("a honeypot alias on an incomplete signup still looks successful", async () => {
  let called = false;
  const response = await handleSubscribe(
    postSignup({ email: "nope", website: "https://spam.example" }, "198.51.100.11"),
    bothEnv,
    () => {
      called = true;
      return okResponse();
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false, recorded: false });
});

test("a blank honeypot still sends the signup", async () => {
  let called = false;
  const response = await handleSubscribe(
    postSignup({ ...signup, company: "   " }, "198.51.100.12"),
    bothEnv,
    () => {
      called = true;
      return okResponse();
    },
  );
  assert.equal(called, true);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: true, recorded: true });
});

test("a filled honeypot on a form post returns the HTML thanks page", async () => {
  let called = false;
  const request = new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "198.51.100.13",
    },
    body: new URLSearchParams({ email: "guest@example.com", audience: "local", coupons: "yes", company: "Acme Bots" }),
  });
  const response = await handleSubscribe(request, bothEnv, () => {
    called = true;
    return okResponse();
  });
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
});

test("an oversized signup is rejected before mail is sent", async () => {
  let called = false;
  const body = JSON.stringify({ ...signup, note: "x".repeat(16000) });
  assert.ok(body.length > 16000);
  const response = await handleSubscribe(postSignup(body, "198.51.100.14"), bothEnv, () => {
    called = true;
    return okResponse();
  });
  assert.equal(called, false);
  assert.equal(response.status, 413);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.match(payload.error, /too long/i);
});

test("the sixth signup from one IP in a minute is rate limited", async () => {
  const ip = "198.51.100.15";
  let calls = 0;
  const send = () => handleSubscribe(postSignup(signup, ip), bothEnv, () => {
    calls += 1;
    return okResponse();
  });
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const response = await send();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, delivered: true, recorded: true });
  }
  const blocked = await send();
  assert.equal(blocked.status, 429);
  assert.match((await blocked.json()).error, /wait a minute/i);
  assert.equal(calls, 10);
  const other = await handleSubscribe(postSignup(signup, "198.51.100.16"), bothEnv, () => {
    calls += 1;
    return okResponse();
  });
  assert.equal(other.status, 200);
  assert.equal(calls, 12);
});

test("Zoho listsubscribe runs beside Resend and Sheets", async () => {
  const calls = [];
  const result = await deliverSubscribe(signup, { ...bothEnv, ...zohoEnv }, (url, init) => {
    calls.push({ url: String(url), init });
    if (String(url) === ZOHO_TOKEN_URL) return tokenResponse();
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.deepEqual(calls.map((call) => call.url.startsWith(ZOHO_LISTSUBSCRIBE_URL) ? ZOHO_LISTSUBSCRIBE_URL : call.url), [
    "https://api.resend.com/emails",
    sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL,
    ZOHO_TOKEN_URL,
    ZOHO_LISTSUBSCRIBE_URL,
  ]);
  assert.deepEqual(JSON.parse(calls[1].init.body), {
    token: "sheet-token",
    site: "Destin",
    email: "guest@example.com",
    audience: "local",
    coupons: true,
    sourcePage: `https://${CANONICAL_HOST}/`,
  });
  const mail = JSON.parse(calls[0].init.body);
  assert.equal(mail.text.includes("zoho-secret"), false);
  assert.equal(mail.text.includes("destin-list-key"), false);
  const tokenBody = new URLSearchParams(calls[2].init.body);
  assert.equal(calls[2].init.method, "POST");
  assert.equal(calls[2].init.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(tokenBody.get("grant_type"), "refresh_token");
  assert.equal(tokenBody.get("client_id"), "zoho-client");
  assert.equal(tokenBody.get("client_secret"), "zoho-secret");
  assert.equal(tokenBody.get("refresh_token"), "zoho-refresh");
  const subscribed = new URL(calls[3].url);
  assert.equal(subscribed.searchParams.get("resfmt"), "JSON");
  assert.equal(subscribed.searchParams.get("listkey"), "destin-list-key");
  assert.equal(subscribed.searchParams.get("contactinfo"), "{Contact Email:guest@example.com}");
  assert.equal(subscribed.searchParams.get("source"), "eatingindestin-subscribe");
  assert.equal(calls[3].init.method, "POST");
  assert.equal(calls[3].init.headers.authorization, "Zoho-oauthtoken zoho-access");
  assert.equal(calls.some((call) => call.url.includes("thirty-list-key")), false);
});

test("a guest signup with coupons unchecked still subscribes the Destin list", async () => {
  const calls = [];
  const result = await deliverSubscribe(
    { email: "guest@example.com", audience: "", coupons: false },
    zohoEnv,
    (url, init) => {
      calls.push({ url: String(url), init });
      if (String(url) === ZOHO_TOKEN_URL) return tokenResponse();
      return okResponse();
    },
  );
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
  const subscribed = calls.find((call) => call.url.startsWith(ZOHO_LISTSUBSCRIBE_URL));
  assert.equal(new URL(subscribed.url).searchParams.get("listkey"), "destin-list-key");
  assert.equal(new URL(subscribed.url).searchParams.get("contactinfo"), "{Contact Email:guest@example.com}");
  assert.equal(new URL(subscribed.url).searchParams.get("source"), "eatingindestin-subscribe");
});

test("Zoho credentials without a Destin list key skip the token refresh", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, { ...zohoEnv, ZOHO_LIST_KEY_DESTIN: "" }, () => {
    called = true;
    return okResponse();
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("a partial Zoho secret skips listsubscribe", async () => {
  let called = false;
  const result = await deliverSubscribe(signup, {
    ZOHO_CLIENT_ID: "zoho-client",
    ZOHO_REFRESH_TOKEN: "zoho-refresh",
    ZOHO_LIST_KEY_DESTIN: "destin-list-key",
  }, () => {
    called = true;
    return okResponse();
  });
  assert.equal(called, false);
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
});

test("a Zoho failure still reports Resend and Sheets", async () => {
  const urls = [];
  const result = await deliverSubscribe(signup, { ...bothEnv, ...zohoEnv }, (url) => {
    const href = String(url);
    urls.push(href);
    if (href === ZOHO_TOKEN_URL) return Promise.resolve(new Response("no", { status: 401 }));
    if (href.startsWith(ZOHO_LISTSUBSCRIBE_URL)) return Promise.resolve(new Response("no", { status: 500 }));
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.equal(urls.some((href) => href.startsWith(ZOHO_LISTSUBSCRIBE_URL)), false);
});

test("a Zoho network error still reports Resend and Sheets", async () => {
  const result = await deliverSubscribe(signup, { ...bothEnv, ...zohoEnv }, (url) => {
    if (String(url) === ZOHO_TOKEN_URL) return Promise.reject(new Error("zoho down"));
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
});

test("a token response without an access token skips listsubscribe", async () => {
  const urls = [];
  const result = await deliverSubscribe(signup, { ...bothEnv, ...zohoEnv }, (url) => {
    const href = String(url);
    urls.push(href);
    if (href === ZOHO_TOKEN_URL) {
      return Promise.resolve(new Response(JSON.stringify({ error: "invalid_client" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }));
    }
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
  assert.equal(urls.some((href) => href.startsWith(ZOHO_LISTSUBSCRIBE_URL)), false);
});

test("a non-JSON token response skips listsubscribe", async () => {
  const urls = [];
  const result = await deliverSubscribe(signup, zohoEnv, (url) => {
    const href = String(url);
    urls.push(href);
    if (href === ZOHO_TOKEN_URL) return Promise.resolve(new Response("nope", { status: 200, headers: { "content-type": "text/plain" } }));
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: false, recorded: false });
  assert.equal(urls.some((href) => href.startsWith(ZOHO_LISTSUBSCRIBE_URL)), false);
});

test("a listsubscribe error still reports Resend and Sheets", async () => {
  const result = await deliverSubscribe(signup, { ...bothEnv, ...zohoEnv }, (url) => {
    const href = String(url);
    if (href === ZOHO_TOKEN_URL) return tokenResponse();
    if (href.startsWith(ZOHO_LISTSUBSCRIBE_URL)) return Promise.reject(new Error("list down"));
    return okResponse();
  });
  assert.deepEqual(result, { ok: true, delivered: true, recorded: true });
});

test("a form post still returns HTML when Zoho is configured", async () => {
  const calls = [];
  const request = new Request("https://www.eatingindestin.com/api/subscribe", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      "cf-connecting-ip": "198.51.100.40",
    },
    body: new URLSearchParams({ email: "guest@example.com", audience: "local", coupons: "yes" }),
  });
  const response = await handleSubscribe(request, { ...bothEnv, ...zohoEnv }, (url) => {
    calls.push(String(url));
    if (String(url) === ZOHO_TOKEN_URL) return tokenResponse();
    return okResponse();
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.match(await response.text(), /Thanks\. We have your signup\./);
  assert.equal(calls.filter((url) => url.startsWith(ZOHO_LISTSUBSCRIBE_URL)).length, 1);
  assert.equal(calls.includes(sheetsEnv.GOOGLE_SHEETS_WEBHOOK_URL), true);
  assert.equal(calls.includes("https://api.resend.com/emails"), true);
});

test("a filled honeypot does not call Zoho", async () => {
  let called = false;
  const response = await handleSubscribe(
    postSignup({ ...signup, company: "Acme Bots" }, "198.51.100.41"),
    { ...bothEnv, ...zohoEnv },
    () => {
      called = true;
      return okResponse();
    },
  );
  assert.equal(called, false);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, delivered: false, recorded: false });
});
