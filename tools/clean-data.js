// Apply the transparency rules in tools/hiring-rules.js to companies.json.
// Safe to re-run. Prints what changed.
//
//   node tools/clean-data.js            # dry run
//   node tools/clean-data.js --write    # update companies.json

const fs = require("fs");
const rules = require("./hiring-rules");

const INPUT = "companies.json";
const write = process.argv.includes("--write");
const NJ_BORDER_MILES = 3;
let companies = JSON.parse(fs.readFileSync(INPUT, "utf8"));

// 0. Stay in Pennsylvania, plus New Jersey border towns across the river.
//    An NJ business stays only if it's within NJ_BORDER_MILES of a PA business on the map.
const isNJ = (company) => /\bNJ\b/.test(company.address || "");
const milesBetween = (a, b) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const h = Math.sin(toRad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(toRad(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const cell = (lat, lon) => `${Math.floor(lat * 20)},${Math.floor(lon * 20)}`;
const paGrid = new Map();
for (const company of companies.filter((c) => !isNJ(c))) {
  const key = cell(company.latitude, company.longitude);
  if (!paGrid.has(key)) paGrid.set(key, []);
  paGrid.get(key).push(company);
}
function nearPA(company) {
  const lat0 = Math.floor(company.latitude * 20);
  const lon0 = Math.floor(company.longitude * 20);
  for (let i = -2; i <= 2; i += 1)
    for (let j = -2; j <= 2; j += 1)
      for (const pa of paGrid.get(`${lat0 + i},${lon0 + j}`) || []) if (milesBetween(company, pa) <= NJ_BORDER_MILES) return true;
  return false;
}
const outOfArea = companies.filter((company) => isNJ(company) && !nearPA(company));
if (outOfArea.length) {
  const drop = new Set(outOfArea.map((company) => company.slug));
  companies = companies.filter((company) => !drop.has(company.slug));
  if (write) {
    fs.mkdirSync("data", { recursive: true });
    fs.writeFileSync("data/removed-out-of-area.json", `${JSON.stringify(outOfArea, null, 2)}\n`);
  }
}
const changes = { placeholder: [], platformEvidence: [], offSiteEvidence: [], sharedSite: [], descriptions: 0 };

function townOf(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim().replace(/^near\s+/i, "")).filter(Boolean);
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) return parts[parts.length - 3];
  if (parts.length >= 2) {
    const town = parts[parts.length - 2].replace(/\b(PA|NJ)\b.*$/, "").trim();
    if (town && !/^\d/.test(town)) return town;
  }
  return null;
}

function article(word) {
  return /^[aeiou]/i.test(word) ? "an" : "a";
}

// Hiring history: dates on which each business showed openings or a careers page.
const positiveDates = new Map();
const historyFile = "data/hiring-history.jsonl";
if (fs.existsSync(historyFile)) {
  for (const line of fs.readFileSync(historyFile, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!rules.POSITIVE_SIGNALS.includes(row.signal)) continue;
    if (!positiveDates.has(row.slug)) positiveDates.set(row.slug, new Set());
    positiveDates.get(row.slug).add(row.checked);
  }
}
const nameCounts = new Map();
for (const company of companies) {
  const key = company.name.toLowerCase().replace(/[^a-z0-9]/g, "");
  nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
}
const THIS_YEAR = new Date().getFullYear();
const monthYear = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", year: "numeric", timeZone: "UTC" });

for (const company of companies) {
  // 1. Placeholder demo records: keep the business, clear the made-up details, mark unverified.
  if (rules.isPlaceholderSite(company.website || "")) {
    changes.placeholder.push(company.name);
    Object.assign(company, {
      website: null,
      total_employees: null,
      years_in_business: null,
      best_places_score: null,
      onboarding_note: null,
      hiring: false,
      data_status: "unverified",
      verification_note:
        "Listed from early sample data. We have not confirmed this business or its details yet. If you know it, please send an update."
    });
    company.description = `${company.name} is listed in ${company.address.split(",").slice(-2, -1)[0]?.trim() || "the area"} but has not been verified yet.`;
    delete company.hiring_signal;
    delete company.hiring_confidence;
    delete company.hiring_evidence_url;
  }

  // 2. Hiring evidence we can't attribute to this business (e.g. Facebook's own careers page).
  if (company.hiring_evidence_url && rules.POSITIVE_SIGNALS.includes(company.hiring_signal)) {
    if (!rules.evidenceBelongsTo(company.hiring_evidence_url, company.website || "")) {
      const bucket = rules.isPlatformSite(company.website || "") ? changes.platformEvidence : changes.offSiteEvidence;
      bucket.push(`${company.name}  (${rules.hostOf(company.hiring_evidence_url)})`);
      company.hiring_signal = "unknown";
      company.hiring_confidence = 0;
      company.hiring_note = `An earlier check counted ${rules.hostOf(company.hiring_evidence_url)} as this business hiring, but that page isn't theirs.`;
      company.hiring_evidence_url = null;
    }
  }

  // 3. Shops on a shared site (Peddler's Village): the careers page is the host's.
  const shared = rules.sharedSiteFor(company);
  if (shared && rules.POSITIVE_SIGNALS.includes(company.hiring_signal)) {
    changes.sharedSite.push(company.name);
    company.hiring_note = `The careers page found is ${shared.label}'s, not this business's own. Ask the business directly.`;
  }

  // 4. Replace internal "should be audited before publication" wording with a plain public description.
  const desc = company.description || "";
  const rest = desc.startsWith(company.name) ? desc.slice(company.name.length) : desc;
  const osm =
    rest.match(/^ is a named (.+?) listing from OpenStreetMap/) ||
    rest.match(/^ is an? (.+?) (?:in|at|nearby)\b.*Location from OpenStreetMap\.$/) ||
    rest.match(/^ \((.+?)\) is (?:in|at|nearby)\b.*Location from OpenStreetMap\.$/);
  const town = townOf(company);
  const street = (company.address || "").split(",")[0].trim();
  const where = town ? `in ${town}` : street && /^\d/.test(street) ? `at ${street}` : "nearby";
  if (osm) {
    company.description = `${company.name} (${osm[1]}) is ${where}. Location from OpenStreetMap.`;
    changes.descriptions += 1;
  } else if (/listed in the Peddler's Village shop directory.*should be audited/.test(desc)) {
    company.description = `${company.name} is a shop at Peddler's Village in Lahaska. Listed in the Village's shop directory.`;
    changes.descriptions += 1;
  }

  // 5. Established local employer: facts only, never claims about pay, culture or retention.
  //    - registered 10+ years ago in PA (domestic entity, confident match), and
  //    - not a chain (same name 3+ times in the directory), and
  //    - openings or a careers page seen in at least two checks 90+ days apart.
  // A shared careers page (e.g. Peddler's Village) is the host's, not the shop's.
  const dates = rules.sharedSiteFor(company) ? [] : [...(positiveDates.get(company.slug) || [])].sort();
  const spread = dates.length >= 2 && (Date.parse(dates[dates.length - 1]) - Date.parse(dates[0])) / 86400000 >= 90;
  company.hiring_track = dates.length ? `Openings or a careers page seen in ${dates.map(monthYear).join(" and ")} checks` : null;
  const chain = (nameCounts.get(company.name.toLowerCase().replace(/[^a-z0-9]/g, "")) || 0) >= 3;
  company.established =
    Boolean(company.founded_year) &&
    THIS_YEAR - company.founded_year >= 10 &&
    ["high", "medium"].includes(company.founded_confidence || "high") &&
    !/^Foreign/i.test(company.founded_entity_type || "") &&
    !chain;
  company.established_employer = company.established && spread;
  if (!company.hiring_track) delete company.hiring_track;

  company.hiring_status = rules.hiringStatus(company);
  company.hiring = company.hiring_status === "hiring";
}

const counts = {};
for (const company of companies) counts[company.hiring_status] = (counts[company.hiring_status] || 0) + 1;

console.log(`Out of area (NJ beyond ${NJ_BORDER_MILES} mi of the PA border) removed: ${outOfArea.length}`);
console.log(`Placeholder records marked unverified (${changes.placeholder.length}):`, changes.placeholder.join("; "));
console.log(`Platform careers links removed (${changes.platformEvidence.length})`);
console.log(`Off-site evidence removed (${changes.offSiteEvidence.length}):`, changes.offSiteEvidence.join("; "));
console.log(`Shared-site careers pages (${changes.sharedSite.length})`);
console.log(`Descriptions rewritten: ${changes.descriptions}`);
console.log("Hiring status counts:", counts);
console.log(`Established (10+ yrs registered, local): ${companies.filter((c) => c.established).length}; established local employers (also hiring over time): ${companies.filter((c) => c.established_employer).length}`);

if (write) {
  fs.writeFileSync(INPUT, `${JSON.stringify(companies, null, 2)}\n`);
  console.log(`Wrote ${INPUT}`);
} else {
  console.log("Dry run. Re-run with --write to save.");
}
