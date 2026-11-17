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
const changes = { placeholder: [], platformEvidence: [], offSiteEvidence: [], sharedSite: [] };

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

  company.hiring_status = rules.hiringStatus(company);
  company.hiring = company.hiring_status === "hiring";
}

const counts = {};
for (const company of companies) counts[company.hiring_status] = (counts[company.hiring_status] || 0) + 1;

console.log(`Placeholder records marked unverified (${changes.placeholder.length}):`, changes.placeholder.join("; "));
console.log(`Platform careers links removed (${changes.platformEvidence.length})`);
console.log(`Off-site evidence removed (${changes.offSiteEvidence.length}):`, changes.offSiteEvidence.join("; "));
console.log(`Shared-site careers pages (${changes.sharedSite.length})`);
console.log("Hiring status counts:", counts);

if (write) {
  fs.writeFileSync(INPUT, `${JSON.stringify(companies, null, 2)}\n`);
  console.log(`Wrote ${INPUT}`);
} else {
  console.log("Dry run. Re-run with --write to save.");
}
