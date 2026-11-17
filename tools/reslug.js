// One-time: give every business a short, readable page address: <name>-<town>
// (e.g. "cooper-mechanical-ottsville" instead of "osm-cooper-mechanical-inc-node-12817806378").
// Updates companies.json and data/hiring-history.jsonl, and writes data/slug-map.json (old -> new).
//
//   node tools/reslug.js           # dry run
//   node tools/reslug.js --write

const fs = require("fs");

const write = process.argv.includes("--write");
const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));

const DROP = new Set(["inc", "llc", "corp", "co", "ltd", "pc", "the", "incorporated", "corporation", "company", "limited", "pllc", "llp", "lp"]);
function slugify(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((word) => word && !DROP.has(word))
    .join("-");
}
function townOf(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim().replace(/^near\s+/i, "")).filter(Boolean);
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) return parts[parts.length - 3];
  if (parts.length >= 2) {
    const town = parts[parts.length - 2].replace(/\b(PA|NJ)\b.*$/, "").trim();
    if (town && !/^\d/.test(town)) return town;
  }
  return "";
}

const map = {};
const used = new Set();
// Stable order so re-runs give the same answer.
const ordered = [...companies].sort((a, b) => a.name.localeCompare(b.name) || a.slug.localeCompare(b.slug));
for (const company of ordered) {
  const name = slugify(company.name).slice(0, 60).replace(/-+$/, "") || "business";
  const town = slugify(townOf(company));
  let base = town && !name.endsWith(town) ? `${name}-${town}` : name;
  let slug = base;
  for (let n = 2; used.has(slug); n += 1) slug = `${base}-${n}`;
  used.add(slug);
  if (slug !== company.slug) map[company.slug] = slug;
}

console.log(`${Object.keys(map).length} of ${companies.length} slugs change. Examples:`);
for (const [from, to] of Object.entries(map).slice(0, 12)) console.log(`  ${from}  ->  ${to}`);

if (write) {
  for (const company of companies) {
    if (map[company.slug]) {
      company.previous_slugs = [...new Set([...(company.previous_slugs || []), company.slug])];
      company.slug = map[company.slug];
    }
  }
  fs.writeFileSync("companies.json", `${JSON.stringify(companies, null, 2)}\n`);
  const history = "data/hiring-history.jsonl";
  if (fs.existsSync(history)) {
    const lines = fs
      .readFileSync(history, "utf8")
      .split("\n")
      .filter((line) => line.trim())
      .map((line) => {
        const row = JSON.parse(line);
        if (map[row.slug]) row.slug = map[row.slug];
        return JSON.stringify(row);
      });
    fs.writeFileSync(history, `${lines.join("\n")}\n`);
  }
  const previous = fs.existsSync("data/slug-map.json") ? JSON.parse(fs.readFileSync("data/slug-map.json", "utf8")) : {};
  fs.writeFileSync("data/slug-map.json", `${JSON.stringify({ ...previous, ...map }, null, 2)}\n`);
  console.log("Wrote companies.json, data/hiring-history.jsonl, data/slug-map.json");
}
