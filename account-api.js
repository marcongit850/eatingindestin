/**
 * Same-origin account API for one guide.
 * Account routes and request field names match eatingon30A.
 * Sheet token env names in this copy are for the eatingindestin Worker.
 * The browser talks only to this origin. This Worker calls the shared
 * eating-accounts Worker with ACCOUNTS_SHARED_SECRET.
 *
 * eatingon30a.com and eatingindestin.com do not share a parent domain.
 * This Worker sets ea_session for its own host only (HttpOnly, SameSite=Lax,
 * Secure on https, no Domain attribute). The accounts Worker holds ea_central
 * on its own host and hands this Worker a one-time code.
 *
 * Sign-in coupon boxes use the same request fields on both guides:
 * coupons30a and couponsDestin. marketingOptIn forwarded to eating-accounts
 * is true when either box is checked. After eating-accounts accepts the
 * magic link, a checked box appends one coupon row through the same Apps
 * Script webhook as /api/subscribe. This path does not send a Resend coupon
 * email. On eatingindestin, GOOGLE_SHEETS_WEBHOOK_TOKEN writes site Destin
 * and optional GOOGLE_SHEETS_WEBHOOK_TOKEN_30A writes site 30A. A missing
 * token or a sheet error does not fail the magic link.
 *
 * Signed-in My places opt-in uses the same fields and the same sheet helpers.
 * POST /api/account/coupons reads the email from the session and appends one
 * row per checked box. sourcePage is the My places URL. This path does not
 * send a Resend coupon email. A missing token or a sheet error still returns
 * success. A signed-out request is refused and writes nothing.
 *
 * PUT /api/account/saves forwards note when the body includes it.
 * A note can be updated on a save that already exists on the other guide.
 * That call omits saved, so it cannot create a new save there.
 * Saving a place still has to happen on its own guide.
 */

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SESSION = "ea_session";
const SESSION_SECONDS = 30 * 24 * 60 * 60;
const SIGN_IN_SOURCE = "https://www.eatingindestin.com/account/";
const PLACES_SOURCE = "https://www.eatingindestin.com/my-places/";

export function safeNext(value) {
  const text = String(value || "");
  if (!text) return "/my-places/";
  if (!text.startsWith("/") || text.startsWith("//") || text.startsWith("/api/")) return null;
  if (text.includes("\\") || text.includes("://") || /[\r\n]/.test(text)) return null;
  if (text.length > 300) return null;
  return text;
}

function json(body, status = 200, headers) {
  const out = new Headers({ "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  if (headers) headers.forEach((value, key) => out.append(key, value));
  return new Response(JSON.stringify(body), { status, headers: out });
}

function redirect(location, setCookie) {
  const headers = new Headers({ location, "cache-control": "no-store" });
  if (setCookie) headers.set("set-cookie", setCookie);
  return new Response(null, { status: 302, headers });
}

function secureRequest(request) {
  return new URL(request.url).protocol === "https:";
}

function sessionCookie(token, request, maxAge = SESSION_SECONDS) {
  const parts = [`${SESSION}=${token}`, "HttpOnly", "Path=/", "SameSite=Lax", `Max-Age=${maxAge}`];
  if (secureRequest(request)) parts.push("Secure");
  return parts.join("; ");
}

function clearCookie(request) {
  return sessionCookie("", request, 0);
}

function readCookie(request, name) {
  const header = request.headers.get("cookie") || "";
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return "";
}

function siteId(env) {
  const site = env && env.ACCOUNT_SITE;
  return site === "30a" || site === "destin" ? site : "";
}

async function accountsFetch(env, path, { method = "GET", body, session, ip } = {}) {
  const site = siteId(env);
  const secret = env && env.ACCOUNTS_SHARED_SECRET;
  if (!site || !secret) return null;
  const headers = new Headers({
    accept: "application/json",
    authorization: `Bearer ${secret}`,
    "x-account-site": site,
  });
  if (session) headers.set("x-session", session);
  if (ip) headers.set("x-forwarded-for", ip);
  if (body !== undefined) headers.set("content-type", "application/json");
  const init = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  if (env.ACCOUNTS && typeof env.ACCOUNTS.fetch === "function") {
    return env.ACCOUNTS.fetch(new Request(`https://eating-accounts${path}`, init));
  }
  const origin = String(env.ACCOUNTS_ORIGIN || "").replace(/\/$/, "");
  if (!origin) return null;
  return fetch(`${origin}${path}`, init);
}

async function accountsJson(response) {
  if (!response) return { status: 503, body: { ok: false, error: "Sign-in is not set up yet." } };
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = { ok: false, error: "Sign-in is not set up yet." };
  }
  return { status: response.status, body };
}

function checked(value) {
  return value === true || value === "yes";
}

function couponChoice(body) {
  const source = body && typeof body === "object" ? body : {};
  return {
    coupons30a: checked(source.coupons30a),
    couponsDestin: checked(source.couponsDestin),
  };
}

function optedIn(body) {
  const choice = couponChoice(body);
  if (choice.coupons30a || choice.couponsDestin) return true;
  return body.marketingOptIn === true || body.marketing === true || body.marketing === "yes";
}

async function postCouponRow(env, email, site, token, fetchImpl, sourcePage = SIGN_IN_SOURCE) {
  const url = env && env.GOOGLE_SHEETS_WEBHOOK_URL;
  if (!url || !token) return;
  try {
    await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        site,
        email,
        coupons: true,
        sourcePage,
      }),
    });
  } catch {
    // A sheet miss must not fail sign-in or a My places opt-in.
  }
}

async function recordCouponRows(env, email, body, fetchImpl, sourcePage = SIGN_IN_SOURCE) {
  const choice = couponChoice(body);
  if (choice.couponsDestin) {
    await postCouponRow(env, email, "Destin", env && env.GOOGLE_SHEETS_WEBHOOK_TOKEN, fetchImpl, sourcePage);
  }
  if (choice.coupons30a) {
    await postCouponRow(env, email, "30A", env && env.GOOGLE_SHEETS_WEBHOOK_TOKEN_30A, fetchImpl, sourcePage);
  }
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  try {
    if (type.includes("application/json")) {
      const body = await request.json();
      return body && typeof body === "object" ? body : {};
    }
    if (type.includes("form")) {
      const form = await request.formData();
      return {
        email: form.get("email"),
        marketing: form.get("marketing"),
        coupons30a: form.get("coupons30a"),
        couponsDestin: form.get("couponsDestin"),
        next: form.get("next"),
        slug: form.get("slug"),
        name: form.get("name"),
        area: form.get("area"),
        kind: form.get("kind"),
        site: form.get("site"),
        saved: form.get("saved"),
      };
    }
  } catch {
    return null;
  }
  return null;
}

export async function handleAccount(request, env, fetchImpl = fetch) {
  const url = new URL(request.url);
  const path = url.pathname;
  const site = siteId(env);
  if (!site) return json({ ok: false, error: "Sign-in is not set up yet." }, 503);

  if (path === "/api/account/config" && request.method === "GET") {
    return json({
      ok: true,
      site,
      accountsOrigin: String(env.ACCOUNTS_ORIGIN || "").replace(/\/$/, ""),
    });
  }

  if (path === "/api/account/finish" && request.method === "GET") {
    const next = safeNext(url.searchParams.get("next"));
    if (!next) return redirect(new URL("/account/?need=1", url.origin).toString());
    if (url.searchParams.get("need") === "1") {
      const dest = new URL("/account/", url.origin);
      dest.searchParams.set("need", "1");
      if (next !== "/my-places/") dest.searchParams.set("next", next);
      return redirect(dest.toString());
    }
    const code = url.searchParams.get("code") || "";
    const result = await accountsJson(await accountsFetch(env, "/v1/exchange", {
      method: "POST",
      body: { code, site },
    }));
    if (!result.body || !result.body.token) {
      const dest = new URL("/account/", url.origin);
      dest.searchParams.set("need", "1");
      dest.searchParams.set("error", "expired");
      if (next !== "/my-places/") dest.searchParams.set("next", next);
      return redirect(dest.toString());
    }
    return redirect(new URL(next, url.origin).toString(), sessionCookie(result.body.token, request));
  }

  if (path === "/api/account/request" && request.method === "POST") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const email = String(body.email || "").trim();
    if (!EMAIL.test(email) || email.length > 200) return json({ ok: false, error: "Enter a valid email." }, 400);
    const next = safeNext(body.next);
    if (!next) return json({ ok: false, error: "That return address is not allowed." }, 400);
    const returnTo = new URL("/api/account/finish", url.origin);
    returnTo.searchParams.set("next", next);
    const result = await accountsJson(await accountsFetch(env, "/v1/magic-link", {
      method: "POST",
      ip: request.headers.get("cf-connecting-ip") || "",
      body: {
        email,
        marketingOptIn: optedIn(body),
        site,
        returnTo: returnTo.toString(),
      },
    }));
    if (result.body && result.body.ok === true) {
      await recordCouponRows(env, email, body, fetchImpl);
    }
    return json(result.body, result.status);
  }

  if (path === "/api/account/coupons" && request.method === "POST") {
    const session = readCookie(request, SESSION);
    if (!session) return json({ ok: false, error: "Sign in to join the list." }, 401);
    const me = await accountsJson(await accountsFetch(env, "/v1/me", { session }));
    const user = me.body && me.body.user;
    const email = user && String(user.email || "").trim();
    if (!email || me.status >= 400) return json({ ok: false, error: "Sign in to join the list." }, 401);
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const choice = couponChoice(body);
    if (!choice.coupons30a && !choice.couponsDestin) {
      return json({ ok: false, error: "Choose at least one list." }, 400);
    }
    await recordCouponRows(env, email, choice, fetchImpl, PLACES_SOURCE);
    return json({ ok: true });
  }

  if (path === "/api/account/me" && request.method === "GET") {
    const result = await accountsJson(await accountsFetch(env, "/v1/me", {
      session: readCookie(request, SESSION),
    }));
    if (!result.body || result.status >= 400) return json(result.body || { ok: false, error: "Sign-in is not set up yet." }, result.status);
    if (result.body.user == null) return json({ ok: true, user: null });
    return json({ ok: true, user: result.body.user });
  }

  if (path === "/api/account/logout" && request.method === "POST") {
    await accountsFetch(env, "/v1/logout", {
      method: "POST",
      session: readCookie(request, SESSION),
      body: {},
    });
    return json({ ok: true }, 200, new Headers({ "set-cookie": clearCookie(request) }));
  }

  if (path === "/api/account/saves" && request.method === "GET") {
    const result = await accountsJson(await accountsFetch(env, "/v1/saves", {
      session: readCookie(request, SESSION),
    }));
    return json(result.body, result.status);
  }

  if (path === "/api/account/saves" && request.method === "PUT") {
    const body = await readBody(request);
    if (!body) return json({ ok: false, error: "Send the request as JSON." }, 400);
    const hasSaved = Object.hasOwn(body, "saved");
    const hasNote = Object.hasOwn(body, "note");
    const saved = body.saved === true || body.saved === "true";
    const requestedSite = String(body.site || site);
    if (requestedSite !== "30a" && requestedSite !== "destin") {
      return json({ ok: false, error: "That place could not be saved." }, 400);
    }
    if (!hasSaved && !hasNote) {
      return json({ ok: false, error: "That place could not be saved." }, 400);
    }
    if (saved && requestedSite !== site && !hasNote) {
      return json({ ok: false, error: "Save this place on its own guide." }, 400);
    }
    const forward = {
      slug: body.slug,
      name: body.name,
      area: body.area,
      kind: body.kind,
      site: requestedSite,
    };
    if (hasSaved) forward.saved = saved;
    if (hasNote) forward.note = body.note;
    const result = await accountsJson(await accountsFetch(env, "/v1/saves", {
      method: "PUT",
      session: readCookie(request, SESSION),
      body: forward,
    }));
    return json(result.body, result.status);
  }

  return json({ ok: false, error: "Not found." }, 404);
}
