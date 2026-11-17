// Find real storefronts that hold a PA sales-tax license but aren't on the map yet.
// Source: data/cache/pa-salestax-*.json (PA Dept. of Revenue, public domain; from fetch-pa-registry.js).
//
// Privacy and quality rules (a license alone doesn't prove a public storefront):
//   - companies only: licenses held in a person's own name are skipped (they may be a home)
//   - commercial location only: a numbered store (#123), a suite/plaza/shopping-center address,
//     or at least three known businesses within 150 m
//   - no PO boxes or c/o addresses
//   - skip if a business with a similar name is already within 150 m (no duplicates)
//
//   node tools/import-salestax-storefronts.js     # writes data/salestax-candidates.json
//   node tools/merge-candidates.js data/salestax-candidates.json --write

const fs = require("fs");
const path = require("path");

const CENTER = { latitude: 40.4825, longitude: -75.1069 };
const RADIUS = 25;
const DATASET_PAGE = "https://data.pa.gov/d/ugeq-ckxd";
const ENTITY = /\b(LLC|L\s?L\s?C|INC|INCORPORATED|CORP|CORPORATION|CO|COMPANY|LP|L\s?P|LLP|LTD|LIMITED|PC|P\s?C|PLLC|BANK|N\s?A|TRUST|ASSN|ASSOCIATION|CLUB|SOCIETY|CHURCH|FOUNDATION|SCHOOL|COLLEGE|UNIVERSITY|HOSPITAL|AUTHORITY|TOWNSHIP|BOROUGH|COUNTY|COOPERATIVE|ENTERPRISES|GROUP|HOLDINGS|PARTNERS|PARTNERSHIP)\b/;
const COMMERCIAL_ADDRESS = /\b(SUITE|STE|UNIT|PLAZA|SHOPPING|CENTER|CENTRE|CTR|MALL|SQUARE|SQ|MARKETPLACE|COMMONS|OUTLETS?)\b/i;

const miles = (a, b) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const h = Math.sin(toRad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(toRad(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
const STOP = new Set(["inc", "llc", "corp", "co", "ltd", "the", "and", "of", "store", "stores", "company", "pa", "n", "a", "na"]);
const words = (name) => String(name || "").toLowerCase().replace(/&/g, " and ").replace(/#\s*\d+/g, " ").replace(/[^a-z0-9 ]+/g, " ").split(/\s+/).filter((w) => w && !STOP.has(w) && !/^\d+$/.test(w));
const titleCase = (value) =>
  String(value || "")
    .toLowerCase()
    .replace(/\b([a-z])/g, (ch) => ch.toUpperCase())
    .replace(/\b(Llc|Inc|Pa|Nj|Usa|Us|Hvac|Atm|Bbq|Cpa|Dds|Dmd|Md)\b/g, (w) => w.toUpperCase())
    .replace(/'S\b/g, "'s");
function displayName(trade) {
  return titleCase(String(trade).replace(/#\s*\d+/g, "").replace(/\b(LLC|L\.L\.C\.|INC\.?|CORP\.?|CO\.)\s*$/i, "").replace(/\s+[-–]\s*$/, "").replace(/\s{2,}/g, " ").trim());
}
function category(name, license) {
  const n = name.toLowerCase();
  const rules = [
    [/pizz|grill|diner|cafe|coffee|restaurant|deli|bagel|bakery|kitchen|tavern|pub|bistro|sushi|taco|burger|ice cream|donut/, "Dining"],
    [/bank|credit union|financial|insurance|tax/, "Financial & Services"],
    [/auto|tire|motor|car wash|collision|truck|lube/, "Automotive"],
    [/salon|nail|spa\b|barber|beauty|tattoo|hair|lash|brow|wax/, "Beauty & Wellness"],
    [/pharm|dental|medical|health|vision|eye|optical|chiropr|therap|clinic|vet|animal hospital/, "Healthcare"],
    [/hardware|lumber|supply|plumb|electric|hvac|roof|paving|landscap|nursery|garden/, "Skilled Trades"],
    [/market|grocery|foods|farm/, "Specialty Food & Gifts"],
    [/wine|beer|spirits|brew|distill/, "Beer, Wine & Spirits"],
    [/fitness|gym|golf|sport|yoga|dance|martial|karate|taekwondo|swim/, "Sports & Recreation"],
    [/telecom|computer|software|tech\b|wireless/, "Tech"],
    [/machin|packaging|manufactur|fabricat|industr/, "Manufacturing"],
    [/design|studio|consult|marketing|print/, "Business Services"],
    [/boutique|gift|collectible|antique|jewel|florist|flower|book|toy|thrift|consign|furniture|outfitter|apparel|clothing|shoe/, "Retail"],
    [/dollar|tractor supply|walmart|target|uni-mart|wawa|7-eleven|convenience|pharmacy|cvs|rite aid|walgreens/, "Retail"],
    [/hotel|inn|motel|lodge/, "Hospitality"]
  ];
  for (const [pattern, value] of rules) if (pattern.test(n)) return value;
  return /wholesale/i.test(license) ? "Business Services" : "Local Business";
}
const slugify = (value) => String(value).toLowerCase().replace(/&/g, " and ").replace(/['’]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
const cell = (lat, lon) => `${Math.floor(lat * 100)},${Math.floor(lon * 100)}`;
const grid = new Map();
for (const company of companies) {
  const key = cell(company.latitude, company.longitude);
  if (!grid.has(key)) grid.set(key, []);
  grid.get(key).push(company);
}
function nearby(point, maxMiles) {
  const lat0 = Math.floor(point.latitude * 100);
  const lon0 = Math.floor(point.longitude * 100);
  const out = [];
  for (let i = -1; i <= 1; i += 1)
    for (let j = -1; j <= 1; j += 1)
      for (const company of grid.get(`${lat0 + i},${lon0 + j}`) || []) if (miles(point, company) <= maxMiles) out.push(company);
  return out;
}

const rows = fs
  .readdirSync(path.join("data", "cache"))
  .filter((name) => name.startsWith("pa-salestax-"))
  .flatMap((name) => JSON.parse(fs.readFileSync(path.join("data", "cache", name), "utf8")));

const slugs = new Set(companies.map((company) => company.slug));
const out = [];
const skipped = { notSales: 0, person: 0, noPoint: 0, far: 0, poBox: 0, notCommercial: 0, duplicate: 0 };
const seen = [];
for (const row of rows) {
  if (!/^Sales License/i.test(row.license_type || "") || !row.trade_name) { skipped.notSales += 1; continue; }
  if (!ENTITY.test(String(row.legal_name || "").toUpperCase())) { skipped.person += 1; continue; }
  const coords = row.georeferenced_latitude_longitude_points?.coordinates;
  if (!coords) { skipped.noPoint += 1; continue; }
  const point = { latitude: coords[1], longitude: coords[0] };
  if (miles(CENTER, point) > RADIUS) { skipped.far += 1; continue; }
  const street = String(row.street_address || "");
  if (/P\.?\s*O\.?\s*BOX|\bC\/O\b|BOX\s+\d+/i.test(street)) { skipped.poBox += 1; continue; }
  const neighbors = nearby(point, 0.093); // ~150 m
  const commercial = /#\s*\d+/.test(row.trade_name) || COMMERCIAL_ADDRESS.test(street) || neighbors.length >= 3;
  if (!commercial) { skipped.notCommercial += 1; continue; }
  const name = displayName(row.trade_name);
  // Trade names that are really a place or address ("Ottsville - Easton Rd") aren't useful listings.
  if (/\b(rd|road|st|street|ave|avenue|pike|hwy|route|rt)\b/i.test(name) && /\s[-–]\s|^\d/.test(name)) { skipped.notSales += 1; continue; }
  const key = words(name);
  if (!key.length) { skipped.notSales += 1; continue; }
  const similar = (other) => {
    const theirs = new Set(words(other));
    return key.slice(0, 2).some((word) => word.length > 2 && theirs.has(word));
  };
  if (neighbors.some((company) => similar(company.name)) || seen.some((s) => miles(s, point) < 0.093 && similar(s.name))) { skipped.duplicate += 1; continue; }

  const city = titleCase(row.city || "");
  const zip = String(row.postal_code || "").slice(0, 5);
  let slug = `${slugify(name)}-${slugify(city)}`;
  for (let n = 2; slugs.has(slug); n += 1) slug = `${slugify(name)}-${slugify(city)}-${n}`;
  slugs.add(slug);
  const record = {
    name,
    slug,
    latitude: point.latitude,
    longitude: point.longitude,
    address: `${titleCase(street)}, ${city}, PA, ${zip}`,
    total_employees: null,
    hiring: false,
    years_in_business: null,
    best_places_score: null,
    onboarding_note: null,
    category: category(name, row.license_type),
    website: null,
    description: `${name} holds a Pennsylvania sales-tax license at this location in ${city}.`,
    logo_url: null,
    source_name: "PA Dept. of Revenue sales-tax license",
    source_url: DATASET_PAGE,
    data_status: "needs-website-audit"
  };
  out.push(record);
  seen.push(record);
}

fs.writeFileSync(path.join("data", "salestax-candidates.json"), `${JSON.stringify(out, null, 2)}\n`);
const byCat = {};
for (const record of out) byCat[record.category] = (byCat[record.category] || 0) + 1;
console.log(`Candidates: ${out.length}`, skipped, byCat);
