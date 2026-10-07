import assert from "node:assert/strict";
import test from "node:test";
import { handleAdmin } from "../admin-api.js";
import { mergeCatalog, publicRecords } from "../catalog.js";
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
          return Response.json({ ok: true, listings: rows });
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
  assert.ok(body.cuisines.includes("Seafood"));
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
