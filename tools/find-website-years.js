// Find "open since" years on businesses' own websites (homepage + About/History pages).
// Only strong phrases count: "founded in 1983", "established 1952", "est. 1976",
// "family owned since 1985", "serving <place> since 1990", "in business since 1971".
// Testimonial-like sentences (I/my/our family has used...) are skipped. The exact quote and page
// are saved as evidence and shown on the site.
//
//   node tools/find-website-years.js [--limit N] [--concurrency 8] [--near lat,lon]
//   node tools/find-website-years.js --apply     # copy results into companies.json
//
// Results accumulate in data/website-years.json (keyed by slug).

const fs = require("fs");
const path = require("path");

const OUT = path.join("data", "website-years.json");
const THIS_YEAR = new Date().getFullYear();
const TIMEOUT_MS = 9000;
const USER_AGENT = "bucks-county-business-jobs/1.0 (+https://github.com/techmore/bucks-county-business-jobs)";
const PLATFORM = /(^|\.)(facebook|instagram|linkedin|yelp|google|linktr|tiktok|twitter|x|nextdoor|tripadvisor)\.[a-z]+$/;

const args = process.argv.slice(2);
const opt = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);
const LIMIT = Number(opt("--limit", "100000"));
const CONCURRENCY = Number(opt("--concurrency", "8"));
const NEAR = opt("--near", null);

const YEAR = "(1[6-9]\\d\\d|20[0-2]\\d)";
const PATTERNS = [
  new RegExp(`\\b(?:founded|established|incorporated)\\s+(?:in\\s+|back\\s+in\\s+)?${YEAR}\\b`, "i"),
  new RegExp(`\\best\\.\\s*${YEAR}\\b`, "i"),
  new RegExp(`\\b(?:family[- ]owned(?: and operated)?|locally owned(?: and operated)?|in business|proudly serving [a-z ,.'&-]{2,60}|serving [a-z ,.'&-]{2,60})\\s+since\\s+${YEAR}\\b`, "i"),
  new RegExp(`\\bsince\\s+${YEAR},?\\s+(?:we have|we've|our (?:family|team|company|business))\\b`, "i")
];
const TESTIMONIAL = /\b(i|i've|i have|my|me|we've been (?:going|coming|using)|customer since|client since|patient since|member since|review|testimonial|stars?)\b/i;
const NOT_THE_BUSINESS = /\b(building|house|church was|barn|mill|bridge|township|borough|county|town was|village was|historic|built)\b/i;

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;|&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ");
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal, headers: { "user-agent": USER_AGENT, accept: "text/html" } });
    if (!response.ok || !(response.headers.get("content-type") || "").includes("text/html")) return null;
    const html = await response.text();
    return { url: response.url, html, text: stripHtml(html) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function aboutLinks(page) {
  const base = new URL(page.url);
  const links = new Set();
  for (const match of page.html.matchAll(/<a\b[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    try {
      const url = new URL(match[1], base);
      if (url.hostname !== base.hostname) continue;
      if (/about|history|our-story|story|who-we-are|heritage/i.test(`${url.pathname} ${stripHtml(match[2])}`)) links.add(url.href.split("#")[0]);
    } catch {
      /* ignore bad links */
    }
  }
  for (const fallback of ["/about", "/about-us", "/history"]) links.add(new URL(fallback, base.origin).href);
  return [...links].slice(0, 4);
}

function findYear(text) {
  const hits = [];
  for (const pattern of PATTERNS) {
    const global = new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`);
    for (const match of text.matchAll(global)) {
      const year = Number(match[1]);
      if (year < 1650 || year > THIS_YEAR) continue;
      // Evidence: the words around the match, cut to whole words.
      const start = Math.max(0, match.index - 110);
      const end = Math.min(text.length, match.index + match[0].length + 90);
      const window = text.slice(start, end).replace(/^\S*\s/, "").replace(/\s\S*$/, "").trim();
      const before = text.slice(Math.max(0, match.index - 70), match.index);
      if (TESTIMONIAL.test(window) || NOT_THE_BUSINESS.test(before)) continue;
      hits.push({ year, quote: `…${window}…` });
    }
  }
  if (!hits.length) return null;
  // One consistent year is strong; several different years means a person should look.
  const years = [...new Set(hits.map((hit) => hit.year))];
  const best = hits.find((hit) => hit.year === Math.min(...years));
  return { ...best, confidence: years.length === 1 ? "high" : "medium" };
}

async function check(company) {
  const home = await fetchText(company.website);
  if (!home) return { status: "unreachable" };
  const pages = [home];
  for (const link of aboutLinks(home)) {
    const page = await fetchText(link);
    if (page) pages.push(page);
  }
  for (const page of pages) {
    const found = findYear(page.text);
    if (found) return { status: "found", ...found, source_url: page.url };
  }
  return { status: "none" };
}

function miles(a, b) {
  const toRad = (v) => (v * Math.PI) / 180;
  const h = Math.sin(toRad(b.lat - a.latitude) / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lon - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function apply() {
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
  let applied = 0;
  for (const company of companies) {
    const result = results[company.slug];
    if (!result || result.status !== "found") continue;
    Object.assign(company, {
      founded_year: result.year,
      founded_source: "website",
      founded_confidence: result.confidence,
      founded_label: `Founded in ${result.year} (per their website)`,
      founded_note: `"${result.quote}"`,
      founded_source_url: result.source_url
    });
    delete company.founded_entity_type;
    company.years_in_business = THIS_YEAR - result.year;
    applied += 1;
  }
  fs.writeFileSync("companies.json", `${JSON.stringify(companies, null, 2)}\n`);
  console.log(`Applied website years to ${applied} businesses.`);
}

async function main() {
  if (args.includes("--apply")) return apply();
  const results = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, "utf8")) : {};
  const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
  // Websites shared by 3+ listings are chains or umbrella sites: their founding year isn't the local shop's.
  const siteCount = new Map();
  const siteKey = (url) => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "";
    }
  };
  for (const company of companies) if (company.website) siteCount.set(siteKey(company.website), (siteCount.get(siteKey(company.website)) || 0) + 1);
  let queue = companies.filter((company) => {
    if (!company.website || results[company.slug]) return false;
    if ((siteCount.get(siteKey(company.website)) || 0) >= 3) return false;
    try {
      return !PLATFORM.test(new URL(company.website).hostname.replace(/^www\./, ""));
    } catch {
      return false;
    }
  });
  if (NEAR) {
    const [lat, lon] = NEAR.split(",").map(Number);
    queue.sort((a, b) => miles(a, { lat, lon }) - miles(b, { lat, lon }));
  }
  queue = queue.slice(0, LIMIT);
  let next = 0;
  let done = 0;
  const counts = {};
  async function worker() {
    while (next < queue.length) {
      const company = queue[next++];
      const result = await check(company);
      results[company.slug] = { ...result, website: company.website, checked: new Date().toISOString().slice(0, 10) };
      counts[result.status] = (counts[result.status] || 0) + 1;
      done += 1;
      if (result.status === "found") console.log(`[${done}/${queue.length}] ${company.name}: ${result.year} (${result.confidence}) "${result.quote.slice(0, 90)}"`);
      if (done % 100 === 0) fs.writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
  fs.writeFileSync(OUT, `${JSON.stringify(results, null, 2)}\n`);
  console.log("Done:", counts);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
