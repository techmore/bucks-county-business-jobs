// Merge reviewed candidate businesses (e.g. data/osm-candidates-near-pipersville.json) into companies.json.
//   node tools/merge-candidates.js data/osm-candidates-near-pipersville.json [--write]
// Skips: names already in companies.json, adult venues, and likely-historic schoolhouse points
// (no website, approximate address, name like "Fretz School").
const fs = require("fs");

const [file] = process.argv.slice(2).filter((arg) => !arg.startsWith("--"));
const write = process.argv.includes("--write");
const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
const candidates = JSON.parse(fs.readFileSync(file, "utf8"));

const norm = (name) => name.toLowerCase().replace(/&/g, "and").replace(/[^a-z0-9]/g, "");
const miles = (a, b) => {
  const toRad = (v) => (v * Math.PI) / 180;
  const h = Math.sin(toRad(b.latitude - a.latitude) / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(toRad(b.longitude - a.longitude) / 2) ** 2;
  return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
};
// Same name within ~2 km is the same place; chain locations farther apart are separate employers.
const byName = new Map();
for (const company of companies) {
  const key = norm(company.name);
  if (!byName.has(key)) byName.set(key, []);
  byName.get(key).push(company);
}
const KNOWN_SCHOOLS = /^(Solebury School)$/;
const slugs = new Set(companies.map((company) => company.slug));
const skipped = { duplicateName: [], adult: [], historicSchool: [] };
const added = [];

for (const candidate of candidates) {
  if (slugs.has(candidate.slug)) continue;
  const same = byName.get(norm(candidate.name)) || [];
  if (same.some((company) => miles(company, candidate) < 1.25)) { skipped.duplicateName.push(candidate.name); continue; }
  if (/showbar|gentlem[ae]n'?s club|strip club|adult (store|video|entertainment)/i.test(candidate.name)) { skipped.adult.push(candidate.name); continue; }
  if (candidate.category === "Education" && !candidate.website && candidate.address_approximate && /^[A-Z][\w'.-]* School$/.test(candidate.name) && !KNOWN_SCHOOLS.test(candidate.name)) {
    skipped.historicSchool.push(candidate.name);
    continue;
  }
  added.push(candidate);
  if (!byName.has(norm(candidate.name))) byName.set(norm(candidate.name), []);
  byName.get(norm(candidate.name)).push(candidate);
  slugs.add(candidate.slug);
}

console.log(`Adding ${added.length} of ${candidates.length}`);
for (const [reason, list] of Object.entries(skipped)) console.log(`Skipped ${reason} (${list.length}): ${list.slice(0, 40).join("; ")}`);
if (write) {
  const merged = [...companies, ...added].sort((a, b) => a.name.localeCompare(b.name));
  fs.writeFileSync("companies.json", `${JSON.stringify(merged, null, 2)}\n`);
  console.log(`Wrote companies.json (${merged.length} records)`);
}
