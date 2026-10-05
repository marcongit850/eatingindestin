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

test("sign-in checkbox is off unless the visitor checks it", () => {
  const html = readFileSync(new URL("../account/index.html", import.meta.url), "utf8");
  const input = html.match(/<input name="marketing"[^>]*>/);
  assert.ok(input, "marketing checkbox should be on the sign-in page");
  assert.equal(input[0].includes("checked"), false);
  assert.match(html, /Email me occasional updates from Eating on 30A and Eating in Destin/);
  assert.equal(html.includes("—"), false);
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

test("a checked marketing box is forwarded as an opt-in", async () => {
  let body = null;
  await handleAccount(new Request(`${origin}/api/account/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "guest@example.com", marketingOptIn: true }),
  }), envWith(async (request) => {
    body = await request.json();
    return new Response(JSON.stringify({ ok: true, delivered: true }), { status: 200 });
  }));
  assert.equal(body.marketingOptIn, true);
  assert.equal(body.site, "destin");
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
