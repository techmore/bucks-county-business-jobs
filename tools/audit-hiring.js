const fs = require("fs");
const path = require("path");
const rules = require("./hiring-rules");

const INPUT = "companies.json";
const REPORT_DIR = "reports";
const DEFAULT_REPORT_PATH = path.join(REPORT_DIR, "hiring-audit.json");
const DEFAULT_LIMIT = 80;
const REQUEST_TIMEOUT_MS = 9000;
const USER_AGENT = "TinicumTalentThrive/1.0 hiring-signal-audit";

const POSITIVE_PATTERNS = [
  /\bnow hiring\b/i,
  /\bwe'?re hiring\b/i,
  /\bjoin our team\b/i,
  /\bjob openings?\b/i,
  /\bopen positions?\b/i,
  /\bcurrent openings?\b/i,
  /\bview jobs\b/i,
  /\bapply now\b/i,
  /\bemployment opportunities\b/i,
  /\bcareer opportunities\b/i
];

const CAREER_LINK_PATTERNS = [
  /careers?/i,
  /jobs?/i,
  /employment/i,
  /join[-_\s]?our[-_\s]?team/i,
  /work[-_\s]?with[-_\s]?us/i,
  /opportunities/i,
  /apply/i
];

const NEGATIVE_PATTERNS = [
  /not currently hiring/i,
  /no current openings/i,
  /no open positions/i,
  /not accepting applications/i
];

function parseArgs() {
  const args = process.argv.slice(2);
  const options = {
    limit: DEFAULT_LIMIT,
    offset: 0,
    update: false,
    onlyWithWebsite: true,
    onlyUnaudited: false,
    towns: [],
    outputPath: DEFAULT_REPORT_PATH,
    concurrency: 1,
    near: null,
    maxMiles: null
  };

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--update") options.update = true;
    else if (arg === "--only-unaudited") options.onlyUnaudited = true;
    else if (arg === "--include-no-website") options.onlyWithWebsite = false;
    else if (arg === "--limit") {
      options.limit = parseNumber(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--offset") {
      options.offset = parseNumber(readValue(args, index, arg), arg);
      index += 1;
    } else if (arg === "--town") {
      options.towns.push(readValue(args, index, arg));
      index += 1;
    } else if (arg === "--towns") {
      options.towns.push(...readValue(args, index, arg).split(",").map((town) => town.trim()).filter(Boolean));
      index += 1;
    } else if (arg === "--concurrency") {
      options.concurrency = Math.max(1, parseNumber(readValue(args, index, arg), arg));
      index += 1;
    } else if (arg === "--near") {
      const [lat, lon] = readValue(args, index, arg).split(",").map(Number);
      options.near = { lat, lon };
      index += 1;
    } else if (arg === "--max-miles") {
      options.maxMiles = Number(readValue(args, index, arg));
      index += 1;
    } else if (arg === "--output") {
      options.outputPath = readValue(args, index, arg);
      index += 1;
    } else {
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  options.towns = [...new Set(options.towns.map((town) => town.toLowerCase()))];
  return options;
}

function readValue(args, index, optionName) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    console.error(`Missing value for ${optionName}`);
    process.exit(1);
  }
  return value;
}

function parseNumber(value, optionName) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) {
    console.error(`${optionName} must be a non-negative integer`);
    process.exit(1);
  }
  return number;
}

function normalizeUrl(value) {
  if (!value || value.includes("example.com")) return null;
  try {
    return new URL(value).href;
  } catch {
    try {
      return new URL(`https://${value}`).href;
    } catch {
      return null;
    }
  }
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const a = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function townFor(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim()).filter(Boolean);
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) return parts[parts.length - 3];
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\bPA\b|\bNJ\b/g, "").trim();
  return "Town needs audit";
}

function stripHtml(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function extractLinks(html, baseUrl) {
  const links = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match;
  while ((match = pattern.exec(html))) {
    try {
      const href = new URL(match[1], baseUrl).href;
      const text = stripHtml(match[2]).slice(0, 120);
      links.push({ href, text });
    } catch {
      // Ignore malformed hrefs.
    }
  }
  return links;
}

function findCareerLinks(html, baseUrl) {
  const base = new URL(baseUrl);
  const links = extractLinks(html, baseUrl)
    .filter((link) => {
      const url = new URL(link.href);
      if (url.hostname !== base.hostname) return false;
      const haystack = `${url.pathname} ${link.text}`;
      return CAREER_LINK_PATTERNS.some((pattern) => pattern.test(haystack));
    })
    .map((link) => link.href);

  const fallbackPaths = ["/careers", "/career", "/jobs", "/employment", "/join-our-team", "/work-with-us"];
  for (const fallbackPath of fallbackPaths) {
    links.push(new URL(fallbackPath, base.origin).href);
  }

  return [...new Set(links)].slice(0, 4);
}

async function fetchText(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml",
        "user-agent": USER_AGENT
      }
    });
    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("text/html")) {
      return { ok: false, status: response.status, url: response.url, text: "" };
    }
    const html = await response.text();
    return { ok: true, status: response.status, url: response.url, html, text: stripHtml(html) };
  } catch (error) {
    return { ok: false, status: 0, url, error: error.message, text: "" };
  } finally {
    clearTimeout(timer);
  }
}

function scorePage(text, url) {
  const positives = POSITIVE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  const negatives = NEGATIVE_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
  let score = 0;
  if (/careers?|jobs?|employment|join-our-team|work-with-us/i.test(url)) score += 2;
  score += positives.length * 3;
  score -= negatives.length * 4;
  return { score, positives, negatives };
}

async function auditCompany(company) {
  const website = normalizeUrl(company.website);
  if (!website) {
    return {
      slug: company.slug,
      name: company.name,
      website: company.website || null,
      hiring_signal: "unknown",
      hiring_confidence: 0,
      evidence_url: null,
      notes: "No usable website URL"
    };
  }

  const pages = [];
  const home = await fetchText(website);
  if (home.ok) {
    pages.push(home);
    const careerLinks = findCareerLinks(home.html, home.url);
    for (const link of careerLinks) {
      const page = await fetchText(link);
      if (page.ok) pages.push(page);
    }
  } else {
    return {
      slug: company.slug,
      name: company.name,
      website,
      hiring_signal: "unknown",
      hiring_confidence: 0,
      evidence_url: website,
      notes: `Website fetch failed: ${home.status || home.error}`
    };
  }

  let best = { score: -999, positives: [], negatives: [], url: website };
  for (const page of pages) {
    const scored = scorePage(page.text, page.url);
    if (scored.score > best.score) best = { ...scored, url: page.url };
  }

  let hiringSignal = "unknown";
  let confidence = 0.25;
  if (best.negatives.length && best.score < 1) {
    hiringSignal = "not_hiring_signal";
    confidence = 0.65;
  } else if (best.score >= 8) {
    hiringSignal = "hiring_likely";
    confidence = 0.85;
  } else if (best.score >= 4) {
    hiringSignal = "hiring_possible";
    confidence = 0.6;
  } else if (best.score >= 2) {
    hiringSignal = "careers_page_found";
    confidence = 0.45;
  }

  return {
    slug: company.slug,
    name: company.name,
    website,
    hiring_signal: hiringSignal,
    hiring_confidence: confidence,
    evidence_url: best.url,
    positive_matches: best.positives,
    negative_matches: best.negatives,
    pages_checked: pages.map((page) => page.url)
  };
}

function applyAudit(companies, results) {
  const bySlug = new Map(companies.map((company) => [company.slug, company]));
  for (const result of results) {
    const company = bySlug.get(result.slug);
    if (!company) continue;
    if (/^Website fetch failed/.test(result.notes || "") && company.hiring_signal) {
      // Don't erase an earlier result because a site was slow or down today.
      company.hiring_fetch_failed = new Date().toISOString().slice(0, 10);
      continue;
    }
    let signal = result.hiring_signal;
    let evidence = result.evidence_url;
    // Don't credit a business with a platform's own careers page (e.g. Facebook -> Meta jobs).
    if (rules.POSITIVE_SIGNALS.includes(signal) && evidence && !rules.evidenceBelongsTo(evidence, company.website || "")) {
      signal = "unknown";
      evidence = null;
    }
    company.hiring_signal = signal;
    company.hiring_confidence = signal === result.hiring_signal ? result.hiring_confidence : 0;
    company.hiring_evidence_url = evidence;
    company.hiring_last_checked = new Date().toISOString().slice(0, 10);
    delete company.hiring_fetch_failed;
    delete company.hiring_note;
    company.hiring_status = rules.hiringStatus(company);
    company.hiring = company.hiring_status === "hiring";
  }
}

async function main() {
  const options = parseArgs();
  const companies = JSON.parse(fs.readFileSync(INPUT, "utf8"));
  const eligible = companies.filter((company) => {
    if (options.onlyWithWebsite && !normalizeUrl(company.website)) return false;
    if (options.onlyUnaudited && company.hiring_signal) return false;
    if (options.towns.length && !options.towns.includes(townFor(company).toLowerCase())) return false;
    return true;
  });
  if (options.near) {
    const miles = (company) => distanceMiles(options.near.lat, options.near.lon, company.latitude, company.longitude);
    eligible.sort((a, b) => miles(a) - miles(b));
    if (options.maxMiles) eligible.splice(0, eligible.length, ...eligible.filter((company) => miles(company) <= options.maxMiles));
  }
  const batch = eligible.slice(options.offset, options.offset + options.limit);
  const results = [];

  // Check several sites at once; results keep batch order.
  let next = 0;
  let done = 0;
  async function worker() {
    while (next < batch.length) {
      const index = next++;
      const company = batch[index];
      results[index] = await auditCompany(company);
      done += 1;
      process.stdout.write(`[${done}/${batch.length}] ${company.name}: ${results[index].hiring_signal}\n`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(options.concurrency, batch.length) }, worker));

  fs.mkdirSync(path.dirname(options.outputPath), { recursive: true });
  const report = {
    generated_at: new Date().toISOString(),
    options,
    eligible_count: eligible.length,
    audited_count: results.length,
    results
  };
  fs.writeFileSync(options.outputPath, `${JSON.stringify(report, null, 2)}\n`);

  if (options.update) {
    applyAudit(companies, results);
    fs.writeFileSync(INPUT, `${JSON.stringify(companies, null, 2)}\n`);
  }

  const summary = results.reduce((counts, result) => {
    counts[result.hiring_signal] = (counts[result.hiring_signal] || 0) + 1;
    return counts;
  }, {});
  console.log(`Wrote ${options.outputPath}`);
  console.log(summary);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
