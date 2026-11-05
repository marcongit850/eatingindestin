import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { handleAdmin } from "../admin-api.js";
import { isPublicListing, mergeCatalog, publicRecords } from "../catalog.js";
import { baselineFor, invalidateCatalog } from "../catalog-store.js";
import { validateListing } from "../listing-model.js";
import { guideSlugsFor, patchHtml, patchLlms, patchSitemap, renderCard } from "../public-html.js";
import worker from "../worker.js";

const ORIGIN = "https://www.eatingindestin.com";

function accountsEnv({ admin = false, signedIn = false, rows = [] } = {}) {
  return {
    ACCOUNT_SITE: "destin",
    ACCOUNTS_SHARED_SECRET: "test-secret",
    ACCOUNTS_ORIGIN: "https://eating-accounts.352marc.workers.dev",
    CATALOG_FETCH: async () => new Response("[]", { headers: { "content-type": "application/json" } }),
    ACCOUNTS: {
      async fetch(request) {
        const url = new URL(request.url);
        if (url.pathname === "/v1/me") {
          if (!request.headers.get("x-session")) {
            return Response.json({ ok: false }, { status: 401 });
          }
          if (!admin) return Response.json({ ok: true, user: { email: "guest@example.com", isAdmin: false } });
          return Response.json({ ok: true, user: { email: "marc@whpinc.com", isAdmin: true } });
        }
        if (url.pathname === "/v1/catalog") {
          const site = url.searchParams.get("site");
          const listings = rows.filter((row) => !row.site || row.site === site);
          return Response.json({ ok: true, listings });
        }
        return Response.json({ ok: false, error: "Not found." }, { status: 404 });
      },
    },
  };
}

test("the Destin catalog is the baseline and stores no SEO fields", () => {
  const destin = baselineFor("destin");
  assert.ok(destin.length > 100);
  assert.equal(baselineFor("30a").length, 0);
  assert.equal(destin.some((item) => item.area === "Destin Harbor"), true);
  assert.equal(destin.some((item) => item.area === "Miramar Beach"), true);
  const sample = destin[0];
  assert.equal(typeof sample.slug, "string");
  assert.ok(Array.isArray(sample.photos));
  for (const key of ["seo", "metaTitle", "metaDescription", "ogTitle", "canonical", "jsonLd"]) {
    assert.equal(Object.hasOwn(sample, key), false);
  }
});

test("The Edge keeps its baseline waterfront and bar tags when the override omits them", () => {
  const baseline = baselineFor("destin");
  const slug = "the-edge-seafood-restaurant-and-skybar-destin-harbor";
  const edge = baseline.find((item) => item.slug === slug);
  assert.equal(edge.waterfront, true);
  assert.equal(edge.bar, true);
  const payload = { ...edge, notes: "Override without the new flags." };
  delete payload.waterfront;
  delete payload.bar;
  const merged = mergeCatalog(baseline, [{ slug, status: "live", deleted: false, payload }]);
  const out = merged.find((item) => item.slug === slug);
  assert.equal(out.waterfront, true);
  assert.equal(out.bar, true);
  assert.equal(out.notes, "Override without the new flags.");
  assert.equal(publicRecords(merged).find((item) => item.slug === slug).waterfront, true);
  assert.equal(publicRecords(merged).find((item) => item.slug === slug).bar, true);
});

test("an override without waterfront or bar keeps the baseline tags", () => {
  const baseline = [{
    slug: "pier-flag",
    name: "Pier Flag",
    area: "Destin Harbor",
    waterfront: true,
    bar: true,
  }];
  const omitted = mergeCatalog(baseline, [{
    slug: "pier-flag",
    status: "live",
    deleted: false,
    payload: { name: "Pier Flag", area: "Crystal Beach" },
  }]);
  assert.equal(omitted[0].waterfront, true);
  assert.equal(omitted[0].bar, true);
  assert.equal(omitted[0].area, "Crystal Beach");
  assert.equal(publicRecords(omitted)[0].waterfront, true);
  assert.equal(publicRecords(omitted)[0].bar, true);

  const cleared = mergeCatalog(baseline, [{
    slug: "pier-flag",
    status: "live",
    deleted: false,
    payload: { name: "Pier Flag", area: "Destin Harbor", waterfront: false },
  }]);
  assert.equal(cleared[0].waterfront, false);
  assert.equal(cleared[0].bar, true);

  const truthy = mergeCatalog(
    [{ slug: "pier-flag", name: "Pier Flag", area: "Destin Harbor", waterfront: "yes", bar: 1 }],
    [],
  );
  assert.equal(truthy[0].waterfront, false);
  assert.equal(truthy[0].bar, false);
});

test("a listing that includes an SEO field is rejected", () => {
  const rejected = validateListing({ name: "Harbor Docks", area: "Destin Harbor", seo: "custom title" });
  assert.equal(rejected.error, "SEO fields are not editable.");
});

test("a draft is hidden from the directory, sitemap, and llms index", () => {
  const base = [{
    slug: "harbor-test",
    name: "Harbor Test",
    area: "Destin Harbor",
    areaSlug: "destin-harbor",
    photos: [{ id: null, src: "/images/restaurants/harbor-test/01.jpg" }],
    meals: ["Dinner"],
    cuisines: ["Seafood"],
    foods: ["Seafood"],
    price: "$$",
    lat: 30.39,
    lng: -86.51,
    address: "1 Harbor Blvd",
    phone: "",
    notes: "On the harbor",
    label: "HarborWalk Village",
    outdoor: true,
    kids: false,
  }];
  const draft = mergeCatalog(base, [{
    slug: "harbor-test",
    status: "draft",
    deleted: false,
    payload: { ...base[0], area: "Crystal Beach" },
  }]);
  assert.equal(publicRecords(draft).length, 0);
  const live = mergeCatalog(base, [{
    slug: "harbor-test",
    status: "live",
    deleted: false,
    payload: { ...base[0], area: "Crystal Beach" },
  }]);
  assert.equal(publicRecords(live)[0].area, "Crystal Beach");
  assert.equal(publicRecords(live)[0].areaSlug, "crystal-beach");
  assert.equal(publicRecords(live)[0].placeArea, "HarborWalk Village");
  const html = patchHtml(
    `<div id="cards" class="card-grid"><article id="r-harbor-test" class="card card-place" data-area="destin-harbor">Harbor Test</article></div>`,
    "/restaurants/",
    { hidden: draft.filter((item) => item.status === "draft"), placed: [] },
  );
  assert.equal(html.includes("harbor-test"), false);
  const sitemap = patchSitemap(
    `<urlset><url><loc>${ORIGIN}/restaurants/harbor-test/</loc></url></urlset>`,
    { hidden: draft, placed: [] },
  );
  assert.equal(sitemap.includes("harbor-test"), false);
  const llms = patchLlms(`- [Harbor Test](${ORIGIN}/restaurants/harbor-test/): test.\n\n## Areas\n`, {
    hidden: draft,
    placed: [],
  });
  assert.equal(llms.includes("harbor-test"), false);
  const card = renderCard(live[0]);
  assert.match(card, /data-area="crystal-beach"/);
  assert.match(card, /data-laurens="no"/);
  assert.match(card, /data-slug="harbor-test"/);
  assert.ok(guideSlugsFor(live[0]).includes("waterfront-destin"));
  assert.equal(guideSlugsFor(live[0]).includes("destin-harbor-restaurants"), false);
});

test("admin routes require the shared admin account", async () => {
  const denied = await worker.fetch(new Request(`${ORIGIN}/api/admin/listings?site=destin`), accountsEnv());
  assert.equal(denied.status, 401);
  const visitor = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/listings?site=destin`, { headers: { cookie: "ea_session=guest" } }),
    accountsEnv({ signedIn: true }),
  );
  assert.equal(visitor.status, 403);
});

test("the editor offers Destin areas and an empty 30A list", async () => {
  invalidateCatalog("destin");
  const response = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/options`, { headers: { cookie: "ea_session=marc" } }),
    accountsEnv({ admin: true }),
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  const destin = body.sites.find((site) => site.id === "destin");
  const other = body.sites.find((site) => site.id === "30a");
  assert.ok(destin.areas.includes("Destin Harbor"));
  assert.ok(destin.areas.includes("Crystal Beach"));
  assert.deepEqual(other.areas, []);
  assert.ok(body.guides.destin.cuisines.includes("Chinese"));
  assert.equal(body.guides.destin.cuisines.includes("Latin Coastal"), false);
  assert.deepEqual(body.guides["30a"].areas, []);
  assert.deepEqual(body.guides["30a"].cuisines, []);
  assert.deepEqual(body.guides["30a"].meals, []);
  assert.deepEqual(body.guides["30a"].foods, []);
  assert.ok(body.cuisines.includes("Seafood"));
  assert.equal(body.cuisines.includes("Latin Coastal"), false);
});

test("a draft overlay is removed from the public directory and profile", async () => {
  invalidateCatalog("destin");
  const slug = baselineFor("destin")[0].slug;
  const env = accountsEnv({
    rows: [{ slug, status: "draft", deleted: false, payload: { name: "Hidden Place", area: "Destin Harbor" } }],
  });
  env.ASSETS = {
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/404.html") {
        return new Response(
          `<link rel="canonical" href="${ORIGIN}/404.html"><meta name="robots" content="noindex">That page is not on the menu.`,
          { headers: { "content-type": "text/html" } },
        );
      }
      if (path === "/sitemap.xml") {
        return new Response(
          `<urlset><url><loc>${ORIGIN}/restaurants/${slug}/</loc></url><url><loc>${ORIGIN}/areas/destin-harbor/</loc></url></urlset>`,
          { headers: { "content-type": "application/xml" } },
        );
      }
      if (path === "/restaurants/" || path === "/restaurants/index.html") {
        return new Response(`<div id="cards" class="card-grid"><article id="r-${slug}" class="card card-place">${slug}</article></div>`, {
          headers: { "content-type": "text/html" },
        });
      }
      return new Response(`built ${slug}`, { headers: { "content-type": "text/html" } });
    },
  };
  const directory = await worker.fetch(new Request(`${ORIGIN}/restaurants/`), env);
  assert.equal((await directory.text()).includes(slug), false);
  const profile = await worker.fetch(new Request(`${ORIGIN}/restaurants/${slug}/`), env);
  assert.equal(profile.status, 404);
  const profileHtml = await profile.text();
  assert.equal(profileHtml.includes("404.html"), false);
  assert.equal(profileHtml.includes('rel="canonical"'), false);
  assert.equal(profile.headers.get("x-robots-tag"), "noindex");
  const sitemap = await worker.fetch(new Request(`${ORIGIN}/sitemap.xml`), env);
  const xml = await sitemap.text();
  assert.equal(xml.includes(`/restaurants/${slug}/`), false);
  assert.equal(xml.includes("/areas/destin-harbor/"), true);
  const json = await worker.fetch(new Request(`${ORIGIN}/data/restaurants.json`), env);
  const records = await json.json();
  assert.equal(records.some((item) => item.slug === slug), false);
});

function jsonCatalog(rows, status = 200) {
  return new Response(JSON.stringify(rows), {
    status,
    headers: { "content-type": "application/json" },
  });
}

test("an override with no name does not crash the merge and stays off the public guide", () => {
  const merged = mergeCatalog([], [
    { slug: "seagrove-village-market-cafe-seagrove-beach", status: "inactive", deleted: false, payload: {} },
    { slug: "village-market-cafe-bar-watersound-origins", status: "inactive", deleted: false, payload: {} },
    { slug: "the-daytrader-tiki-bar-and-restaurant-seaside", status: "live", deleted: false, payload: { name: "The Daytrader Tiki Bar & Restaurant", area: "Seaside" } },
  ]);
  assert.equal(merged.length, 3);
  const cafe = merged.find((item) => item.slug === "seagrove-village-market-cafe-seagrove-beach");
  const origins = merged.find((item) => item.slug === "village-market-cafe-bar-watersound-origins");
  assert.equal(cafe.name, "");
  assert.equal(cafe.status, "inactive");
  assert.equal(origins.name, "");
  assert.equal(origins.status, "inactive");
  assert.equal(isPublicListing(cafe), false);
  assert.equal(publicRecords(merged).some((item) => item.slug === cafe.slug || item.slug === origins.slug), false);
  assert.equal(publicRecords(merged).some((item) => item.slug === "the-daytrader-tiki-bar-and-restaurant-seaside"), true);
});

test("the Destin admin loads the 30A baseline and the other host can load Destin", async () => {
  invalidateCatalog();
  const daytrader = {
    slug: "the-daytrader-tiki-bar-and-restaurant-seaside",
    name: "The Daytrader Tiki Bar & Restaurant",
    area: "Seaside",
    waterfront: true,
    bar: false,
  };
  const seagrove = {
    slug: "seagrove-village-market-cafe-seagrove-beach",
    name: "Seagrove Village Market Café",
    area: "Seagrove Beach",
  };
  const originsCafe = {
    slug: "village-market-cafe-bar-watersound-origins",
    name: "Village Market Café + Bar",
    area: "Watersound Origins",
  };
  const harbor = { slug: "harbor-baseline", name: "Harbor Baseline", area: "Destin Harbor" };
  const localSlug = baselineFor("destin")[0].slug;
  const fetched = [];
  const fromDestin = accountsEnv({
    admin: true,
    rows: [
      { site: "30a", slug: seagrove.slug, status: "inactive", deleted: false, payload: {} },
      { site: "30a", slug: originsCafe.slug, status: "inactive", deleted: false, payload: {} },
      { site: "30a", slug: "orphan-empty-row", status: "inactive", deleted: false, payload: {} },
      { site: "destin", slug: localSlug, status: "live", deleted: false, payload: { name: "Overlay Name", area: "Destin Harbor" } },
    ],
  });
  fromDestin.CATALOG_FETCH = async (url, init) => {
    fetched.push({ url: String(url), init });
    assert.equal(url, "https://www.eatingon30a.com/data/catalog.json");
    assert.equal(init.redirect, "error");
    assert.equal(init.credentials, undefined);
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.cookie, undefined);
    assert.equal(init.headers.accept, "application/json");
    return jsonCatalog([
      daytrader,
      seagrove,
      originsCafe,
      { slug: "", name: "Dropped" },
      { slug: "nameless", name: "" },
      null,
    ]);
  };
  const marc = { headers: { cookie: "ea_session=marc" } };
  const anonymous = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`), fromDestin);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).ok, false);
  assert.equal(fetched.length, 0);

  const switched = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), fromDestin);
  const switchedBody = await switched.json();
  assert.equal(switched.status, 200, JSON.stringify(switchedBody));
  assert.equal(switched.headers.get("content-type").includes("json"), true);
  const found = switchedBody.listings.find((item) => item.slug === daytrader.slug);
  assert.equal(found.name, daytrader.name);
  assert.equal(found.area, "Seaside");
  assert.equal(found.status, "live");
  const cafe = switchedBody.listings.find((item) => item.slug === seagrove.slug);
  assert.equal(cafe.name, seagrove.name);
  assert.equal(cafe.area, "Seagrove Beach");
  assert.equal(cafe.status, "inactive");
  const otherCafe = switchedBody.listings.find((item) => item.slug === originsCafe.slug);
  assert.equal(otherCafe.status, "inactive");
  assert.equal(otherCafe.name, originsCafe.name);
  const orphan = switchedBody.listings.find((item) => item.slug === "orphan-empty-row");
  assert.equal(orphan.name, "");
  assert.equal(orphan.status, "inactive");
  assert.equal(switchedBody.listings.some((item) => item.slug === "nameless" || item.slug === ""), false);
  assert.equal(fetched.length, 1);
  assert.equal(fetched[0].url, "https://www.eatingon30a.com/data/catalog.json");

  const again = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), fromDestin);
  assert.equal(again.status, 200);
  assert.equal(fetched.length, 1);

  const local = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=destin`, marc), fromDestin);
  const localBody = await local.json();
  assert.equal(local.status, 200);
  assert.ok(localBody.listings.length > 100);
  const overlaid = localBody.listings.find((item) => item.slug === localSlug);
  assert.equal(overlaid.name, "Overlay Name");
  assert.equal(overlaid.status, "live");
  assert.equal(localBody.listings.some((item) => item.slug === daytrader.slug), false);
  assert.equal(fetched.length, 1);

  const outsider = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=https://evil.example`, marc), fromDestin);
  assert.equal(outsider.status, 400);
  assert.equal(fetched.length, 1);

  invalidateCatalog();
  fromDestin.CATALOG_FETCH = async () => {
    throw new Error("network down");
  };
  const offline = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), fromDestin);
  const offlineBody = await offline.json();
  assert.equal(offline.status, 503);
  assert.equal(offline.headers.get("content-type").includes("json"), true);
  assert.match(offlineBody.error, /Eating on 30A listings could not be loaded/);

  fromDestin.CATALOG_FETCH = async () => new Response("<html>challenge</html>", {
    status: 403,
    headers: { "content-type": "text/html" },
  });
  const blocked = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), fromDestin);
  const blockedBody = await blocked.json();
  assert.equal(blocked.status, 503);
  assert.match(blockedBody.error, /Eating on 30A listings could not be loaded/);

  fromDestin.CATALOG_FETCH = async () => jsonCatalog({ ok: true }, 200);
  const notAList = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), fromDestin);
  assert.equal(notAList.status, 503);
  assert.equal((await notAList.json()).ok, false);

  const guest = await handleAdmin(
    new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc),
    accountsEnv({ signedIn: true }),
  );
  assert.equal(guest.status, 403);

  invalidateCatalog();
  const from30a = accountsEnv({
    admin: true,
    rows: [{ site: "destin", slug: harbor.slug, status: "draft", deleted: false, payload: { notes: "Keep the baseline name." } }],
  });
  from30a.ACCOUNT_SITE = "30a";
  let destinFetches = 0;
  from30a.CATALOG_FETCH = async (url, init) => {
    destinFetches += 1;
    assert.equal(url, "https://www.eatingindestin.com/data/catalog.json");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, undefined);
    return jsonCatalog([harbor, { slug: "skip-me" }]);
  };
  const otherWay = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=destin`, marc), from30a);
  const otherBody = await otherWay.json();
  assert.equal(otherWay.status, 200, JSON.stringify(otherBody));
  const harborRow = otherBody.listings.find((item) => item.slug === harbor.slug);
  assert.equal(harborRow.name, harbor.name);
  assert.equal(harborRow.area, "Destin Harbor");
  assert.equal(harborRow.status, "draft");
  assert.equal(otherBody.listings.some((item) => item.slug === "skip-me"), false);
  assert.equal(destinFetches, 1);
  const ownGuide = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings?site=30a`, marc), from30a);
  assert.equal(ownGuide.status, 200);
  assert.equal(destinFetches, 1);
  const ownBody = await ownGuide.json();
  assert.ok(ownBody.listings.length > 100);
  assert.equal(ownBody.listings.some((item) => item.slug === localSlug), true);
});

test("guide choices keep stored cuisine, meal, and food values, including an inactive save", async () => {
  const source = readFileSync(new URL("../admin.js", import.meta.url), "utf8");
  const start = source.indexOf("function escapeHtml");
  const end = source.indexOf("function flag");
  const ui = Function(`${source.slice(start, end)}; return { choiceList: choiceList, checks: checks };`)();
  const boxes = ui.checks(
    "cuisines",
    "Cuisines",
    ui.choiceList(["American", "Seafood"], ["Latin Coastal", "Seafood"]),
    ["Latin Coastal", "Seafood"],
  );
  assert.match(boxes, /value="Latin Coastal"[^>]*checked/);
  assert.match(boxes, /value="Seafood"[^>]*checked/);
  assert.equal(/value="American"[^>]*checked/.test(boxes), false);
  const meals = ui.checks(
    "meals",
    "Meals",
    ui.choiceList(["Lunch", "Dinner", "Late Night"], ["Dinner"]),
    ["Dinner"],
  );
  assert.match(meals, /value="Dinner"[^>]*checked/);
  assert.match(meals, /value="Late Night"/);
  assert.equal(/value="Late Night"[^>]*checked/.test(meals), false);
  assert.match(source, /value: "inactive"/);

  invalidateCatalog();
  const stored = [];
  const env = accountsEnv({ admin: true });
  let fetched = 0;
  env.CATALOG_FETCH = async (url, init) => {
    fetched += 1;
    assert.equal(url, "https://www.eatingon30a.com/data/catalog.json");
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.authorization, undefined);
    assert.equal(init.headers.cookie, undefined);
    return jsonCatalog([{
      slug: "laco-seacrest",
      name: "LaCo",
      area: "Seacrest",
      cuisines: ["Latin Coastal"],
      meals: ["Lunch", "Dinner", "Late Night"],
      foods: ["Tacos", "Ceviches", "Authentic Latin"],
      waterfront: true,
      bar: false,
      price: "$$",
    }]);
  };
  env.ACCOUNTS.fetch = async (request) => {
    const url = new URL(request.url);
    if (url.pathname === "/v1/me") {
      if (!request.headers.get("x-session")) return Response.json({ ok: false }, { status: 401 });
      return Response.json({ ok: true, user: { email: "marc@whpinc.com", isAdmin: true } });
    }
    if (url.pathname === "/v1/catalog") {
      const site = url.searchParams.get("site");
      return Response.json({ ok: true, listings: stored.filter((row) => row.site === site) });
    }
    const one = url.pathname.match(/^\/v1\/admin\/listings\/([a-z0-9-]+)$/);
    if (one && (request.method === "PUT" || request.method === "POST")) {
      const body = await request.json();
      const slug = one[1];
      const row = { site: body.site, slug, status: body.status || "live", deleted: false, payload: body };
      const index = stored.findIndex((item) => item.site === body.site && item.slug === slug);
      if (index >= 0) stored[index] = row;
      else stored.push(row);
      return Response.json({ ok: true, listing: { slug, status: row.status, payload: body } });
    }
    return Response.json({ ok: false, error: "Not found." }, { status: 404 });
  };
  const marc = { headers: { cookie: "ea_session=marc" } };
  const anonymous = await handleAdmin(new Request(`${ORIGIN}/api/admin/options`), env);
  assert.equal(anonymous.status, 401);
  assert.equal(fetched, 0);

  const options = await handleAdmin(new Request(`${ORIGIN}/api/admin/options`, marc), env);
  const optionsBody = await options.json();
  assert.equal(options.status, 200, JSON.stringify(optionsBody));
  assert.equal(optionsBody.guides["30a"].cuisines.includes("Latin Coastal"), true);
  assert.equal(optionsBody.guides["30a"].cuisines.includes("Chinese"), false);
  assert.equal(optionsBody.guides["30a"].meals.includes("Late Night"), true);
  assert.equal(optionsBody.guides["30a"].foods.includes("Authentic Latin"), true);
  assert.deepEqual(optionsBody.guides["30a"].areas, []);
  assert.equal(optionsBody.guides.destin.cuisines.includes("Chinese"), true);
  assert.equal(optionsBody.guides.destin.cuisines.includes("Latin Coastal"), false);
  assert.equal(optionsBody.guides.destin.meals.includes("Late Night"), false);
  assert.equal(optionsBody.guides.destin.foods.includes("Authentic Latin"), false);
  assert.equal(optionsBody.guides.destin.areas.includes("Destin Harbor"), true);
  assert.equal(optionsBody.cuisines.includes("Latin Coastal"), false);
  assert.equal(optionsBody.cuisines.includes("Chinese"), true);

  const laco = await (await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/laco-seacrest?site=30a`, marc), env)).json();
  assert.equal(laco.listing.name, "LaCo");
  assert.equal(laco.listing.waterfront, true);
  assert.equal(laco.listing.bar, false);
  assert.deepEqual(laco.listing.cuisines, ["Latin Coastal"]);
  assert.deepEqual(laco.listing.meals, ["Lunch", "Dinner", "Late Night"]);
  assert.equal(laco.listing.foods.includes("Authentic Latin"), true);
  const kept = ui.choiceList(optionsBody.guides["30a"].cuisines, laco.listing.cuisines);
  assert.equal(kept.includes("Latin Coastal"), true);
  const hiddenOnDestin = optionsBody.guides.destin.cuisines.filter((value) => laco.listing.cuisines.includes(value));
  assert.equal(hiddenOnDestin.includes("Latin Coastal"), false);

  const saved = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/laco-seacrest`, {
    method: "PUT",
    headers: { ...marc.headers, "content-type": "application/json" },
    body: JSON.stringify({ ...laco.listing, status: "inactive", phone: "(850) 555-0100" }),
  }), env);
  assert.equal(saved.status, 200, JSON.stringify(await saved.clone().json()));
  const again = await (await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/laco-seacrest?site=30a`, marc), env)).json();
  assert.equal(again.listing.status, "inactive");
  assert.deepEqual(again.listing.cuisines, ["Latin Coastal"]);
  assert.deepEqual(again.listing.meals, ["Lunch", "Dinner", "Late Night"]);
  assert.equal(again.listing.foods.includes("Authentic Latin"), true);
  assert.equal(again.listing.phone, "(850) 555-0100");
  assert.equal(again.listing.waterfront, true);
  assert.equal(again.listing.bar, false);

  const trimmed = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/laco-seacrest`, {
    method: "PUT",
    headers: { ...marc.headers, "content-type": "application/json" },
    body: JSON.stringify({ ...again.listing, meals: ["Dinner"] }),
  }), env);
  assert.equal(trimmed.status, 200, JSON.stringify(await trimmed.clone().json()));
  const trimmedBody = await (await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/laco-seacrest?site=30a`, marc), env)).json();
  assert.deepEqual(trimmedBody.listing.meals, ["Dinner"]);
  assert.deepEqual(trimmedBody.listing.cuisines, ["Latin Coastal"]);
  assert.equal(trimmedBody.listing.foods.includes("Authentic Latin"), true);
  assert.equal(trimmedBody.listing.status, "inactive");

  const local = baselineFor("destin").find((item) => (item.cuisines || []).includes("Chinese"));
  assert.ok(local, "Destin baseline should include a Chinese cuisine listing");
  const destinListing = await (await handleAdmin(
    new Request(`${ORIGIN}/api/admin/listings/${local.slug}?site=destin`, marc),
    env,
  )).json();
  assert.equal(destinListing.listing.cuisines.includes("Chinese"), true);
  const keptLocal = ui.choiceList(optionsBody.guides["30a"].cuisines, destinListing.listing.cuisines);
  assert.equal(keptLocal.includes("Chinese"), true);
  const localSaved = await handleAdmin(new Request(`${ORIGIN}/api/admin/listings/${local.slug}`, {
    method: "PUT",
    headers: { ...marc.headers, "content-type": "application/json" },
    body: JSON.stringify({ ...destinListing.listing, phone: "(850) 555-0199" }),
  }), env);
  assert.equal(localSaved.status, 200, JSON.stringify(await localSaved.clone().json()));
  const localAgain = await (await handleAdmin(
    new Request(`${ORIGIN}/api/admin/listings/${local.slug}?site=destin`, marc),
    env,
  )).json();
  assert.equal(localAgain.listing.cuisines.includes("Chinese"), true);
  assert.deepEqual(localAgain.listing.meals, destinListing.listing.meals);
  assert.deepEqual(localAgain.listing.foods, destinListing.listing.foods);
  assert.equal(localAgain.listing.phone, "(850) 555-0199");
  assert.equal(localAgain.listing.waterfront, destinListing.listing.waterfront);
  assert.equal(localAgain.listing.bar, destinListing.listing.bar);

  invalidateCatalog();
  env.CATALOG_FETCH = async () => new Response("<html>challenge</html>", {
    status: 403,
    headers: { "content-type": "text/html" },
  });
  const degraded = await handleAdmin(new Request(`${ORIGIN}/api/admin/options`, marc), env);
  const degradedBody = await degraded.json();
  assert.equal(degraded.status, 200, JSON.stringify(degradedBody));
  assert.equal(degradedBody.guides.destin.cuisines.includes("Chinese"), true);
  assert.equal(degradedBody.guides.destin.areas.includes("Destin Harbor"), true);
  assert.deepEqual(degradedBody.guides["30a"].cuisines, []);
  assert.deepEqual(degradedBody.guides["30a"].meals, []);
  assert.deepEqual(degradedBody.guides["30a"].foods, []);
  const guestEnv = accountsEnv({ signedIn: true });
  const guest = await handleAdmin(new Request(`${ORIGIN}/api/admin/options`, marc), guestEnv);
  assert.equal(guest.status, 403);
});
