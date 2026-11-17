// Download two public-domain PA datasets from data.pa.gov for nearby counties:
//   registry  - "Registered Businesses in PA Current by County" (Dept. of State, xvd7-5r2c):
//               legal name, entity type, registration date, city, ZIP, registered address.
//   salestax  - "Sales, Use & Hotel Occupancy Tax Licenses" (Revenue, ugeq-ckxd):
//               legal name, storefront (trade) name, physical sales location.
//
// Officer names are never requested. Street addresses are used only locally for matching:
// output goes to data/cache/ (gitignored) and is never published. Re-run monthly.
//
//   node tools/fetch-pa-registry.js [--counties Bucks,Lehigh,Northampton,Montgomery] [--only registry|salestax]

const fs = require("fs");
const path = require("path");

const DATASETS = {
  registry: {
    url: "https://data.pa.gov/resource/xvd7-5r2c.json",
    fields: ["filing_number", "business_name", "typeofbusinessregistration", "creationdate", "address_line1", "city", "zip", "shortcountyname"],
    county: "shortcountyname",
    order: "filing_number"
  },
  salestax: {
    url: "https://data.pa.gov/resource/ugeq-ckxd.json",
    fields: ["account", "legal_name", "trade_name", "street_address", "city", "postal_code", "county", "license_type", "georeferenced_latitude_longitude_points"],
    county: "county",
    order: "account"
  }
};
const PAGE = 50000;
const PAUSE_MS = 1500;

const arg = process.argv.indexOf("--counties");
const counties = arg > -1 ? process.argv[arg + 1].split(",") : ["Bucks", "Lehigh", "Northampton", "Montgomery"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function fetchPage(dataset, county, offset) {
  const { url, fields, order } = DATASETS[dataset];
  const params = new URLSearchParams({
    $select: fields.join(","),
    $group: fields.join(","),
    $where: `upper(${DATASETS[dataset].county})='${county.toUpperCase().replace(/'/g, "''")}'`,
    $order: order,
    $limit: String(PAGE),
    $offset: String(offset)
  });
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    const response = await fetch(`${url}?${params}`, { headers: { "user-agent": "bucks-county-business-jobs/1.0 (+https://github.com/techmore/bucks-county-business-jobs)" } });
    if (response.ok) return response.json();
    console.warn(`  ${county} offset ${offset}: HTTP ${response.status}, retrying`);
    await sleep(PAUSE_MS * 2 ** attempt);
  }
  throw new Error(`Failed to fetch ${county} at offset ${offset}`);
}

(async () => {
  const outDir = path.join("data", "cache");
  fs.mkdirSync(outDir, { recursive: true });
  const only = process.argv.indexOf("--only") > -1 ? process.argv[process.argv.indexOf("--only") + 1] : null;
  for (const dataset of Object.keys(DATASETS).filter((name) => !only || name === only))
  for (const county of counties) {
    const rows = [];
    for (let offset = 0; ; offset += PAGE) {
      const page = await fetchPage(dataset, county, offset);
      rows.push(...page);
      process.stdout.write(`  ${county}: ${rows.length}\n`);
      if (page.length < PAGE) break;
      await sleep(PAUSE_MS);
    }
    const file = path.join(outDir, `pa-${dataset}-${county.toLowerCase()}.json`);
    fs.writeFileSync(file, JSON.stringify(rows));
    console.log(`Wrote ${file} (${rows.length} rows)`);
    await sleep(PAUSE_MS);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
