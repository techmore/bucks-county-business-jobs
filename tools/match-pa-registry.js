// Match map businesses to PA public records to learn when each was registered.
// Inputs (from tools/fetch-pa-registry.js, kept in data/cache/, never published):
//   pa-registry-*.json  - Dept. of State registrations (legal name, type, date, registered address)
//   pa-salestax-*.json  - Revenue sales-tax licenses (legal name, storefront name, sales location)
//
// How a match is made (names compared without Inc/LLC/punctuation):
//   1. Registry name == our name, and the street address matches        -> high
//   2. Registry name == our name, and the town or ZIP matches            -> medium
//   3. Sales-tax storefront name == our name at our ZIP/street; its legal
//      name is then found in the registry in the same town/ZIP           -> high (street) / medium
// Ambiguous matches are skipped. The state's 1753-01-01 placeholder date is ignored.
// Only the year, entity type and confidence are saved; addresses stay in the local cache.
//
//   node tools/match-pa-registry.js           # dry run
//   node tools/match-pa-registry.js --write   # update companies.json

const fs = require("fs");
const path = require("path");

const write = process.argv.includes("--write");
const DATASET_PAGE = "https://data.pa.gov/Licenses-Certificates/Registered-Businesses-in-PA-Current-by-County-Department-of-State/xvd7-5r2c";
const THIS_YEAR = new Date().getFullYear();

const SUFFIXES = new Set(["inc", "incorporated", "llc", "l", "c", "corp", "corporation", "co", "company", "ltd", "limited", "pc", "pllc", "lp", "llp", "the", "pa", "of", "a", "and"]);
function norm(name) {
  return String(name || "")
    .toLowerCase()
    .replace(/\bassumed name\b.*$/, "")
    .replace(/\bd\/?b\/?a\b.*$/, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((word) => word && !SUFFIXES.has(word))
    .join(" ");
}
const normCity = (city) => String(city || "").toLowerCase().replace(/[^a-z]/g, "");
const STREET_WORDS = { road: "rd", rd: "rd", street: "st", st: "st", avenue: "ave", ave: "ave", pike: "pike", highway: "hwy", hwy: "hwy", lane: "ln", ln: "ln", drive: "dr", dr: "dr", boulevard: "blvd", blvd: "blvd", route: "rt", rt: "rt", court: "ct", ct: "ct", way: "way", place: "pl", pl: "pl" };
function normStreet(line) {
  const match = String(line || "").toLowerCase().replace(/[.,#]/g, " ").match(/^\s*(\d+[a-z]?)\s+(.+)$/);
  if (!match) return null;
  const words = match[2].split(/\s+/).filter(Boolean).map((word) => STREET_WORDS[word] || word);
  const name = words.filter((word) => !["n", "s", "e", "w", "north", "south", "east", "west"].includes(word)).slice(0, 2).join(" ");
  return `${match[1]} ${name}`;
}

function location(company) {
  const address = company.address || "";
  const parts = address.split(",").map((part) => part.trim().replace(/^near\s+/i, "")).filter(Boolean);
  const zip = (address.match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null;
  let town = null;
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) town = parts[parts.length - 3];
  else if (parts.length >= 2) town = parts[parts.length - 2].replace(/\b(PA|NJ)\b.*$/, "").trim();
  if (town && /^\d/.test(town)) town = null;
  const street = company.address_approximate ? null : normStreet(parts[0]);
  return { town: town && normCity(town), zip, street, state: /\bNJ\b/.test(address) ? "NJ" : "PA" };
}

function loadCache(prefix) {
  const dir = path.join("data", "cache");
  return fs.readdirSync(dir).filter((name) => name.startsWith(prefix)).flatMap((name) => JSON.parse(fs.readFileSync(path.join(dir, name), "utf8")));
}

const registryByName = new Map();
for (const row of loadCache("pa-registry-")) {
  const key = norm(row.business_name);
  const year = Number(String(row.creationdate || "").slice(0, 4));
  if (!key || !year || year < 1800) continue;
  const entry = {
    filing: row.filing_number,
    name: row.business_name,
    type: row.typeofbusinessregistration || "",
    year,
    city: normCity(row.city),
    zip: String(row.zip || "").slice(0, 5),
    street: normStreet(row.address_line1)
  };
  if (!registryByName.has(key)) registryByName.set(key, []);
  registryByName.get(key).push(entry);
}

const salesByTrade = new Map();
for (const row of loadCache("pa-salestax-")) {
  for (const name of new Set([row.trade_name, row.legal_name].filter(Boolean))) {
    const key = norm(name);
    if (!key) continue;
    if (!salesByTrade.has(key)) salesByTrade.set(key, []);
    salesByTrade.get(key).push({ legal: norm(row.legal_name), city: normCity(row.city), zip: String(row.postal_code || "").slice(0, 5), street: normStreet(row.street_address) });
  }
}

const near = (row, loc) => (loc.town && row.city === loc.town) || (loc.zip && row.zip === loc.zip);
const sameStreet = (row, loc) => Boolean(loc.street && row.street && row.street === loc.street);

function pick(rows) {
  const filings = [...new Map(rows.map((row) => [row.filing, row])).values()];
  if (!filings.length) return null;
  if (new Set(filings.map((row) => row.year)).size > 1) return "ambiguous";
  return filings[0];
}

function matchCompany(company) {
  const loc = location(company);
  if (loc.state !== "PA") return null;
  const key = norm(company.name);
  const direct = (registryByName.get(key) || []).filter((row) => near(row, loc) || sameStreet(row, loc));
  const directStreet = direct.filter((row) => sameStreet(row, loc));
  if (directStreet.length) {
    const row = pick(directStreet);
    if (row && row !== "ambiguous") return { row, confidence: "high", via: "registry address" };
  }
  if (direct.length) {
    const row = pick(direct);
    if (row === "ambiguous") return "ambiguous";
    if (row) return { row, confidence: "medium", via: "registry name and town" };
  }
  // Storefront name -> legal entity -> registry.
  const sales = (salesByTrade.get(key) || []).filter((row) => near(row, loc) || sameStreet(row, loc));
  for (const sale of sales) {
    const legal = (registryByName.get(sale.legal) || []).filter((row) => near(row, loc) || near(row, sale) || sameStreet(row, sale));
    const row = pick(legal);
    // Only trust the storefront-name route when the sales location is our street address.
    if (row && row !== "ambiguous" && sameStreet(sale, loc)) {
      return { row, confidence: "high", via: "sales-tax storefront name" };
    }
  }
  return null;
}

const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
const stats = { pa: 0, high: 0, medium: 0, ambiguous: 0, none: 0, viaSales: 0 };
const examples = [];
for (const company of companies) {
  if (location(company).state !== "PA") continue;
  stats.pa += 1;
  const result = matchCompany(company);
  if (!result) { stats.none += 1; continue; }
  if (result === "ambiguous") { stats.ambiguous += 1; continue; }
  stats[result.confidence] += 1;
  if (result.via.startsWith("sales")) stats.viaSales += 1;
  const { row } = result;
  const foreign = /^Foreign/i.test(row.type);
  if (examples.length < 20 && (result.via.startsWith("sales") || examples.length < 8)) examples.push(`${company.name} -> ${row.name} (${row.year}, ${row.type}; ${result.confidence}, ${result.via})`);
  if (write && (!company.founded_source || company.founded_source === "pa-dos")) {
    Object.assign(company, {
      founded_year: row.year,
      founded_source: "pa-dos",
      founded_confidence: result.confidence,
      founded_entity_type: row.type,
      founded_label: foreign ? `Registered to do business in PA in ${row.year}` : `Registered with the PA Dept. of State in ${row.year}`,
      founded_note: "Date the legal entity was registered. The business may be older, or under new ownership.",
      founded_source_url: DATASET_PAGE
    });
    company.years_in_business = THIS_YEAR - row.year;
  }
}

console.log(stats);
console.log(examples.join("\n"));
if (write) {
  fs.writeFileSync("companies.json", `${JSON.stringify(companies, null, 2)}\n`);
  const known = companies.filter((company) => company.founded_year);
  console.log(`Wrote companies.json. Year known: ${known.length}; registered 10+ years ago: ${known.filter((company) => THIS_YEAR - company.founded_year >= 10).length}`);
}
