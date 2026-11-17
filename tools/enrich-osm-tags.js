// Add public business details from OpenStreetMap to businesses we already list:
// phone, opening hours, website (if missing), and a freely licensed photo (Wikimedia Commons only).
// Looks up each business by the OSM id in its source_url, in batches, politely.
//
//   node tools/enrich-osm-tags.js           # dry run: counts what would be added
//   node tools/enrich-osm-tags.js --write   # update companies.json
//
// Responses are cached in data/cache/osm-tags.json so re-runs don't hit Overpass again.

const fs = require("fs");
const path = require("path");

const write = process.argv.includes("--write");
const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "bucks-county-business-jobs/1.0 (+https://github.com/techmore/bucks-county-business-jobs)";
const CACHE = path.join("data", "cache", "osm-tags.json");
const BATCH = 600;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
const cache = fs.existsSync(CACHE) ? JSON.parse(fs.readFileSync(CACHE, "utf8")) : {};

function osmRef(company) {
  const match = (company.source_url || "").match(/openstreetmap\.org\/(node|way|relation)\/(\d+)/);
  return match ? `${match[1]}/${match[2]}` : null;
}

async function overpass(query) {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "user-agent": USER_AGENT, "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`
      });
      if (response.ok) return response.json();
      console.warn(`  Overpass HTTP ${response.status}, waiting`);
    } catch (error) {
      console.warn(`  Overpass error ${error.message}, waiting`);
    }
    await sleep(5000 * 2 ** attempt);
  }
  throw new Error("Overpass kept failing");
}

function commonsPhoto(tags) {
  // Only Wikimedia Commons files: freely licensed, with a page that credits the author.
  let file = tags.wikimedia_commons || "";
  if (!/^File:/i.test(file)) {
    const image = tags.image || "";
    const match = image.match(/commons\.wikimedia\.org\/wiki\/(File:[^?#]+)/i) || image.match(/^(File:.+)$/i);
    file = match ? decodeURIComponent(match[1]) : "";
  }
  if (!/^File:.+\.(jpe?g|png|webp)$/i.test(file)) return null;
  const name = file.replace(/^File:/i, "").replace(/ /g, "_");
  return {
    photo_url: `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=800`,
    photo_credit_url: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`
  };
}

function cleanPhone(value) {
  const first = String(value || "").split(";")[0].trim();
  const digits = first.replace(/[^\d]/g, "").replace(/^1(?=\d{10}$)/, "");
  if (digits.length !== 10) return null;
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

(async () => {
  const refs = [...new Set(companies.map(osmRef).filter(Boolean))].filter((ref) => !(ref in cache));
  const byType = { node: [], way: [], relation: [] };
  for (const ref of refs) {
    const [type, id] = ref.split("/");
    byType[type].push(id);
  }
  for (const [type, ids] of Object.entries(byType)) {
    for (let i = 0; i < ids.length; i += BATCH) {
      const chunk = ids.slice(i, i + BATCH);
      const result = await overpass(`[out:json][timeout:120];${type}(id:${chunk.join(",")});out tags;`);
      for (const id of chunk) cache[`${type}/${id}`] = null;
      for (const element of result.elements || []) {
        const t = element.tags || {};
        cache[`${type}/${element.id}`] = {
          phone: t.phone || t["contact:phone"] || null,
          opening_hours: t.opening_hours || null,
          website: t.website || t["contact:website"] || null,
          wikimedia_commons: t.wikimedia_commons || null,
          image: t.image || null,
          brand: t.brand || null
        };
      }
      fs.mkdirSync(path.dirname(CACHE), { recursive: true });
      fs.writeFileSync(CACHE, JSON.stringify(cache));
      console.log(`  ${type}: ${Math.min(i + BATCH, ids.length)}/${ids.length}`);
      await sleep(4000);
    }
  }

  const added = { phone: 0, hours: 0, website: 0, photo: 0, brand: 0 };
  for (const company of companies) {
    const tags = cache[osmRef(company)];
    if (!tags) continue;
    const phone = cleanPhone(tags.phone);
    if (phone && !company.phone) { added.phone += 1; if (write) company.phone = phone; }
    if (tags.opening_hours && !company.opening_hours) { added.hours += 1; if (write) company.opening_hours = tags.opening_hours.slice(0, 200); }
    if (tags.website && !company.website && /^https?:\/\//.test(tags.website)) { added.website += 1; if (write) company.website = tags.website; }
    const photo = commonsPhoto(tags);
    if (photo && !company.photo_url) { added.photo += 1; if (write) Object.assign(company, photo); }
    if (tags.brand && !company.brand) { added.brand += 1; if (write) company.brand = tags.brand; }
  }
  console.log("Would add" + (write ? " (written)" : "") + ":", added);
  if (write) fs.writeFileSync("companies.json", `${JSON.stringify(companies, null, 2)}\n`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
