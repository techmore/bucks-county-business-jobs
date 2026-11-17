// Build data/directory.sqlite from the text sources kept in git:
//   companies.json            - one record per business (current state)
//   data/hiring-history.jsonl - every hiring check ever made (append-only)
//
// The .sqlite file is rebuilt, not committed: text files diff cleanly in git,
// and the database is the fast query layer for the page builder and future tools.
//
//   node --no-warnings tools/build-db.js

const fs = require("fs");
const path = require("path");
const { DatabaseSync } = require("node:sqlite");
const guide = require("../assets/guide.js");

const DB_PATH = path.join("data", "directory.sqlite");
fs.mkdirSync("data", { recursive: true });
fs.rmSync(DB_PATH, { force: true });

const db = new DatabaseSync(DB_PATH);
db.exec(`
  PRAGMA journal_mode = OFF;
  PRAGMA synchronous = OFF;

  CREATE TABLE businesses (
    slug TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    industry_group TEXT,
    hiring_speed TEXT,
    address TEXT,
    address_approximate INTEGER DEFAULT 0,
    town TEXT,
    latitude REAL NOT NULL,
    longitude REAL NOT NULL,
    website TEXT,
    description TEXT,
    hiring_status TEXT,
    hiring_signal TEXT,
    hiring_last_checked TEXT,
    hiring_evidence_url TEXT,
    hiring_note TEXT,
    verification_note TEXT,
    total_employees INTEGER,
    years_in_business INTEGER,
    start_date TEXT,
    data_status TEXT,
    source_name TEXT,
    source_url TEXT
  );

  CREATE TABLE hiring_checks (
    id INTEGER PRIMARY KEY,
    slug TEXT NOT NULL REFERENCES businesses(slug),
    checked TEXT NOT NULL,
    signal TEXT,
    confidence REAL,
    evidence_url TEXT,
    source TEXT
  );

  CREATE INDEX idx_checks_slug ON hiring_checks(slug, checked);
  CREATE INDEX idx_business_status ON businesses(hiring_status);
  CREATE INDEX idx_business_town ON businesses(town);
`);

function townFor(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim().replace(/^near\s+/i, "")).filter(Boolean);
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) return parts[parts.length - 3];
  if (parts.length >= 2) {
    const town = parts[parts.length - 2].replace(/\b(PA|NJ)\b.*$/, "").trim();
    if (town && !/^\d/.test(town)) return town;
  }
  return null;
}

const companies = JSON.parse(fs.readFileSync("companies.json", "utf8"));
const insertBusiness = db.prepare(`
  INSERT INTO businesses VALUES (
    :slug, :name, :category, :industry_group, :hiring_speed, :address, :address_approximate, :town,
    :latitude, :longitude, :website, :description, :hiring_status, :hiring_signal, :hiring_last_checked,
    :hiring_evidence_url, :hiring_note, :verification_note, :total_employees, :years_in_business,
    :start_date, :data_status, :source_name, :source_url
  )`);

db.exec("BEGIN");
for (const company of companies) {
  const industry = guide.INDUSTRY[company.category] || guide.DEFAULT_INDUSTRY;
  insertBusiness.run({
    slug: company.slug,
    name: company.name,
    category: company.category || null,
    industry_group: industry.group,
    hiring_speed: industry.speed,
    address: company.address || null,
    address_approximate: company.address_approximate ? 1 : 0,
    town: townFor(company),
    latitude: company.latitude,
    longitude: company.longitude,
    website: company.website || null,
    description: company.description || null,
    hiring_status: company.hiring_status || null,
    hiring_signal: company.hiring_signal || null,
    hiring_last_checked: company.hiring_last_checked || null,
    hiring_evidence_url: company.hiring_evidence_url || null,
    hiring_note: company.hiring_note || null,
    verification_note: company.verification_note || null,
    total_employees: company.total_employees ?? null,
    years_in_business: company.years_in_business ?? null,
    start_date: company.start_date || null,
    data_status: company.data_status || null,
    source_name: company.source_name || null,
    source_url: company.source_url || null
  });
}
db.exec("COMMIT");

const known = new Set(companies.map((company) => company.slug));
const insertCheck = db.prepare(
  "INSERT INTO hiring_checks (slug, checked, signal, confidence, evidence_url, source) VALUES (?, ?, ?, ?, ?, ?)"
);
let checks = 0;
const historyPath = path.join("data", "hiring-history.jsonl");
if (fs.existsSync(historyPath)) {
  db.exec("BEGIN");
  for (const line of fs.readFileSync(historyPath, "utf8").split("\n")) {
    if (!line.trim()) continue;
    const row = JSON.parse(line);
    if (!known.has(row.slug)) continue;
    insertCheck.run(row.slug, row.checked, row.signal || null, row.confidence ?? null, row.evidence_url || null, row.source || null);
    checks += 1;
  }
  db.exec("COMMIT");
}

const count = db.prepare("SELECT COUNT(*) AS n FROM businesses").get().n;
console.log(`Built ${DB_PATH}: ${count} businesses, ${checks} hiring checks`);
db.close();
