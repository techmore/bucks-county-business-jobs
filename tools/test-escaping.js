// Safety test: listing data must never become markup, script or an unsafe link.
//
// Feeds records with hostile names, descriptions, addresses and javascript:/data: links through
// every function that turns a record into HTML (assets/app.js, assets/pathway.js and
// tools/build-pages.js) and checks that nothing executable comes out. No dependencies.
//
//   node --no-warnings tools/test-escaping.js
//
// Exits 1 and lists the problems if any check fails.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// ---------- hostile records ----------

const XSS = `<script>alert(1)</script> <img src=x onerror=alert(2)> "' onmouseover="alert(3)" x='`;
function hostile(overrides = {}) {
  return {
    name: `${XSS} Deli`,
    slug: `evil" onclick="alert(4)" x="<script>alert(5)</script>`,
    latitude: 40.48,
    longitude: -75.1,
    address: `1 "><iframe src=javascript:alert(6)></iframe> St, Evil"<b onclick=alert(7)>town, PA, 18947`,
    total_employees: `<img src=x onerror=alert(8)>`,
    hiring: true,
    years_in_business: `<img src=x onerror=alert(9)>`,
    best_places_score: `"><script>alert(10)</script>`,
    onboarding_note: `</strong><script>alert(11)</script>`,
    category: `Dining"><script>alert(12)</script>`,
    website: "javascript:alert(13)",
    description: `</p><script>alert(14)</script><svg onload=alert(15)>`,
    logo_url: null,
    source_name: `<script>alert(16)</script>`,
    source_url: "javascript:alert(17)",
    data_status: `needs-audit"><script>alert(18)</script>`,
    hiring_status: "hiring",
    hiring_signal: `hiring_likely"><script>alert(19)</script>`,
    hiring_last_checked: `"><script>alert(20)</script>`,
    hiring_evidence_url: " \tjava\nscript:alert(21)",
    hiring_note: `<script>alert(22)</script>`,
    hiring_track: `<script>alert(23)</script>`,
    verification_note: `<script>alert(24)</script>`,
    phone: `"><script>alert(25)</script>555`,
    opening_hours: `"><script>alert(26)</script>`,
    founded_label: `<script>alert(27)</script>`,
    founded_note: `--><script>alert(28)</script>`,
    founded_source_url: "data:text/html,<script>alert(29)</script>",
    photo_url: "javascript:alert(30)",
    photo_credit_url: "vbscript:alert(31)",
    start_date: `<script>alert(32)</script>`,
    established: true,
    established_employer: true,
    ...overrides
  };
}

// Same hostile text, but with http(s) links that try to break out of the attribute instead.
const QUOTED = `https://ok.example/a"onmouseover="alert(40)"x="`;
const records = [
  hostile(),
  hostile({
    slug: "second-hostile",
    website: QUOTED,
    source_url: `https://ok.example/'onmouseover='alert(41)`,
    hiring_evidence_url: `https://ok.example/"><script>alert(42)</script>`,
    founded_source_url: QUOTED,
    photo_url: `https://ok.example/x.jpg"onerror="alert(43)`,
    photo_credit_url: QUOTED,
    hiring_status: "careers_page"
  }),
  hostile({ slug: "third-hostile", website: "data:text/html,<script>alert(44)</script>", source_url: "//evil.example/x", hiring_evidence_url: "JAVASCRIPT:alert(45)", hiring_status: "nope" }),
  // No website (the "needs website" queue) and each audit result the review pages list.
  hostile({ slug: "fourth-hostile", website: null, hiring_signal: "unknown", hiring_status: "no_online_info" }),
  hostile({ slug: "fifth-hostile", website: "https://ok.example/", hiring_signal: "hiring_likely", established_employer: false })
];

// ---------- a small, strict HTML checker ----------

const TAGS = new Set(
  ("a article b body br button div em figcaption figure footer h1 h2 h3 head header html i img li link main meta nav option p script section small span strong table tbody td th thead title tr ul").split(" ")
);
const decode = (text) =>
  text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name) => ({ amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" })[name]);
const TAG = /^<(\/?)([a-zA-Z][a-zA-Z0-9]*)((?:\s+[^\s"'<>=\/]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'<>=`]+))?)*)\s*\/?>/;
const ATTR = /([^\s"'<>=\/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'<>=`]+)))?/g;

// Returns { problems, tokens }. tokens are used to compare two renderings of the same record.
function inspect(html, label) {
  const problems = [];
  const tokens = [];
  const scripts = [];
  let i = 0;
  let text = "";
  const flush = () => {
    if (text.trim()) tokens.push(`text:${decode(text).replace(/\s+/g, " ").trim()}`);
    text = "";
  };
  while (i < html.length) {
    const ch = html[i];
    if (ch !== "<") {
      text += ch;
      i += 1;
      continue;
    }
    if (html.startsWith("<!doctype html>", i)) {
      i += "<!doctype html>".length;
      continue;
    }
    const match = TAG.exec(html.slice(i));
    if (!match) {
      problems.push(`${label}: a "<" that isn't one of our own tags near: ${JSON.stringify(html.slice(i, i + 60))}`);
      text += ch;
      i += 1;
      continue;
    }
    flush();
    const [whole, closing, rawName, rawAttrs] = match;
    const name = rawName.toLowerCase();
    if (!TAGS.has(name)) problems.push(`${label}: unexpected <${name}> tag`);
    const attrs = [];
    if (!closing) {
      for (const attr of rawAttrs.matchAll(ATTR)) {
        const key = attr[1].toLowerCase();
        const value = decode(attr[2] ?? attr[3] ?? attr[4] ?? "");
        attrs.push(`${key}=${value}`);
        if (/^on/.test(key)) problems.push(`${label}: event handler attribute ${key} on <${name}>`);
        if (key === "srcdoc" || key === "formaction") problems.push(`${label}: ${key} attribute on <${name}>`);
        if (key === "href" || key === "src") {
          const compact = value.replace(/[\u0000- ]/g, "");
          const scheme = (compact.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/) || [])[1];
          if (scheme && !["http", "https", "tel"].includes(scheme.toLowerCase())) problems.push(`${label}: ${key} uses ${scheme}: on <${name}>`);
          if (scheme && scheme.toLowerCase() === "tel" && !/^tel:[\d+]*$/.test(compact)) problems.push(`${label}: tel: link isn't digits: ${compact}`);
          if (compact.startsWith("//")) problems.push(`${label}: protocol-relative ${key} on <${name}>`);
          if (name === "img" && !/^https?:\/\//i.test(compact)) problems.push(`${label}: <img> src isn't http(s): ${compact}`);
          if (name === "script" && !compact.startsWith("https://unpkg.com/leaflet")) problems.push(`${label}: <script> src isn't the Leaflet library: ${compact}`);
        }
      }
    }
    tokens.push(`${closing ? "/" : ""}${name} ${attrs.join(" | ")}`.trim());
    i += whole.length;
    // Script bodies are not HTML: capture them whole and check them separately.
    if (name === "script" && !closing) {
      const end = html.toLowerCase().indexOf("</script", i);
      if (end < 0) problems.push(`${label}: unclosed <script>`);
      scripts.push({ attrs: attrs.join(" "), body: html.slice(i, end < 0 ? html.length : end) });
      i = end < 0 ? html.length : end;
    }
  }
  flush();
  return { problems, tokens, scripts };
}

// ---------- load the browser code into a sandbox with a fake page ----------

function fakeDocument(slug) {
  const elements = new Map();
  const element = (key) => {
    if (!elements.has(key)) {
      const node = {
        key,
        innerHTML: "",
        textContent: "",
        value: "",
        checked: false,
        hidden: false,
        options: [],
        dataset: {},
        addEventListener() {},
        setAttribute() {},
        querySelector: (selector) => element(`${key} ${selector}`),
        querySelectorAll: () => []
      };
      if (/radius/.test(key)) node.value = "10";
      elements.set(key, node);
    }
    return elements.get(key);
  };
  return {
    elements,
    title: "",
    body: { dataset: { companySlug: slug } },
    addEventListener() {},
    getElementById: (id) => element(`#${id}`),
    querySelector: (selector) => element(selector),
    querySelectorAll: () => []
  };
}

function sandbox({ slug = "", search = "", pathname = "/directory.html", storage = {}, companies = [] } = {}) {
  const document = fakeDocument(slug);
  const chain = new Proxy(function () {}, {
    get: (_, prop) => (prop === "markerClusterGroup" || prop === "then" ? undefined : chain),
    apply: () => chain,
    construct: () => chain
  });
  const location = { pathname, search, replace(url) { location.replaced = url; } };
  const history = { replaceState() {} };
  const context = {
    document,
    location,
    history,
    console,
    Intl,
    URL,
    URLSearchParams,
    setTimeout,
    clearTimeout,
    L: chain,
    navigator: {},
    localStorage: { getItem: (key) => storage[key] ?? null, setItem() {}, removeItem() {} },
    fetch: async () => ({ ok: true, json: async () => JSON.parse(JSON.stringify(companies)) })
  };
  context.window = context;
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(read("assets/guide.js"), context, { filename: "guide.js" });
  return context;
}

// Everything app.js can put on a page for these records: returns [label, html] pairs.
function renderApp(appSource, list) {
  const out = [];
  const collect = (label, document) => {
    for (const [key, node] of document.elements) if (node.innerHTML) out.push([`${label} ${key}`, node.innerHTML]);
  };
  const load = (options) => {
    const context = sandbox(options);
    vm.runInContext(appSource, context, { filename: "app.js" });
    return context;
  };

  let context = load();
  for (const company of list) {
    out.push([`companyCard(${company.slug})`, context.companyCard(company)]);
    out.push([`popupHtml(${company.slug})`, context.popupHtml(company)]);
    out.push([`websiteAction(${company.slug})`, context.websiteAction(company)]);
  }
  const mapApi = { render() {}, focus() {}, map: { fitBounds() {} } };
  context.initMapExplorer(list, mapApi);
  context.renderFeatured(list);
  collect("home", context.document);

  for (const [name, pathname] of [["initDirectory", "/directory.html"], ["initHiringAudit", "/hiring-audit.html"], ["initDataQuality", "/data-quality.html"]]) {
    context = load({ pathname });
    context[name](list);
    collect(name, context.document);
  }
  for (const company of list) {
    // Pre-rendered pages set the slug on <body>; the legacy page reads it from ?slug=.
    for (const options of [{ slug: company.slug, pathname: "/company/x.html" }, { search: `?slug=${encodeURIComponent(company.slug)}`, pathname: "/company/index.html" }]) {
      context = load(options);
      context.initDetail(list);
      collect(`initDetail(${company.slug})`, context.document);
      if (context.location.replaced) out.push(["initDetail redirect", `<a href="${context.location.replaced.replace(/"/g, "&quot;")}">x</a>`]);
    }
  }
  return out;
}

async function renderPathway(source, list) {
  const out = [];
  const storage = { "bcbj-profile-v1": JSON.stringify({ saved: list.map((company) => company.slug), recent: [{ label: `<script>alert(50)</script>`, zip: "18947", picks: [] }] }) };
  const context = sandbox({ search: "?zip=18947&r=10", pathname: "/find-work.html", storage, companies: list });
  vm.runInContext(source, context, { filename: "pathway.js" });
  await new Promise((resolve) => setTimeout(resolve, 50));
  for (const [key, node] of context.document.elements) if (node.innerHTML) out.push([`find-work ${key}`, node.innerHTML]);
  return out;
}

function renderPages(buildPages, list) {
  const checks = [{ checked: "2026-11-01", signal: `<script>alert(60)</script>`, evidence_url: "javascript:alert(61)" }, { checked: `"><script>alert(62)</script>`, signal: "hiring_likely", evidence_url: QUOTED }];
  return list.map((company) => [
    `build-pages page(${company.slug})`,
    buildPages.page({ ...company, slug: "safe-slug", town: `Evil"<b onclick=alert(7)>town`, address_approximate: 0 }, checks)
  ]);
}

// ---------- run ----------

async function main() {
  const problems = [];
  const check = (condition, message) => {
    if (!condition) problems.push(message);
  };
  const rendered = [];

  rendered.push(...renderApp(read("assets/app.js"), records));
  rendered.push(...(await renderPathway(read("assets/pathway.js"), records)));
  const buildPages = require("./build-pages.js");
  const pages = renderPages(buildPages, records);
  rendered.push(...pages);

  for (const [label, html] of rendered) {
    const result = inspect(html, label);
    problems.push(...result.problems);
    for (const script of result.scripts) {
      if (/application\/ld\+json/.test(script.attrs)) {
        check(!script.body.includes("<"), `${label}: JSON-LD contains "<"`);
        try {
          const data = JSON.parse(script.body);
          check(!data.url || /^https?:\/\//.test(data.url), `${label}: JSON-LD url isn't http(s)`);
          check(!data.image || /^https?:\/\//.test(data.image), `${label}: JSON-LD image isn't http(s)`);
        } catch {
          problems.push(`${label}: JSON-LD is not valid JSON`);
        }
      } else if (script.body.trim()) {
        check(!/alert|onerror|javascript:/i.test(script.body) && /var here = \[-?\d+(\.\d+)?, -?\d+(\.\d+)?\];/.test(script.body), `${label}: listing data reached an inline script`);
      }
    }
    // The hostile text must still be visible to the reader, as text.
    if (/companyCard|initDetail\(.*data-company-detail|page\(/.test(label)) check(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"), `${label}: the name was not shown as escaped text`);
  }
  const labels = rendered.map(([label]) => label).join("\n");
  for (const needle of ["companyCard", "popupHtml", "websiteAction", "home [data-featured-companies]", "home [data-map-filters] [data-map='town']", "initDirectory [data-directory-results]", "initDirectory [data-filter='category']", "initDirectory [data-filter='town']", "initHiringAudit [data-audit-results]", "initHiringAudit [data-audit-filter='town']", "initDataQuality [data-quality-town-coverage]", "initDataQuality [data-quality-town-summary]", "initDataQuality [data-quality-website-queue]", "initDataQuality [data-quality-unknown-queue]", "initDataQuality [data-quality-positive-queue]", "[data-company-detail]", "find-work [data-path-results]", "find-work [data-path-saved]", "find-work [data-path-recent]", "build-pages page("])
    check(labels.includes(needle), `renderer not exercised: ${needle}`);

  // Unsafe coordinates, slugs and links are refused outright by the page builder.
  const page = buildPages.page({ ...records[0], slug: "safe-slug", latitude: "0];alert(70);//", longitude: "0" }, []);
  check(inspect(page, "page").scripts.every((script) => /ld\+json/.test(script.attrs) || !script.body.includes("alert(70)")), "build-pages: a non-numeric coordinate reached the inline script");
  check(!buildPages.safeSlug(records[0].slug) && !buildPages.safeSlug("../../index") && buildPages.safeSlug("rite-aid-2"), "build-pages: safeSlug accepts an unsafe slug or rejects a normal one");
  for (const bad of ["javascript:alert(1)", " \tjava\nscript:alert(1)", "JAVASCRIPT:alert(1)", "data:text/html,x", "vbscript:x", "//evil.example", "www.example.com", "mailto:a@example.com", "", null, undefined, "https://a b.example/"])
    check(buildPages.safeUrl(bad) === "", `safeUrl accepted ${JSON.stringify(bad)}`);
  for (const good of ["https://example.com/", "http://example.com/a?b=1&c=2", "HTTPS://Example.com/x"]) check(buildPages.safeUrl(good) === good, `safeUrl rejected ${good}`);
  check(buildPages.esc(`&<>"'`) === "&amp;&lt;&gt;&quot;&#39;", "esc() must escape & < > \" '");
  const appContext = sandbox();
  vm.runInContext(read("assets/app.js"), appContext);
  check(appContext.esc(`&<>"'`) === "&amp;&lt;&gt;&quot;&#39;", "app.js esc() must escape & < > \" '");
  check(typeof appContext.safeUrl === "function" && appContext.safeUrl("javascript:alert(1)") === "" && appContext.safeUrl("https://example.com/") === "https://example.com/", "app.js safeUrl is wrong");

  if (problems.length) {
    console.error(`FAILED: ${problems.length} problem(s)`);
    for (const problem of [...new Set(problems)].slice(0, 60)) console.error(`  - ${problem}`);
    process.exit(1);
  }
  console.log(`OK: ${rendered.length} rendered fragments and pages from ${records.length} hostile records contain no injected tags, event handlers, scripts or unsafe links.`);
}

if (require.main === module) main();
module.exports = { inspect, renderApp, renderPathway, sandbox };
