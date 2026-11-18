// Generate a static page for every business (company/<slug>.html) and sitemap.xml,
// reading from data/directory.sqlite (run tools/build-db.js first).
//
//   node --no-warnings tools/build-db.js && node --no-warnings tools/build-pages.js

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const guide = require("../assets/guide.js");

const SITE = "https://techmore.github.io/bucks-county-business-jobs/";
const REPO = "https://github.com/techmore/bucks-county-business-jobs";
const OUT_DIR = "company";
const SIGNAL_LABEL = {
  hiring_likely: "Openings found",
  hiring_possible: "Openings likely",
  careers_page_found: "Careers page found",
  not_hiring_signal: "Said not hiring",
  unknown: "No hiring info found",
  site_unreachable: "Website didn't load"
};

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// Links built from listing data may only point at http(s) pages. Anything else
// (javascript:, data:, a bare host, an e-mail address) returns "" and gets no link.
function safeUrl(value) {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return "";
  try {
    const { protocol } = new URL(text);
    return protocol === "http:" || protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

// A slug becomes a file name and a URL, so only the characters the slug makers produce are allowed.
function safeSlug(slug) {
  return /^[a-z0-9][a-z0-9-]*$/.test(String(slug ?? ""));
}

// Coordinates are written into a script on the page, so they must be plain numbers.
function coordinate(value) {
  const number = typeof value === "number" ? value : Number.NaN;
  return Number.isFinite(number) ? number : null;
}

function niceDate(iso) {
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function sourceLabel(name) {
  if (!name) return "Local directory";
  if (/OpenStreetMap/i.test(name)) return "OpenStreetMap";
  if (/Peddler/i.test(name)) return "Peddler's Village shop directory";
  return name;
}

function issueLink(business) {
  const title = `Update: ${business.name}`;
  const body = `Listing: ${SITE}company/${business.slug}.html\n\nWhat should change?\n\nAre they hiring? How do you know?\n`;
  return `${REPO}/issues/new?title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
}

function jsonLd(business) {
  const data = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: business.name,
    geo: { "@type": "GeoCoordinates", latitude: business.latitude, longitude: business.longitude }
  };
  if (business.address && !business.address_approximate) data.address = business.address;
  else if (business.town) data.address = { "@type": "PostalAddress", addressLocality: business.town, addressRegion: /, NJ\b/.test(business.address || "") ? "NJ" : "PA" };
  if (safeUrl(business.website)) data.url = safeUrl(business.website);
  if (business.phone) data.telephone = business.phone;
  if (business.opening_hours) data.openingHours = business.opening_hours;
  if (safeUrl(business.photo_url)) data.image = safeUrl(business.photo_url);
  // Escape "<" so the JSON can't close the script tag.
  return JSON.stringify(data).replace(/</g, "\\u003c");
}

function page(business, checks = []) {
  const status = guide.STATUS[business.hiring_status] || guide.STATUS.no_online_info;
  const industry = guide.INDUSTRY[business.category] || guide.DEFAULT_INDUSTRY;
  const speed = guide.SPEED[industry.speed];
  const town = business.town || "Bucks County area";
  const title = `${business.name}: jobs and hiring in ${town}`;
  const description = `${business.name} (${business.category || "local business"}) in ${town}. ${status.label}${business.hiring_last_checked ? `, checked ${niceDate(business.hiring_last_checked)}` : ""}. Typical roles: ${industry.roles.slice(0, 3).join(", ")}.`;
  const directions = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    business.address_approximate || !business.address ? `${business.latitude},${business.longitude}` : business.address
  )}`;
  const latitude = coordinate(business.latitude);
  const longitude = coordinate(business.longitude);
  const evidenceUrl = safeUrl(business.hiring_evidence_url);
  const foundedUrl = safeUrl(business.founded_source_url);
  const sourceUrl = safeUrl(business.source_url);
  const photoUrl = safeUrl(business.photo_url);
  const photoCreditUrl = safeUrl(business.photo_credit_url);
  const website = safeUrl(business.website)
    ? `<a class="button" href="${esc(safeUrl(business.website))}" rel="noopener">Website</a>`
    : `<a class="button" href="https://www.google.com/search?q=${encodeURIComponent(`${business.name} ${town}`)}" rel="noopener">Look them up</a>`;
  const history = checks.length
    ? `<ul class="history">${checks
        .map(
          (check) =>
            `<li><span>${esc(niceDate(check.checked))}</span> ${esc(SIGNAL_LABEL[check.signal] || check.signal || "Checked")}${
              safeUrl(check.evidence_url) ? ` · <a href="${esc(safeUrl(check.evidence_url))}" rel="noopener nofollow">evidence</a>` : ""
            }</li>`
        )
        .join("")}</ul>`
    : `<p class="meta">Not checked online yet. Many local employers don't post jobs online, so call or stop in.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${esc(title)} | Bucks County Business &amp; Jobs</title>
  <meta name="description" content="${esc(description)}">
  <link rel="canonical" href="${SITE}company/${esc(business.slug)}.html">
  <meta property="og:title" content="${esc(title)}">
  <meta property="og:description" content="${esc(description)}">
  <meta property="og:type" content="website">
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
  <link rel="stylesheet" href="../assets/styles.css">
  <script type="application/ld+json">${jsonLd(business)}</script>
</head>
<body>
  <header class="site-header">
    <nav class="nav" aria-label="Main navigation">
      <a class="brand" href="../index.html"><span class="brand-mark">BC</span><span>Bucks County Business &amp; Jobs</span></a>
      <div class="nav-links">
        <a href="../find-work.html">Find Work</a>
        <a href="../index.html">Map</a>
        <a href="../directory.html">Directory</a>
        <a href="../hiring-audit.html">Hiring Audit</a>
        <a href="../data-quality.html">Data Quality</a>
        <a href="../about.html">About</a>
        <a class="button" href="${esc(issueLink(business))}">Fix This Listing</a>
      </div>
    </nav>
  </header>
  <main>
    <section class="page-hero">
      <p class="eyebrow">${esc(business.category || "Local business")} · ${esc(town)}</p>
      <h1>${esc(business.name)}</h1>
      <p class="lead">${esc(business.description || "")}</p>
      ${business.phone ? `<p class="actions" style="margin-top:12px;"><a class="button" href="tel:${esc(String(business.phone).replace(/[^\d+]/g, ""))}">Call ${esc(business.phone)}</a></p>` : ""}
    </section>
    <section class="detail-layout">
      <div class="panel detail-panel">
        <div class="pop-status" style="--c:${esc(status.color)}"><b>${esc(status.label)}</b>${
          business.hiring_last_checked ? ` (checked ${esc(niceDate(business.hiring_last_checked))})` : ""
        }${evidenceUrl ? ` · <a href="${esc(evidenceUrl)}" rel="noopener nofollow">See jobs page</a>` : ""}</div>
        ${business.established_employer ? `<p><span class="pop-badge">Established local employer</span> <span class="meta">In business 10+ years (their website or PA registration), local, and openings or a careers page seen in checks months apart.</span></p>` : ""}
        <p class="pop-note">${esc(business.hiring_note || status.note)}</p>
        ${business.hiring_track ? `<p class="pop-note">${esc(business.hiring_track)}.</p>` : ""}
        ${business.verification_note ? `<p class="pop-note warn">${esc(business.verification_note)}</p>` : ""}

        <h2>Working here</h2>
        <p><b>Typical roles:</b> ${esc(industry.roles.join(", "))}</p>
        <p><b>Skills that help:</b> ${esc(industry.skills.join(", "))}</p>
        <p><b>${esc(speed.label)}</b>, ${esc(speed.detail)}. <span class="meta">Typical for the industry, not a promise from this business.</span></p>

        <h2>Details</h2>
        <div class="facts">
          <div class="fact"><strong>${esc(business.address || "Address not listed")}</strong><span>${business.address_approximate ? "Approximate location" : "Address"}</span></div>
          ${business.phone ? `<a class="fact" href="tel:${esc(String(business.phone).replace(/[^\d+]/g, ""))}"><strong>${esc(business.phone)}</strong><span>Phone (from OpenStreetMap)</span></a>` : ""}
          ${business.opening_hours ? `<div class="fact"><strong>${esc(business.opening_hours)}</strong><span>Hours (from OpenStreetMap; may be out of date)</span></div>` : ""}
          ${business.founded_label
            ? foundedUrl
              ? `<a class="fact" href="${esc(foundedUrl)}" rel="noopener"><strong>${esc(business.founded_label)}</strong><span>${esc(business.founded_note || "")}</span></a>`
              : `<div class="fact"><strong>${esc(business.founded_label)}</strong><span>${esc(business.founded_note || "")}</span></div>`
            : business.years_in_business ? `<div class="fact"><strong>${esc(business.years_in_business)} years</strong><span>In business</span></div>` : ""}
          ${business.start_date ? `<div class="fact"><strong>Since ${esc(business.start_date)}</strong><span>Opened (OpenStreetMap)</span></div>` : ""}
          ${business.total_employees ? `<div class="fact"><strong>${esc(business.total_employees)}</strong><span>Employees</span></div>` : ""}
          <div class="fact"><strong>${esc(sourceLabel(business.source_name))}</strong><span>Listing source</span></div>
        </div>

        <h2>Hiring checks</h2>
        ${history}

        <div class="actions" style="margin-top:20px;">
          ${website}
          <a class="button secondary" href="${esc(directions)}" rel="noopener">Directions</a>
          <a class="button ghost" href="../index.html?company=${esc(encodeURIComponent(business.slug))}">View on map</a>
          ${sourceUrl ? `<a class="button ghost" href="${esc(sourceUrl)}" rel="noopener nofollow">Source</a>` : ""}
        </div>
        <p class="meta" style="margin-top:14px;">Something wrong or out of date? <a href="${esc(issueLink(business))}">Fix this listing</a>.</p>
      </div>
      <div class="detail-side">
        ${photoUrl ? `<figure class="photo"><img src="${esc(photoUrl)}" alt="${esc(business.name)}" loading="lazy"><figcaption>Photo: ${photoCreditUrl ? `<a href="${esc(photoCreditUrl)}" rel="noopener">Wikimedia Commons</a>` : "Wikimedia Commons"} (see page for author and license)</figcaption></figure>` : ""}
        <div class="map-shell"><div id="mini-map"></div></div>
      </div>
    </section>
  </main>
  <footer class="site-footer">
    <div class="footer-inner">
      <span>Bucks County Business &amp; Jobs Directory © 2026</span>
      <a href="${REPO}">GitHub</a>
    </div>
  </footer>
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    (function () {
      var here = [${latitude}, ${longitude}];
      var map = L.map("mini-map", { scrollWheelZoom: false }).setView(here, ${business.address_approximate ? 13 : 15});
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>' }).addTo(map);
      L.circleMarker(here, { radius: 9, color: "#fff", weight: 3, fillColor: ${JSON.stringify(String(status.color)).replace(/</g, "\\u003c")}, fillOpacity: 1 }).addTo(map);
    })();
  </script>
</body>
</html>
`;
}

function main() {
  const db = new DatabaseSync(path.join("data", "directory.sqlite"), { readOnly: true });
  const all = db.prepare("SELECT * FROM businesses ORDER BY slug").all();
  const checksFor = db.prepare("SELECT checked, signal, evidence_url FROM hiring_checks WHERE slug = ? ORDER BY checked DESC");
  // A record that can't be published safely (odd slug, or coordinates that aren't numbers) gets no page.
  const businesses = all.filter((business) => safeSlug(business.slug) && coordinate(business.latitude) !== null && coordinate(business.longitude) !== null);
  for (const business of all) if (!businesses.includes(business)) console.warn(`Skipped (unsafe slug or coordinates): ${JSON.stringify(business.slug)}`);

  fs.mkdirSync(OUT_DIR, { recursive: true });
  const keep = new Set(["index.html"]);
  let written = 0;
  for (const business of businesses) {
    const file = `${business.slug}.html`;
    keep.add(file);
    const html = page(business, checksFor.all(business.slug));
    const target = path.join(OUT_DIR, file);
    if (!fs.existsSync(target) || fs.readFileSync(target, "utf8") !== html) {
      fs.writeFileSync(target, html);
      written += 1;
    }
  }
  // Remove pages for businesses no longer in the directory.
  let removed = 0;
  for (const file of fs.readdirSync(OUT_DIR)) {
    if (file.endsWith(".html") && !keep.has(file)) {
      fs.rmSync(path.join(OUT_DIR, file));
      removed += 1;
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const urls = [
    `  <url><loc>${SITE}</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${SITE}find-work.html</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${SITE}directory.html</loc><lastmod>${today}</lastmod></url>`,
    `  <url><loc>${SITE}about.html</loc></url>`,
    ...businesses.map((business) => `  <url><loc>${SITE}company/${business.slug}.html</loc>${/^\d{4}-\d{2}-\d{2}$/.test(business.hiring_last_checked || "") ? `<lastmod>${business.hiring_last_checked}</lastmod>` : ""}</url>`)
  ];
  fs.writeFileSync("sitemap.xml", `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join("\n")}\n</urlset>\n`);
  fs.writeFileSync("robots.txt", `User-agent: *\nAllow: /\nSitemap: ${SITE}sitemap.xml\n`);

  console.log(`Pages: ${businesses.length} total, ${written} written/updated, ${removed} removed. sitemap.xml has ${urls.length} URLs.`);
}

if (require.main === module) main();
module.exports = { page, jsonLd, esc, safeUrl, safeSlug };
