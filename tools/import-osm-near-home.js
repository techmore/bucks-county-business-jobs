// Build a REVIEW-ONLY candidate file of named OpenStreetMap businesses within
// 15 miles of Pipersville, PA that are not already in companies.json.
//
// Unlike tools/import-osm-businesses.js this does NOT require a street address
// (rural OSM entries rarely have addr:* tags) and has no per-category caps.
// When OSM has no usable address the record gets "near <village>, PA" from the
// nearest OSM place=village/hamlet/town node and `address_approximate: true`.
//
// It never touches companies.json. Output: data/osm-candidates-near-pipersville.json
//
//   node tools/import-osm-near-home.js            # uses cached Overpass tiles if present
//   node tools/import-osm-near-home.js --refresh  # re-download from Overpass
//
// Options: --radius-miles 15  --out data/osm-candidates-near-pipersville.json

const fs = require("fs");
const os = require("os");
const path = require("path");
const rules = require("./hiring-rules");
const { isClosedChain, lifecycleClosed } = require("./closed-rules");

const ROOT = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
const argValue = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const HOME = { name: "Pipersville", latitude: 40.4384, longitude: -75.1238 };
const RADIUS_MILES = Number(argValue("--radius-miles", 15));
const OUT = path.resolve(ROOT, argValue("--out", "data/osm-candidates-near-pipersville.json"));
const REFRESH = args.includes("--refresh");
const CACHE_DIR = path.join(os.tmpdir(), "bucks-osm-near-home-cache");
const ENDPOINT = "https://overpass-api.de/api/interpreter";
const USER_AGENT = "bucks-county-directory-osm-candidates/1.0";
const DEDUPE_METERS = 150;
const MAX_ATTEMPTS = 5;
const MAX_SPLIT_DEPTH = 2;

// ---------- which OSM features count as businesses / employers ----------

const AMENITY = new Set([
  "restaurant", "cafe", "fast_food", "bar", "pub", "ice_cream", "biergarten", "food_court", "nightclub",
  "bank", "post_office",
  "clinic", "dentist", "doctors", "pharmacy", "veterinary", "hospital", "nursing_home", "social_facility",
  "school", "college", "university", "kindergarten", "childcare", "library", "music_school", "language_school",
  "driving_school", "prep_school",
  "fuel", "car_wash", "car_rental", "vehicle_inspection",
  "theatre", "cinema", "arts_centre", "events_venue", "animal_boarding", "animal_shelter", "marketplace",
  "townhall", "funeral_hall"
]);
const TOURISM = new Set([
  "hotel", "motel", "guest_house", "hostel", "camp_site", "caravan_site", "chalet", "winery",
  "museum", "gallery", "theme_park", "zoo", "wine_cellar"
]);
const LEISURE = new Set([
  "golf_course", "fitness_centre", "sports_centre", "marina", "horse_riding", "bowling_alley", "ice_rink",
  "water_park", "miniature_golf", "dance", "escape_game", "amusement_arcade", "trampoline_park", "resort",
  "shooting_ground", "summer_camp"
]);
const LANDUSE = new Set(["farmyard", "orchard", "vineyard", "industrial", "quarry"]);
const BUILDING = new Set(["commercial", "industrial", "office", "retail", "warehouse", "hotel", "supermarket"]);
const SKIP_SHOP = new Set(["vacant", "no", "disused", "yes_closed"]);
const SKIP_OFFICE = new Set(["religion", "vacant", "no"]);

const re = (set) => `^(${[...set].join("|")})$`;
const FILTERS = [
  `["name"]["shop"]`,
  `["name"]["office"]`,
  `["name"]["craft"]`,
  `["name"]["healthcare"]`,
  `["name"]["industrial"]`,
  `["name"]["man_made"="works"]`,
  `["name"]["place"="farm"]`,
  `["name"]["amenity"~"${re(AMENITY)}"]`,
  `["name"]["tourism"~"${re(TOURISM)}"]`,
  `["name"]["leisure"~"${re(LEISURE)}"]`,
  `["name"]["landuse"~"${re(LANDUSE)}"]`,
  `["name"]["building"~"${re(BUILDING)}"]`
];

// ---------- geometry ----------

function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
const distanceMeters = (a, b) => distanceMiles(a.latitude, a.longitude, b.latitude, b.longitude) * 1609.344;

function boundingBox(center, miles, padMiles = 0) {
  const dLat = (miles + padMiles) / 69.0;
  const dLon = (miles + padMiles) / (69.172 * Math.cos((center.latitude * Math.PI) / 180));
  return { s: center.latitude - dLat, w: center.longitude - dLon, n: center.latitude + dLat, e: center.longitude + dLon };
}

function splitBox(box, rows, cols) {
  const tiles = [];
  const h = (box.n - box.s) / rows;
  const w = (box.e - box.w) / cols;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      tiles.push({ s: box.s + r * h, w: box.w + c * w, n: box.s + (r + 1) * h, e: box.w + (c + 1) * w });
    }
  }
  return tiles;
}

const bboxString = (b) => [b.s, b.w, b.n, b.e].map((v) => v.toFixed(5)).join(",");

// ---------- Overpass with cache, backoff and tile splitting ----------

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const problems = [];

async function overpass(query, cacheKey) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
  const cacheFile = path.join(CACHE_DIR, `${cacheKey}.json`);
  if (!REFRESH && fs.existsSync(cacheFile)) return JSON.parse(fs.readFileSync(cacheFile, "utf8"));

  let wait = 15000;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 240000);
    try {
      const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "user-agent": USER_AGENT, accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(query)}`,
        signal: controller.signal
      });
      const text = await response.text();
      if (!response.ok) throw new Error(`HTTP ${response.status} ${text.slice(0, 120).replace(/\s+/g, " ")}`);
      const payload = JSON.parse(text);
      if (payload.remark && /runtime error|timed out|out of memory/i.test(payload.remark)) {
        throw Object.assign(new Error(`Overpass remark: ${payload.remark}`), { tooBig: true });
      }
      fs.writeFileSync(cacheFile, text);
      await sleep(5000); // be polite between requests
      return payload;
    } catch (error) {
      const message = error.name === "AbortError" ? "client timeout after 240s" : error.message;
      problems.push(`${cacheKey} attempt ${attempt}: ${message}`);
      console.error(`  ${cacheKey} attempt ${attempt} failed: ${message}`);
      if (error.tooBig || attempt === MAX_ATTEMPTS) throw Object.assign(new Error(message), { tooBig: true });
      console.error(`  waiting ${wait / 1000}s before retry`);
      await sleep(wait);
      wait *= 2;
    } finally {
      clearTimeout(timer);
    }
  }
  throw new Error("unreachable");
}

// Business query for one tile. Elements that fall in New Jersey are printed first
// with `out ids` (no tags), so we can tell PA from NJ without a second request.
function businessQuery(box) {
  const bb = bboxString(box);
  const body = FILTERS.map((f) => `  nwr${f}(${bb});`).join("\n");
  return `[out:json][timeout:180];
area["ISO3166-2"="US-NJ"]->.nj;
(
${body}
)->.all;
nwr.all(area.nj);
out ids;
.all out center tags;`;
}

async function fetchTile(box, label, depth = 0) {
  try {
    console.log(`Querying tile ${label} (${bboxString(box)})`);
    const payload = await overpass(businessQuery(box), `biz-${bboxString(box).replace(/[^0-9.-]+/g, "_")}`);
    return payload.elements || [];
  } catch (error) {
    if (depth >= MAX_SPLIT_DEPTH) throw error;
    console.error(`  splitting tile ${label} into 4`);
    const parts = splitBox(box, 2, 2);
    const out = [];
    for (let i = 0; i < parts.length; i += 1) out.push(...(await fetchTile(parts[i], `${label}.${i + 1}`, depth + 1)));
    return out;
  }
}

async function fetchPlaces(box) {
  const bb = bboxString(box);
  const query = `[out:json][timeout:120];
area["ISO3166-2"="US-NJ"]->.nj;
node["place"~"^(village|hamlet|town|city)$"]["name"](${bb})->.all;
node.all(area.nj);
out ids;
.all out body;`;
  const payload = await overpass(query, `places-${bb.replace(/[^0-9.-]+/g, "_")}`);
  return splitStateMarkers(payload.elements || []).map(({ element, state }) => ({
    name: element.tags.name,
    place: element.tags.place,
    state,
    latitude: element.lat,
    longitude: element.lon
  }));
}

// Elements without tags are NJ membership markers emitted by `out ids`.
function splitStateMarkers(elements) {
  const nj = new Set();
  const full = new Map();
  for (const el of elements) {
    const key = `${el.type}/${el.id}`;
    if (!el.tags) nj.add(key);
    else full.set(key, el);
  }
  return [...full.entries()].map(([key, element]) => ({ element, state: nj.has(key) ? "NJ" : "PA" }));
}

// ---------- normalizing into the companies.json schema ----------

function slugify(value) {
  return value.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

function normalizeName(value) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’`]s\b/g, "s")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\b(the|inc|llc|ltd|co|corp|company|incorporated)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Names that mark a feature as gone, mis-mapped, or infrastructure rather than an employer.
const JUNK_NAME = /^(private|unnamed|no name|map out of date)$|^(former|old|site of)\b|\((closed|former|demolished)\)|\b(stockpile|pump station|compressor station|substation)\b/i;

function hasUsableName(name) {
  return /[a-zA-Z]{3,}/.test(name) && !/^\d+[A-Za-z]?$/.test(name.trim()) && !JUNK_NAME.test(name.trim());
}

const DRINKS = new Set(["winery", "brewery", "distillery", "cider"]);

// Mirrors categoryFor() in tools/import-osm-businesses.js, plus farms, drinks makers,
// government, care homes and childcare, using only categories already in companies.json.
function categoryFor(tags) {
  if (DRINKS.has(tags.craft) || tags.tourism === "winery" || tags.tourism === "wine_cellar" || tags.landuse === "vineyard") {
    return "Beer, Wine & Spirits";
  }
  if (tags.shop) return shopCategory(tags.shop);
  if (tags.place === "farm" || ["farmyard", "orchard"].includes(tags.landuse)) return "Agriculture";
  if (tags.amenity) return amenityCategory(tags.amenity);
  if (tags.office) return officeCategory(tags.office);
  if (tags.healthcare) return "Healthcare";
  if (tags.industrial || tags.man_made === "works" || ["industrial", "quarry"].includes(tags.landuse)) return "Manufacturing";
  if (tags.craft) return "Skilled Trades";
  if (tags.tourism) return "Hospitality";
  if (tags.leisure) return "Sports & Recreation";
  if (tags.building) return buildingCategory(tags.building);
  return "Local Business";
}

function shopCategory(value) {
  const food = new Set(["bakery", "butcher", "cheese", "coffee", "confectionery", "deli", "farm", "greengrocer", "seafood", "spices", "tea", "wine"]);
  const retail = new Set(["books", "boutique", "clothes", "convenience", "department_store", "florist", "gift", "jewelry", "shoes", "sports", "supermarket", "toys"]);
  const home = new Set(["antiques", "appliance", "doityourself", "furniture", "garden_centre", "hardware", "houseware", "interior_decoration"]);
  const auto = new Set(["car", "car_repair", "motorcycle", "tyres", "car_parts"]);
  if (food.has(value)) return "Specialty Food & Gifts";
  if (retail.has(value)) return "Retail";
  if (home.has(value)) return "Lifestyle & Home Decor";
  if (auto.has(value)) return "Automotive";
  if (["hairdresser", "beauty", "massage", "cosmetics", "tattoo"].includes(value)) return "Beauty & Wellness";
  if (value === "alcohol" || value === "beverages") return "Beer, Wine & Spirits";
  return "Retail";
}

function amenityCategory(value) {
  if (["bar", "biergarten", "cafe", "fast_food", "ice_cream", "pub", "restaurant", "food_court", "nightclub"].includes(value)) return "Dining";
  if (["bank", "post_office"].includes(value)) return "Financial & Services";
  if (["clinic", "dentist", "doctors", "pharmacy", "veterinary", "hospital", "nursing_home", "social_facility"].includes(value)) return "Healthcare";
  if (["school", "college", "university", "kindergarten", "childcare", "library", "music_school", "language_school", "driving_school", "prep_school"].includes(value)) return "Education";
  if (["fuel", "car_wash", "car_rental", "vehicle_inspection"].includes(value)) return "Automotive";
  if (["theatre", "cinema", "arts_centre", "events_venue"].includes(value)) return "Hospitality";
  if (value === "townhall") return "Government";
  return "Services";
}

function officeCategory(value) {
  if (["accountant", "financial", "insurance", "lawyer", "real_estate", "tax_advisor"].includes(value)) return "Professional Services";
  if (value === "company" || value === "it") return "Business Services";
  if (value === "government") return "Government";
  return "Professional Services";
}

function buildingCategory(value) {
  if (["commercial", "office", "retail", "supermarket", "kiosk"].includes(value)) return "Business Services";
  if (["industrial", "warehouse"].includes(value)) return "Manufacturing";
  if (value === "hotel") return "Hospitality";
  return "Local Business";
}

function typeLabel(tags) {
  const raw =
    tags.shop || tags.amenity || tags.office || tags.healthcare || tags.craft || tags.tourism || tags.leisure ||
    (tags.place === "farm" ? "farm" : null) ||
    (tags.landuse === "farmyard" ? "farm" : tags.landuse) ||
    (tags.man_made === "works" ? "works" : null) ||
    (tags.industrial ? `${tags.industrial} industrial site` : null) ||
    (tags.building ? `${tags.building} building` : "business");
  return String(raw).split(";")[0].replaceAll("_", " ");
}

function isExcluded(tags) {
  if (tags.shop && SKIP_SHOP.has(tags.shop)) return true;
  if (tags.office && SKIP_OFFICE.has(tags.office)) return true;
  if (tags.disused === "yes" || tags.abandoned === "yes" || tags.opening_hours === "closed") return true;
  // Not operating any more: disused:*/abandoned:*/vacant in OpenStreetMap, or a chain that has closed.
  if (lifecycleClosed(tags) || isClosedChain(tags.name) || isClosedChain(tags.brand)) return true;
  if (tags.amenity === "place_of_worship" && !tags.shop && !tags.office) return true;
  if (tags.leisure === "park" || tags.leisure === "nature_reserve") return true;
  if (tags.building && !BUILDING.has(tags.building) && !tags.shop && !tags.amenity && !tags.office && !tags.craft &&
      !tags.healthcare && !tags.tourism && !tags.leisure && !tags.industrial && tags.place !== "farm" &&
      !LANDUSE.has(tags.landuse) && tags.man_made !== "works") return true;
  return false;
}

function hasUsableAddress(tags) {
  return Boolean(tags["addr:street"] && (tags["addr:city"] || tags["addr:postcode"]));
}

function tagAddress(tags, state) {
  const parts = [];
  if (tags["addr:housenumber"] || tags["addr:street"]) parts.push(`${tags["addr:housenumber"] || ""} ${tags["addr:street"] || ""}`.trim());
  if (tags["addr:city"]) parts.push(tags["addr:city"]);
  parts.push(tags["addr:state"] || state);
  if (tags["addr:postcode"]) parts.push(tags["addr:postcode"]);
  return parts.join(", ");
}

function nearestPlace(point, places, state) {
  let best = null;
  for (const place of places) {
    if (place.state !== state) continue;
    const d = distanceMiles(point.latitude, point.longitude, place.latitude, place.longitude);
    if (!best || d < best.miles) best = { ...place, miles: d };
  }
  return best;
}

function buildRecord({ element, state }, places) {
  const tags = element.tags || {};
  const name = (tags.name || "").trim();
  const latitude = element.lat ?? element.center?.lat;
  const longitude = element.lon ?? element.center?.lon;
  if (!name || !hasUsableName(name) || latitude == null || longitude == null || isExcluded(tags)) return null;
  // A landuse/building area just named after a village (e.g. "Doylestown") is not a business.
  const hasBusinessKey = ["shop", "amenity", "office", "craft", "healthcare", "tourism", "leisure"].some((k) => tags[k]);
  if (!hasBusinessKey && places.some((p) => p.name.toLowerCase() === name.toLowerCase())) return null;
  const miles = distanceMiles(HOME.latitude, HOME.longitude, latitude, longitude);
  if (miles > RADIUS_MILES) return null;

  const st = /^(NJ|New Jersey)$/i.test(tags["addr:state"] || "") ? "NJ" : /^(PA|Pennsylvania)$/i.test(tags["addr:state"] || "") ? "PA" : state;
  const near = nearestPlace({ latitude, longitude }, places, st);
  const nearName = near ? near.name : HOME.name;

  let address;
  let approximate;
  if (hasUsableAddress(tags)) {
    address = tagAddress(tags, st);
    approximate = false;
  } else if (tags["addr:street"]) {
    address = `${`${tags["addr:housenumber"] || ""} ${tags["addr:street"]}`.trim()}, near ${nearName}, ${st}`;
    approximate = true;
  } else {
    address = `near ${nearName}, ${st}`;
    approximate = true;
  }

  const type = typeLabel(tags);
  const town = tags["addr:city"];
  const where = approximate ? `near ${nearName}` : town ? `in ${town}` : "nearby";
  const record = {
    name,
    slug: `osm-${slugify(name)}-${element.type}-${element.id}`,
    latitude,
    longitude,
    address,
    address_approximate: approximate,
    total_employees: null,
    hiring: false,
    years_in_business: null,
    best_places_score: null,
    onboarding_note: null,
    category: categoryFor(tags),
    website: tags.website || tags["contact:website"] || tags.url || null,
    description: `${name} (${type}) is ${where}. Location from OpenStreetMap.`,
    logo_url: null,
    source_name: "OpenStreetMap Overpass business candidate import",
    source_url: `https://www.openstreetmap.org/${element.type}/${element.id}`,
    data_status: "needs-website-audit"
  };
  if (tags.start_date) record.start_date = tags.start_date;
  record.hiring_status = rules.hiringStatus(record);
  record.hiring = record.hiring_status === "hiring";
  // Not part of the published schema; used only for this run's report and stripped before writing.
  Object.defineProperty(record, "_meta", {
    value: { nearest: `${nearName}, ${st}`, miles, tagCount: Object.keys(tags).length, osmType: element.type },
    enumerable: false
  });
  return record;
}

function namesMatch(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  // One name's words all appear in the other ("Indian Valley Library" / "Indian Valley Public Library",
  // "Wawa" / "Wawa Food Market"). Only applied to features already within the dedupe distance.
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  const shortWords = short.split(" ");
  const longWords = new Set(long.split(" "));
  if (shortWords.length === 1 && short.length < 4) return false;
  return shortWords.every((w) => longWords.has(w));
}

// ---------- main ----------

async function main() {
  const existing = JSON.parse(fs.readFileSync(path.join(ROOT, "companies.json"), "utf8"));
  const existingSources = new Set(existing.map((c) => c.source_url).filter(Boolean));
  const existingPoints = existing
    .filter((c) => Number.isFinite(c.latitude) && Number.isFinite(c.longitude))
    .map((c) => ({ latitude: c.latitude, longitude: c.longitude, key: normalizeName(c.name || ""), name: c.name }));

  const box = boundingBox(HOME, RADIUS_MILES, 0.2);
  const places = await fetchPlaces(boundingBox(HOME, RADIUS_MILES, 4));
  console.log(`Loaded ${places.length} place nodes (village/hamlet/town/city)`);

  const elements = [];
  const tiles = splitBox(box, 2, 2);
  for (let i = 0; i < tiles.length; i += 1) elements.push(...(await fetchTile(tiles[i], `T${i + 1}`)));

  // Tiles can overlap at edges; merge NJ markers + full elements across all tiles.
  const marked = splitStateMarkers(elements);
  console.log(`Overpass returned ${marked.length} unique named features`);

  const stats = { outsideOrUnusable: 0, sameOsmId: 0, nameNearExisting: 0, internalDuplicate: 0 };
  const candidates = [];
  for (const item of marked) {
    const record = buildRecord(item, places);
    if (!record) {
      stats.outsideOrUnusable += 1;
      continue;
    }
    if (existingSources.has(record.source_url)) {
      stats.sameOsmId += 1;
      continue;
    }
    const key = normalizeName(record.name);
    if (existingPoints.some((p) => namesMatch(p.key, key) && distanceMeters(p, record) <= DEDUPE_METERS)) {
      stats.nameNearExisting += 1;
      continue;
    }
    candidates.push(record);
  }

  // Collapse the same business mapped twice (e.g. place=farm node + landuse=farmyard way).
  const score = (r) => (r.address_approximate ? 0 : 100) + (r.website ? 50 : 0) + r._meta.tagCount + (r._meta.osmType === "node" ? 1 : 0);
  candidates.sort((a, b) => score(b) - score(a));
  const kept = [];
  for (const record of candidates) {
    const key = normalizeName(record.name);
    const dupe = kept.some((k) => {
      const other = normalizeName(k.name);
      const d = distanceMeters(k, record);
      // Same name within 150 m, or identical name within 400 m (several buildings on one campus).
      return (namesMatch(other, key) && d <= DEDUPE_METERS) || (other === key && d <= 400);
    });
    if (dupe) {
      stats.internalDuplicate += 1;
      continue;
    }
    kept.push(record);
  }

  // Same name already in companies.json but farther than the dedupe radius: kept, but reported.
  const farNameMatches = kept.filter((r) => {
    const key = normalizeName(r.name);
    return existingPoints.some((p) => p.key === key && distanceMeters(p, r) <= 2000);
  });

  kept.sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  fs.writeFileSync(OUT, `${JSON.stringify(kept, null, 2)}\n`);

  const tally = (fn) => Object.entries(kept.reduce((m, r) => ((m[fn(r)] = (m[fn(r)] || 0) + 1), m), {})).sort((a, b) => b[1] - a[1]);
  console.log(`\nWrote ${kept.length} candidates to ${path.relative(ROOT, OUT)}`);
  console.log("Skipped:", stats);
  console.log(`Approximate addresses: ${kept.filter((r) => r.address_approximate).length}; with website: ${kept.filter((r) => r.website).length}; with start_date: ${kept.filter((r) => r.start_date).length}`);
  console.log(`Within 5 mi: ${kept.filter((r) => r._meta.miles <= 5).length}; within 10 mi: ${kept.filter((r) => r._meta.miles <= 10).length}`);
  console.log("\nBy category:");
  for (const [k, v] of tally((r) => r.category)) console.log(`  ${v}\t${k}`);
  console.log("\nBy nearest village/town:");
  for (const [k, v] of tally((r) => r._meta.nearest)) console.log(`  ${v}\t${k}`);
  if (farNameMatches.length) {
    console.log(`\nPossible duplicates (same name in companies.json 150 m - 2 km away), kept for review: ${farNameMatches.length}`);
    for (const r of farNameMatches.slice(0, 20)) console.log(`  ${r.name}  ${r.source_url}`);
  }
  if (problems.length) {
    console.log(`\nOverpass problems (${problems.length}):`);
    for (const p of problems) console.log(`  ${p}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
