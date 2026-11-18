const TINICUM_CENTER = [40.4825, -75.1069];
const RADIUS_MILES = 25;
const RADIUS_METERS = RADIUS_MILES * 1609.344;
const DIRECTORY_RENDER_LIMIT = 700;

const money = new Intl.NumberFormat("en-US");

async function getCompanies() {
  const response = await fetch(pathToRoot() + "companies.json");
  if (!response.ok) throw new Error("Unable to load companies.json");
  const companies = await response.json();
  return companies.filter((company) => distanceMiles(TINICUM_CENTER[0], TINICUM_CENTER[1], company.latitude, company.longitude) <= RADIUS_MILES);
}

function pathToRoot() {
  return window.location.pathname.includes("/company/") ? "../" : "";
}

function distanceMiles(lat1, lon1, lat2, lon2) {
  const toRad = (value) => (value * Math.PI) / 180;
  const earthMiles = 3958.8;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  return earthMiles * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function initials(name) {
  return String(name ?? "")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function detailHref(company) {
  return `${pathToRoot()}company/${encodeURIComponent(company.slug)}.html`;
}

function numberOrUnknown(value, suffix = "") {
  if (value === null || value === undefined || value === "") return "Unknown";
  return `${money.format(value)}${suffix}`;
}

function websiteHref(company) {
  return safeUrl(company.website) || safeUrl(company.source_url) || "#";
}

function hasUsableWebsite(company) {
  return Boolean(company.website && !company.website.includes("example.com"));
}

function websiteDiscoveryQuery(company) {
  return `${company.name} ${townFor(company)} ${company.category} official website`;
}

function websiteDiscoveryHref(company) {
  return `https://www.google.com/search?q=${encodeURIComponent(websiteDiscoveryQuery(company))}`;
}

function websiteAction(company, className = "button ghost") {
  const site = hasUsableWebsite(company) ? safeUrl(company.website) : "";
  if (site) return `<a class="${esc(className)}" href="${esc(site)}">Website</a>`;
  return `<a class="${esc(className)}" href="${esc(websiteDiscoveryHref(company))}">Find Website</a>`;
}

function directoryHref(filters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value !== null && value !== undefined && value !== "") params.set(key, value);
  });
  const query = params.toString();
  return `${pathToRoot()}directory.html${query ? `?${query}` : ""}`;
}

function townFor(company) {
  const parts = (company.address || "").split(",").map((part) => part.trim().replace(/^near\s+/i, "")).filter(Boolean);
  if (parts.length >= 4 && /^(PA|NJ)$/i.test(parts[parts.length - 2])) return parts[parts.length - 3];
  if (parts.length >= 2) return parts[parts.length - 2].replace(/\bPA\b|\bNJ\b/g, "").trim();
  return "Town needs audit";
}

function statusOf(company) {
  if (company.hiring_status && STATUS[company.hiring_status]) return company.hiring_status;
  if (company.hiring) return "hiring";
  return company.website ? "not_checked" : "no_online_info";
}

function industryOf(company) {
  return INDUSTRY[company.category] || DEFAULT_INDUSTRY;
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);
}

// Links built from listing data may only point at http(s) pages. Anything else
// (javascript:, data:, a bare host, an e-mail address) returns "" and gets no link.
function safeUrl(value) {
  const text = String(value ?? "").trim();
  if (!/^https?:\/\/\S+$/i.test(text)) return "";
  try {
    const { protocol } = new URL(text);
    return protocol === "http:" || protocol === "https:" ? text : "";
  } catch {
    return "";
  }
}

function searchText(company) {
  if (!company._search) {
    const info = industryOf(company);
    company._search = [company.name, company.category, info.group, company.address, townFor(company), ...info.roles, ...info.skills]
      .join(" ")
      .toLowerCase();
  }
  return company._search;
}

function colorFor(company, mode) {
  if (mode === "speed") return SPEED[industryOf(company).speed].color;
  if (mode === "industry") return GROUP_COLORS[industryOf(company).group] || "#8a7d5f";
  return STATUS[statusOf(company)].color;
}

function markerIcon(company, mode = "status") {
  const color = colorFor(company, mode);
  const strong = statusOf(company) === "hiring" || company.established_employer;
  const size = strong ? 20 : 14;
  const ring = company.established_employer ? " dot-established" : company.established ? " dot-aged" : "";
  return L.divIcon({
    className: "t3-marker",
    html: `<span class="dot${strong ? " dot-hiring" : ""}${ring}" style="background:${color};width:${size}px;height:${size}px;"></span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -size / 2]
  });
}

function clusterIcon(cluster) {
  const children = cluster.getAllChildMarkers();
  const total = children.length;
  const hiring = children.filter((marker) => marker.options.hiringStatus === "hiring").length;
  const size = total < 10 ? 36 : total < 100 ? 44 : total < 1000 ? 54 : 64;
  const share = total ? Math.max(hiring ? 8 : 0, Math.round((hiring / total) * 360)) : 0;
  return L.divIcon({
    className: "t3-cluster",
    html: `<span class="cluster" style="width:${size}px;height:${size}px;background:conic-gradient(#1f7a3f ${share}deg, #d8d3c6 0deg);"><span class="cluster-inner">${money.format(total)}${hiring && total >= 10 ? `<small>${money.format(hiring)} hiring</small>` : ""}</span></span>`,
    iconSize: [size, size]
  });
}

function popupHtml(company) {
  const status = statusOf(company);
  const info = industryOf(company);
  const speed = SPEED[info.speed];
  const checked = company.hiring_last_checked ? ` (checked ${esc(company.hiring_last_checked)})` : "";
  const evidence = safeUrl(company.hiring_evidence_url) ? ` <a href="${esc(safeUrl(company.hiring_evidence_url))}" target="_blank" rel="noopener">See jobs page</a>` : "";
  const years = company.years_in_business ? `<div class="pop-guide"><b>${esc(company.years_in_business)} years</b> in business</div>` : "";
  const site = safeUrl(company.website)
    ? `<a href="${esc(safeUrl(company.website))}" target="_blank" rel="noopener">Website</a>`
    : `<a href="${esc(websiteDiscoveryHref(company))}" target="_blank" rel="noopener">Look them up</a>`;
  const directions = company.address
    ? ` · <a href="${esc(`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(company.address)}`)}" target="_blank" rel="noopener">Directions</a>`
    : "";
  return `
    <div class="pop">
      <strong class="pop-name">${esc(company.name)}</strong>
      <div class="pop-meta">${esc(company.category)} · ${esc(townFor(company))}</div>
      <div class="pop-status" style="--c:${esc(STATUS[status].color)}"><b>${esc(STATUS[status].label)}</b>${checked}.${evidence}</div>
      <div class="pop-note">${esc(company.hiring_note || STATUS[status].note)}</div>
      ${company.verification_note ? `<div class="pop-note warn">${esc(company.verification_note)}</div>` : ""}
      ${company.established_employer ? `<div class="pop-badge">Established local employer</div>` : ""}
      ${company.founded_label ? `<div class="pop-guide"><b>${esc(company.founded_label)}</b> <span class="pop-fine">(${esc(company.founded_note || "")})</span></div>` : years}
      ${company.hiring_track ? `<div class="pop-guide">${esc(company.hiring_track)}</div>` : ""}
      <div class="pop-guide"><b>Typical roles:</b> ${esc(info.roles.join(", "))}</div>
      <div class="pop-guide"><b>Skills that help:</b> ${esc(info.skills.join(", "))}</div>
      <div class="pop-guide"><b>${esc(speed.label)}</b>, ${esc(speed.detail)}. <span class="pop-fine">Typical for the industry, not this business.</span></div>
      ${company.phone ? `<div class="pop-guide"><a href="tel:${esc(String(company.phone).replace(/[^\d+]/g, ""))}"><b>Call ${esc(company.phone)}</b></a></div>` : ""}
      <div class="pop-links">${site} · <a href="${esc(detailHref(company))}">Details</a>${directions}</div>
    </div>`;
}

function setupMap(elementId, companies, options = {}) {
  const map = L.map(elementId, { scrollWheelZoom: options.scrollWheelZoom ?? false }).setView(TINICUM_CENTER, options.zoom ?? 10);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);

  L.circle(TINICUM_CENTER, {
    radius: RADIUS_METERS,
    color: "#2f6f43",
    fillColor: "#8fbd73",
    fillOpacity: 0.05,
    weight: 1.5,
    interactive: false
  }).addTo(map);

  const markers = window.L.markerClusterGroup
    ? L.markerClusterGroup({ showCoverageOnHover: false, maxClusterRadius: 48, chunkedLoading: true, iconCreateFunction: clusterIcon }).addTo(map)
    : L.layerGroup().addTo(map);

  const bySlug = new Map();
  function render(list, mode = "status") {
    markers.clearLayers();
    bySlug.clear();
    const layers = list.map((company) => {
      const marker = L.marker([company.latitude, company.longitude], {
        icon: markerIcon(company, mode),
        title: company.name,
        hiringStatus: statusOf(company)
      }).bindPopup(() => popupHtml(company), { maxWidth: 320 });
      bySlug.set(company.slug, marker);
      return marker;
    });
    if (markers.addLayers) markers.addLayers(layers);
    else layers.forEach((layer) => layer.addTo(markers));
  }

  function focus(slug) {
    const marker = bySlug.get(slug);
    if (!marker) return;
    if (markers.zoomToShowLayer) markers.zoomToShowLayer(marker, () => marker.openPopup());
    else {
      map.setView(marker.getLatLng(), 15);
      marker.openPopup();
    }
  }

  render(companies, options.colorMode);
  if (companies.length > 1) {
    const bounds = L.latLngBounds(companies.map((company) => [company.latitude, company.longitude]));
    bounds.extend(TINICUM_CENTER);
    map.fitBounds(bounds.pad(0.05));
  }

  return { map, markers, render, focus };
}

// ---- Home page: map explorer with search, filters and color modes ----
function legendHtml(mode, list) {
  if (mode === "speed") {
    return Object.values(SPEED)
      .map((speed) => `<span class="key"><i style="background:${speed.color}"></i>${speed.label} <em>${speed.detail}</em></span>`)
      .join("") + `<span class="key-fine">Typical for each industry, not a promise from any one business.</span>`;
  }
  if (mode === "industry") {
    return Object.entries(GROUP_COLORS).map(([group, color]) => `<span class="key"><i style="background:${color}"></i>${group}</span>`).join("");
  }
  const counts = {};
  for (const company of list) counts[statusOf(company)] = (counts[statusOf(company)] || 0) + 1;
  const established = list.filter((company) => company.established_employer).length;
  const ringKey = established ? `<span class="key" title="In business 10+ years (their website or PA registration), local (not a chain), and openings or a careers page seen in checks months apart."><i class="ring"></i>Established local employer <em>${money.format(established)}</em></span>` : "";
  return Object.entries(STATUS)
    .filter(([key]) => counts[key])
    .map(([key, info]) => `<span class="key" title="${esc(info.note)}"><i style="background:${info.color}"></i>${info.label} <em>${money.format(counts[key])}</em></span>`)
    .join("") + ringKey;
}

function initMapExplorer(companies, mapApi) {
  const form = document.querySelector("[data-map-filters]");
  if (!form) return;
  const get = (name) => form.querySelector(`[data-map='${name}']`);
  const groups = [...new Set(companies.map((company) => industryOf(company).group))].sort();
  get("group").innerHTML = `<option value="">All industries</option>` + groups.map((group) => `<option>${esc(group)}</option>`).join("");
  const towns = [...new Set(companies.map(townFor))].filter(Boolean).sort();
  get("town").innerHTML = `<option value="">All towns</option>` + towns.map((town) => `<option>${esc(town)}</option>`).join("");

  const params = new URLSearchParams(window.location.search);
  get("search").value = params.get("q") || "";
  if (params.get("group")) get("group").value = params.get("group");
  if (params.get("town")) get("town").value = params.get("town");
  if (params.get("color")) get("color").value = params.get("color");
  if (params.get("status")) get("status").value = params.get("status");
  if (params.get("miles")) get("miles").value = params.get("miles");
  if (params.get("from")) get("from").value = params.get("from");

  let timer;
  function apply() {
    const terms = get("search").value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const group = get("group").value;
    const town = get("town").value;
    const status = get("status").value;
    const speed = get("speed").value;
    const mode = get("color").value;
    const maxMiles = Number(get("miles").value) || 0;
    const [fromLat, fromLon] = get("from").value.split(",").map(Number);
    const list = companies.filter((company) => {
      if (group && industryOf(company).group !== group) return false;
      if (town && townFor(company) !== town) return false;
      if (status === "open" && !["hiring", "careers_page", "shared_site"].includes(statusOf(company))) return false;
      if (status === "established_employer" && !company.established_employer) return false;
      if (status === "established" && !company.established) return false;
      if (status && !["open", "established", "established_employer"].includes(status) && statusOf(company) !== status) return false;
      if (speed && industryOf(company).speed !== speed) return false;
      if (maxMiles && distanceMiles(fromLat, fromLon, company.latitude, company.longitude) > maxMiles) return false;
      const text = searchText(company);
      return terms.every((term) => text.includes(term));
    });
    mapApi.render(list, mode);
    if (list.length && list.length < companies.length) {
      mapApi.map.fitBounds(L.latLngBounds(list.map((company) => [company.latitude, company.longitude])).pad(0.15), { maxZoom: 14 });
    }
    document.querySelector("[data-map-count]").textContent = `${money.format(list.length)} of ${money.format(companies.length)} businesses`;
    document.querySelector("[data-map-legend]").innerHTML = legendHtml(mode, list);
    const next = new URLSearchParams();
    if (get("search").value.trim()) next.set("q", get("search").value.trim());
    if (group) next.set("group", group);
    if (town) next.set("town", town);
    if (status) next.set("status", status);
    if (mode !== "status") next.set("color", mode);
    if (maxMiles) {
      next.set("miles", String(maxMiles));
      next.set("from", get("from").value);
    }
    history.replaceState(null, "", `${window.location.pathname}${next.toString() ? `?${next}` : ""}`);
  }
  form.addEventListener("submit", (event) => event.preventDefault());
  form.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(apply, 180);
  });
  apply();
}

function companyCard(company) {
  // Every value from a listing is escaped before it goes into the page: names and
  // descriptions come from public sources (OpenStreetMap, licence files) that anyone can edit.
  const score = company.best_places_score ? `${esc(company.best_places_score)}/10` : "Not scored";
  const onboarding = company.onboarding_note ? "Strong onboarding" : "Onboarding not listed";
  const status = company.data_status ? ` • ${esc(String(company.data_status).replaceAll("-", " "))}` : "";
  const hiringSignal = company.hiring_signal ? ` • hiring audit: ${esc(String(company.hiring_signal).replaceAll("_", " "))}` : "";
  const sourceUrl = safeUrl(company.source_url);
  return `
    <article class="company-card" data-slug="${esc(company.slug)}">
      <div class="card-top">
        <div class="logo" aria-hidden="true">${esc(initials(company.name))}</div>
        <div>
          <h3>${esc(company.name)}</h3>
          <p class="meta">${esc(company.category)} • ${esc(company.address)}</p>
        </div>
      </div>
      <span class="badge ${statusOf(company) === "hiring" ? "" : "muted"}" title="${esc(STATUS[statusOf(company)].note)}">${esc(STATUS[statusOf(company)].label)}</span>
      <p>${esc(company.description)}</p>
      <p class="meta">${esc(numberOrUnknown(company.total_employees, " employees"))} • ${esc(numberOrUnknown(company.years_in_business, " years in business"))} • Best Places: ${score} • ${onboarding}${status}${hiringSignal}</p>
      <div class="card-actions">
        <a class="button secondary" href="${esc(detailHref(company))}">Company Detail</a>
        <a class="button ghost" href="${esc(`${pathToRoot()}index.html?company=${encodeURIComponent(company.slug)}`)}">View on Map</a>
        ${websiteAction(company)}
        ${!hasUsableWebsite(company) && sourceUrl ? `<a class="button ghost" href="${esc(sourceUrl)}">Source</a>` : ""}
      </div>
    </article>
  `;
}

function updateStats(companies) {
  const statCompanies = document.querySelector("[data-stat='companies']");
  const statHiring = document.querySelector("[data-stat='hiring']");
  const statEmployees = document.querySelector("[data-stat='employees']");
  if (statCompanies) statCompanies.textContent = money.format(companies.length);
  if (statHiring) statHiring.textContent = money.format(companies.filter((company) => statusOf(company) === "hiring").length);
  const statChecked = document.querySelector("[data-stat='checked']");
  if (statChecked) {
    const latest = companies.reduce((max, company) => (company.hiring_last_checked > max ? company.hiring_last_checked : max), "");
    statChecked.textContent = latest
      ? new Date(`${latest}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
      : "Not yet";
  }
  if (statEmployees) statEmployees.textContent = money.format(companies.reduce((sum, company) => sum + (company.total_employees || 0), 0));
}

function renderFeatured(companies) {
  const target = document.querySelector("[data-featured-companies]");
  if (!target) return;
  const near = (company) => distanceMiles(TINICUM_CENTER[0], TINICUM_CENTER[1], company.latitude, company.longitude);
  // Affinity for established local employers, then other businesses hiring now; nearest first.
  const established = companies.filter((company) => company.established_employer).sort((a, b) => near(a) - near(b));
  const hiring = companies.filter((company) => statusOf(company) === "hiring" && !company.established_employer).sort((a, b) => near(a) - near(b));
  target.innerHTML = [...established.slice(0, 6), ...hiring].slice(0, 9).map(companyCard).join("");
}

function initHome(companies) {
  updateStats(companies);
  renderFeatured(companies);
  const mapElement = document.getElementById("map");
  if (!mapElement) return;
  const mapApi = setupMap("map", companies, { zoom: 10, scrollWheelZoom: true });
  initMapExplorer(companies, mapApi);
  const slug = new URLSearchParams(window.location.search).get("company");
  if (slug) {
    const match = companies.find((company) => company.slug === slug || (company.previous_slugs || []).includes(slug));
    if (match) mapApi.focus(match.slug);
  }
}

function initDirectory(companies) {
  const results = document.querySelector("[data-directory-results]");
  if (!results) return;

  const categorySelect = document.querySelector("[data-filter='category']");
  const searchInput = document.querySelector("[data-filter='search']");
  const hiringInput = document.querySelector("[data-filter='hiring']");
  const onboardingInput = document.querySelector("[data-filter='onboarding']");
  const websiteSelect = document.querySelector("[data-filter='website']");
  const signalSelect = document.querySelector("[data-filter='signal']");
  const sortSelect = document.querySelector("[data-sort]");
  const categories = [...new Set(companies.map((company) => company.category))].sort();
  categorySelect.innerHTML = `<option value="">All categories</option>${categories.map((category) => `<option value="${esc(category)}">${esc(category)}</option>`).join("")}`;
  const townSelect = document.querySelector("[data-filter='town']");
  if (townSelect) {
    const towns = [...new Set(companies.map(townFor))].filter(Boolean).sort();
    townSelect.innerHTML = `<option value="">All towns</option>${towns.map((town) => `<option value="${esc(town)}">${esc(town)}</option>`).join("")}`;
  }

  const params = new URLSearchParams(window.location.search);
  searchInput.value = params.get("search") || "";
  setSelectValue(categorySelect, params.get("category"));
  if (townSelect) setSelectValue(townSelect, params.get("town"));
  setSelectValue(signalSelect, params.get("signal"));
  setSelectValue(websiteSelect, params.get("website"));
  setSelectValue(sortSelect, params.get("sort"));
  hiringInput.checked = truthyParam(params.get("hiring"));
  onboardingInput.checked = truthyParam(params.get("onboarding"));

  const controls = document.querySelectorAll("[data-filter], [data-sort]");
  const render = (options = {}) => {
    const query = searchInput.value.trim().toLowerCase();
    const category = categorySelect.value;
    const town = townSelect ? townSelect.value : "";
    const hiringOnly = hiringInput.checked;
    const onboardingOnly = onboardingInput.checked;
    const websiteMode = websiteSelect?.value || "";
    const signal = signalSelect?.value || "";
    const sort = sortSelect.value;

    let filtered = companies.filter((company) => {
      const haystack = searchText(company);
      const companySignal = company.hiring_signal || "not_audited";
      return (
        (!query || haystack.includes(query)) &&
        (!category || company.category === category) &&
        (!town || townFor(company) === town) &&
        signalMatches(companySignal, signal) &&
        (!websiteMode || (websiteMode === "with" ? hasUsableWebsite(company) : !hasUsableWebsite(company))) &&
        (!hiringOnly || company.hiring) &&
        (!onboardingOnly || company.onboarding_note)
      );
    });

    filtered = filtered.sort((a, b) => {
      if (sort === "employees") return (b.total_employees ?? -1) - (a.total_employees ?? -1);
      if (sort === "oldest") return (b.years_in_business ?? -1) - (a.years_in_business ?? -1);
      if (sort === "newest") return (a.years_in_business ?? 9999) - (b.years_in_business ?? 9999);
      if (sort === "score") return (b.best_places_score ?? -1) - (a.best_places_score ?? -1);
      return a.name.localeCompare(b.name);
    });

    const visible = filtered.slice(0, DIRECTORY_RENDER_LIMIT);
    document.querySelector("[data-result-count]").textContent = money.format(filtered.length);
    const shown = document.querySelector("[data-result-shown]");
    if (shown) shown.textContent = filtered.length > visible.length ? `Showing ${money.format(visible.length)}. Use search or filters to narrow the full set.` : "";
    results.innerHTML = visible.length ? visible.map(companyCard).join("") : `<p class="panel">No companies match those filters.</p>`;
    if (options.updateUrl !== false) {
      updateDirectoryUrl({ search: searchInput.value.trim(), category, town, signal, website: websiteMode, sort, hiring: hiringOnly, onboarding: onboardingOnly });
    }
  };

  controls.forEach((control) => control.addEventListener("input", render));
  render({ updateUrl: false });
}

function truthyParam(value) {
  return /^(1|true|yes|y)$/i.test(value || "");
}

function setSelectValue(select, value) {
  if (!select || value === null) return;
  if ([...select.options].some((option) => option.value === value)) select.value = value;
}

function signalMatches(companySignal, filterSignal) {
  if (!filterSignal) return true;
  if (filterSignal === "positive") return ["hiring_likely", "hiring_possible", "careers_page_found"].includes(companySignal);
  if (filterSignal === "audited") return companySignal !== "not_audited";
  return companySignal === filterSignal;
}

function updateDirectoryUrl(state) {
  const params = new URLSearchParams();
  if (state.search) params.set("search", state.search);
  if (state.category) params.set("category", state.category);
  if (state.town) params.set("town", state.town);
  if (state.signal) params.set("signal", state.signal);
  if (state.website) params.set("website", state.website);
  if (state.sort && state.sort !== "alpha") params.set("sort", state.sort);
  if (state.hiring) params.set("hiring", "1");
  if (state.onboarding) params.set("onboarding", "1");
  const query = params.toString();
  const nextUrl = `${window.location.pathname}${query ? `?${query}` : ""}`;
  window.history.replaceState(null, "", nextUrl);
}

function topCounts(items, keyFn, limit = 10) {
  const counts = items.reduce((acc, item) => {
    const key = keyFn(item) || "Unknown";
    acc.set(key, (acc.get(key) || 0) + 1);
    return acc;
  }, new Map());
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit);
}

function townCoverageRows(companies) {
  const rows = new Map();
  companies.forEach((company) => {
    const town = townFor(company);
    if (!rows.has(town)) {
      rows.set(town, {
        town,
        total: 0,
        websites: 0,
        audited: 0,
        positive: 0,
        unknown: 0,
        needsWebsite: 0,
        notAudited: 0
      });
    }
    const row = rows.get(town);
    const hasWebsite = hasUsableWebsite(company);
    const signal = company.hiring_signal || "not_audited";
    row.total += 1;
    if (hasWebsite) row.websites += 1;
    else row.needsWebsite += 1;
    if (company.hiring_signal) row.audited += 1;
    if (["hiring_likely", "hiring_possible", "careers_page_found"].includes(signal)) row.positive += 1;
    if (signal === "unknown") row.unknown += 1;
    if (signal === "not_audited") row.notAudited += 1;
  });
  return [...rows.values()].sort((a, b) => b.needsWebsite - a.needsWebsite || b.total - a.total || a.town.localeCompare(b.town));
}

function pct(value, total) {
  if (!total) return "0%";
  return `${Math.round((value / total) * 100)}%`;
}

function renderTownCoverage(companies) {
  const target = document.querySelector("[data-quality-town-coverage]");
  if (!target) return;
  const rows = townCoverageRows(companies).slice(0, 30);
  target.innerHTML = `
    <div class="table-wrap">
      <table class="coverage-table">
        <thead>
          <tr>
            <th>Town</th>
            <th class="number-cell">Companies</th>
            <th class="number-cell">Websites</th>
            <th class="number-cell">Website %</th>
            <th class="number-cell">Audited</th>
            <th class="number-cell">Audit %</th>
            <th class="number-cell">Positive</th>
            <th class="number-cell">Unknown</th>
            <th class="number-cell">Needs site</th>
          </tr>
        </thead>
        <tbody>
          ${rows
            .map(
              (row) => `
                <tr>
                  <td><a href="${esc(directoryHref({ town: row.town }))}">${esc(row.town)}</a></td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town }))}">${money.format(row.total)}</a></td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town, website: "with" }))}">${money.format(row.websites)}</a></td>
                  <td class="number-cell">${pct(row.websites, row.total)}</td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town, signal: "audited" }))}">${money.format(row.audited)}</a></td>
                  <td class="number-cell">${pct(row.audited, row.websites)}</td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town, signal: "positive" }))}">${money.format(row.positive)}</a></td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town, signal: "unknown" }))}">${money.format(row.unknown)}</a></td>
                  <td class="number-cell"><a href="${esc(directoryHref({ town: row.town, website: "without" }))}">${money.format(row.needsWebsite)}</a></td>
                </tr>
              `
            )
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function initDataQuality(companies) {
  const stats = document.querySelector("[data-quality-stats]");
  if (!stats) return;

  const usableWebsites = companies.filter(hasUsableWebsite);
  const audited = companies.filter((company) => company.hiring_signal);
  const positive = companies.filter((company) => ["hiring_likely", "hiring_possible", "careers_page_found"].includes(company.hiring_signal));
  const unknown = companies.filter((company) => company.hiring_signal === "unknown");
  const needsWebsite = companies.filter((company) => !hasUsableWebsite(company));

  stats.innerHTML = [
    ["Companies", companies.length],
    ["Usable websites", usableWebsites.length],
    ["Hiring audited", audited.length],
    ["Positive signals", positive.length],
    ["Unknown signals", unknown.length],
    ["Needs website", needsWebsite.length]
  ]
    .map(([label, value]) => `<div class="stat"><strong>${money.format(value)}</strong><span>${label}</span></div>`)
    .join("");
  renderTownCoverage(companies);

  const websiteQueue = document.querySelector("[data-quality-website-queue]");
  const unknownQueue = document.querySelector("[data-quality-unknown-queue]");
  const positiveQueue = document.querySelector("[data-quality-positive-queue]");
  const townSummary = document.querySelector("[data-quality-town-summary]");

  if (websiteQueue) {
    websiteQueue.innerHTML = needsWebsite.slice(0, 24).map(companyCard).join("");
  }
  if (unknownQueue) {
    unknownQueue.innerHTML = unknown.slice(0, 24).map(companyCard).join("");
  }
  if (positiveQueue) {
    positiveQueue.innerHTML = positive
      .sort((a, b) => (b.hiring_confidence || 0) - (a.hiring_confidence || 0))
      .slice(0, 24)
      .map(companyCard)
      .join("");
  }
  if (townSummary) {
    townSummary.innerHTML = topCounts(needsWebsite, townFor, 18)
      .map(([town, count]) => `<a class="fact" href="${esc(directoryHref({ town, website: "without" }))}"><strong>${money.format(count)}</strong><span>${esc(town)}</span></a>`)
      .join("");
  }
}

function initHiringAudit(companies) {
  const results = document.querySelector("[data-audit-results]");
  if (!results) return;

  const townSelect = document.querySelector("[data-audit-filter='town']");
  const towns = [...new Set(companies.map(townFor))].filter(Boolean).sort();
  townSelect.innerHTML = `<option value="">All towns</option>${towns.map((town) => `<option value="${esc(town)}">${esc(town)}</option>`).join("")}`;

  const stats = document.querySelector("[data-audit-stats]");
  const counts = companies.reduce((acc, company) => {
    const signal = company.hiring_signal || "not_audited";
    acc[signal] = (acc[signal] || 0) + 1;
    return acc;
  }, {});
  stats.innerHTML = ["hiring_likely", "hiring_possible", "careers_page_found", "unknown", "not_audited"]
    .map((signal) => `<div class="stat"><strong>${money.format(counts[signal] || 0)}</strong><span>${signal.replaceAll("_", " ")}</span></div>`)
    .join("");

  const controls = document.querySelectorAll("[data-audit-filter], [data-audit-sort]");
  const render = () => {
    const query = document.querySelector("[data-audit-filter='search']").value.trim().toLowerCase();
    const signal = document.querySelector("[data-audit-filter='signal']").value;
    const town = townSelect.value;
    const sort = document.querySelector("[data-audit-sort]").value;
    let filtered = companies.filter((company) => {
      const companySignal = company.hiring_signal || "not_audited";
      const haystack = `${company.name} ${company.category} ${company.address} ${townFor(company)}`.toLowerCase();
      return (!query || haystack.includes(query)) && (!signal || companySignal === signal) && (!town || townFor(company) === town);
    });

    filtered = filtered.sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name);
      if (sort === "recent") return String(b.hiring_last_checked || "").localeCompare(String(a.hiring_last_checked || ""));
      return (b.hiring_confidence || 0) - (a.hiring_confidence || 0);
    });

    results.innerHTML = filtered.slice(0, DIRECTORY_RENDER_LIMIT).map(companyCard).join("") || `<p class="panel">No audit records match those filters.</p>`;
  };

  controls.forEach((control) => control.addEventListener("input", render));
  render();
}

function initDetail(companies) {
  const detail = document.querySelector("[data-company-detail]");
  if (!detail) return;
  const slug = document.body.dataset.companySlug || new URLSearchParams(window.location.search).get("slug");
  const company = companies.find((entry) => entry.slug === slug || (entry.previous_slugs || []).includes(slug));
  if (company && company.slug !== slug) {
    window.location.replace(`${encodeURIComponent(company.slug)}.html`);
    return;
  }
  if (!company) {
    detail.innerHTML = `<section class="panel"><h1>Company not found</h1><p class="lead">This company is not listed in the current directory.</p></section>`;
    return;
  }

  document.title = `${company.name} | Bucks County Business & Jobs`;
  document.querySelector("[data-company-name]").textContent = company.name;
  document.querySelector("[data-company-description]").textContent = company.description;
  detail.innerHTML = `
    <section class="panel">
      <div class="card-top">
        <div class="logo" aria-hidden="true">${esc(initials(company.name))}</div>
        <div>
          <span class="badge ${statusOf(company) === "hiring" ? "" : "muted"}" title="${esc(STATUS[statusOf(company)].note)}">${esc(STATUS[statusOf(company)].label)}</span>
          <h1>${esc(company.name)}</h1>
          <p class="meta">${esc(company.category)} • ${esc(company.address)}</p>
        </div>
      </div>
      <p class="lead" style="margin-top:18px;">${esc(company.hiring_note || STATUS[statusOf(company)].note)}</p>
      ${company.verification_note ? `<p class="pop-note warn">${esc(company.verification_note)}</p>` : ""}
      <p><b>Typical roles:</b> ${esc(industryOf(company).roles.join(", "))}<br><b>Skills that help:</b> ${esc(industryOf(company).skills.join(", "))}<br><b>${esc(SPEED[industryOf(company).speed].label)}</b>, ${esc(SPEED[industryOf(company).speed].detail)} <span class="meta">(typical for the industry)</span></p>
      <div class="facts">
        <div class="fact"><strong>${esc(numberOrUnknown(company.total_employees))}</strong><span>Employees</span></div>
        <div class="fact"><strong>${esc(numberOrUnknown(company.years_in_business))}</strong><span>Years in business</span></div>
        <div class="fact"><strong>${company.best_places_score ? `${esc(company.best_places_score)}/10` : "Not scored"}</strong><span>Best Places score</span></div>
        <div class="fact"><strong>${esc(company.onboarding_note || "Not listed")}</strong><span>Onboarding</span></div>
        <div class="fact"><strong>${esc(company.data_status || "seeded")}</strong><span>Data status</span></div>
        <div class="fact"><strong>${esc(company.source_name || "Manual entry")}</strong><span>Source</span></div>
        <div class="fact"><strong>${esc(company.hiring_signal ? String(company.hiring_signal).replaceAll("_", " ") : "Not audited")}</strong><span>Hiring audit</span></div>
        <div class="fact"><strong>${esc(company.hiring_last_checked || "Not checked")}</strong><span>Hiring checked</span></div>
      </div>
      <div class="actions" style="margin-top:20px;">
        ${websiteAction(company, "button")}
        <a class="button secondary" href="${esc(`../index.html?company=${encodeURIComponent(company.slug)}`)}">View on Map</a>
        ${safeUrl(company.hiring_evidence_url) ? `<a class="button ghost" href="${esc(safeUrl(company.hiring_evidence_url))}">Hiring Evidence</a>` : ""}
        ${safeUrl(company.source_url) ? `<a class="button ghost" href="${esc(safeUrl(company.source_url))}">Source</a>` : ""}
      </div>
    </section>
  `;
  setupMap("mini-map", [company], { zoom: 13, scrollWheelZoom: false });
}

document.addEventListener("DOMContentLoaded", async () => {
  try {
    const companies = await getCompanies();
    initHome(companies);
    initDirectory(companies);
    initHiringAudit(companies);
    initDataQuality(companies);
    initDetail(companies);
  } catch (error) {
    console.error(error);
  }
});
