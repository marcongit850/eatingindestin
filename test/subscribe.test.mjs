import assert from "node:assert/strict";
import test from "node:test";
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

function okResponse() {
  return Promise.resolve(new Response("{}", { status: 200 }));
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
