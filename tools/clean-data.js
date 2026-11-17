// Apply the transparency rules in tools/hiring-rules.js to companies.json.
// Safe to re-run. Prints what changed.
//
//   node tools/clean-data.js            # dry run
//   node tools/clean-data.js --write    # update companies.json

const fs = require("fs");
const rules = require("./hiring-rules");

const INPUT = "companies.json";
const write = process.argv.includes("--write");
const companies = JSON.parse(fs.readFileSync(INPUT, "utf8"));
const changes = { placeholder: [], platformEvidence: [], offSiteEvidence: [], sharedSite: [], descriptions: 0 };

function townOf(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim()).filter(Boolean);
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

  company.hiring_status = rules.hiringStatus(company);
  company.hiring = company.hiring_status === "hiring";
}

const counts = {};
for (const company of companies) counts[company.hiring_status] = (counts[company.hiring_status] || 0) + 1;

console.log(`Placeholder records marked unverified (${changes.placeholder.length}):`, changes.placeholder.join("; "));
console.log(`Platform careers links removed (${changes.platformEvidence.length})`);
console.log(`Off-site evidence removed (${changes.offSiteEvidence.length}):`, changes.offSiteEvidence.join("; "));
console.log(`Shared-site careers pages (${changes.sharedSite.length})`);
console.log(`Descriptions rewritten: ${changes.descriptions}`);
console.log("Hiring status counts:", counts);

if (write) {
  fs.writeFileSync(INPUT, `${JSON.stringify(companies, null, 2)}\n`);
  console.log(`Wrote ${INPUT}`);
} else {
  console.log("Dry run. Re-run with --write to save.");
}
