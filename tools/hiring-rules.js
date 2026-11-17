// Shared rules for turning raw website-audit results into an honest hiring status.
// Used by tools/audit-hiring.js (new audits) and tools/clean-data.js (existing data).
//
// A business without a website, or with only a Facebook page, is still a real business.
// These rules only decide what we can honestly say about hiring from what we found online.

// Social and listing sites. A business page here is a real web presence, but the
// site's own "careers" links belong to the platform (e.g. facebook.com/careers -> Meta jobs).
const PLATFORM_HOSTS = [
  "facebook.com", "fb.com", "instagram.com", "linkedin.com", "twitter.com", "x.com",
  "yelp.com", "google.com", "goo.gl", "business.site", "linktr.ee", "tiktok.com",
  "nextdoor.com", "tripadvisor.com", "squarespace.com", "wixsite.com", "godaddysites.com"
];

// Platforms that themselves employ people; a link to them is never a local business's opening.
const PLATFORM_CAREER_HOSTS = ["metacareers.com", "careers.google.com", "careers.linkedin.com", "jobs.yelp.com"];

// Applicant-tracking systems that host real openings for many employers.
const ATS_HOSTS = [
  "myworkdayjobs.com", "applicantpro.com", "governmentjobs.com", "icims.com", "greenhouse.io",
  "lever.co", "paylocity.com", "ultipro.com", "ukg.com", "adp.com", "jobvite.com",
  "smartrecruiters.com", "applytojob.com", "bamboohr.com", "taleo.net", "brassring.com",
  "paycomonline.net", "workable.com", "recruitingbypaycor.com", "hrmdirect.com", "schoolspring.com",
  "applitrack.com", "frontlineeducation.com", "jazzhr.com", "breezy.hr", "rippling.com", "gusto.com",
  "harri.com", "hirebridge.com", "careerplug.com", "dayforcehcm.com", "oraclecloud.com", "successfactors.com"
];

// Sites shared by many independent businesses (e.g. shops inside Peddler's Village).
// A careers page there belongs to the host organization, not to each shop.
const SHARED_SITES = {
  "peddlersvillage.com": {
    owner: /peddler'?s village|golden plough|cock ?'?n ?bull/i,
    label: "Peddler's Village"
  }
};

const POSITIVE_SIGNALS = ["hiring_likely", "hiring_possible", "careers_page_found"];

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function matchesHost(host, list) {
  return list.some((entry) => host === entry || host.endsWith(`.${entry}`));
}

function siteRoot(host) {
  const parts = host.split(".");
  return parts.slice(-2).join(".");
}

function isPlatformSite(url) {
  return matchesHost(hostOf(url), PLATFORM_HOSTS);
}

function isPlaceholderSite(url) {
  return /(^|\.)example\.(com|org|net)$/.test(hostOf(url));
}

function sharedSiteFor(company) {
  const host = hostOf(company.website || "");
  const shared = Object.entries(SHARED_SITES).find(([site]) => host === site || host.endsWith(`.${site}`));
  if (!shared) return null;
  const [, info] = shared;
  if (info.owner.test(company.name || "")) return null; // the host organization itself
  return info;
}

// Is this evidence URL something we can attribute to this business?
function evidenceBelongsTo(evidenceUrl, websiteUrl) {
  const evidence = hostOf(evidenceUrl);
  const website = hostOf(websiteUrl);
  if (!evidence) return false;
  if (matchesHost(evidence, PLATFORM_CAREER_HOSTS)) return false;
  if (website && siteRoot(evidence) === siteRoot(website)) {
    if (!isPlatformSite(websiteUrl)) return true;
    // On a platform (e.g. Facebook), only the business's own page counts, not the platform's careers pages.
    const pagePath = new URL(websiteUrl).pathname.replace(/\/+$/, "");
    return pagePath.length > 1 && new URL(evidenceUrl).pathname.startsWith(pagePath);
  }
  if (matchesHost(evidence, ATS_HOSTS)) return true;
  // The audit only follows links on the business's own site, so an off-site result came from
  // that site redirecting (e.g. a dealer site -> its group's jobs site). That's still theirs,
  // unless the "website" is really a platform page like Facebook.
  if (website && isPlatformSite(websiteUrl)) return false;
  return !isPlatformSite(evidenceUrl);
}

// Final, honest status for display.
//   hiring          - openings seen on their own site or job system
//   careers_page    - has a careers page; current openings not confirmed
//   shared_site     - careers page belongs to a host org (e.g. Peddler's Village); ask the business
//   no_online_info  - checked, or no website: no hiring info online. Call or stop in.
//   not_checked     - has a website we haven't checked yet
function hiringStatus(company) {
  if (company.data_status === "unverified") return "no_online_info";
  if (sharedSiteFor(company) && POSITIVE_SIGNALS.includes(company.hiring_signal)) return "shared_site";
  if (company.hiring_signal === "hiring_likely" || company.hiring_signal === "hiring_possible") return "hiring";
  if (company.hiring_signal === "careers_page_found") return "careers_page";
  if (company.data_status === "anchor-employer") return "careers_page";
  if (company.hiring_signal) return "no_online_info";
  const site = company.website || "";
  if (!site || isPlaceholderSite(site)) return "no_online_info";
  return "not_checked";
}

module.exports = {
  PLATFORM_HOSTS,
  ATS_HOSTS,
  POSITIVE_SIGNALS,
  hostOf,
  isPlatformSite,
  isPlaceholderSite,
  sharedSiteFor,
  evidenceBelongsTo,
  hiringStatus
};
