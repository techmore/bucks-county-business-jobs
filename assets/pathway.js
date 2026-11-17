// Find Work Near Me: ZIP -> ranked list of nearby businesses.
// Ranking favors hiring evidence and established local employers, then tag match, then distance.
// The "profile" (ZIP, picks, saved places, recent searches) lives only in this browser (localStorage).
(function () {
  const PROFILE_KEY = "bcbj-profile-v1";
  const PAGE_SIZE = 30;
  const EVIDENCE = { hiring: 40, careers_page: 25, shared_site: 12, not_checked: 4, no_online_info: 0 };
  const fmt = new Intl.NumberFormat("en-US");
  const $ = (selector) => document.querySelector(selector);
  const field = (name) => document.querySelector(`[data-path='${name}']`);

  const esc = (value) =>
    String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]);

  function loadProfile() {
    try {
      return JSON.parse(localStorage.getItem(PROFILE_KEY)) || {};
    } catch {
      return {};
    }
  }
  function saveProfile(profile) {
    try {
      localStorage.setItem(PROFILE_KEY, JSON.stringify(profile));
    } catch {
      /* private mode or storage blocked: the page still works, it just won't remember */
    }
  }

  function miles(lat1, lon1, lat2, lon2) {
    const toRad = (v) => (v * Math.PI) / 180;
    const h = Math.sin(toRad(lat2 - lat1) / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(toRad(lon2 - lon1) / 2) ** 2;
    return 3958.8 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
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
  const zipOf = (company) => ((company.address || "").match(/\b(\d{5})(?:-\d{4})?\s*$/) || [])[1] || null;
  const industryOf = (company) => window.INDUSTRY[company.category] || window.DEFAULT_INDUSTRY;
  const statusOf = (company) => (window.STATUS[company.hiring_status] ? company.hiring_status : "no_online_info");

  // ZIP centers come from the businesses in the directory (median location), with the most common town name.
  function zipCenters(companies) {
    const groups = new Map();
    for (const company of companies) {
      const zip = zipOf(company);
      if (!zip) continue;
      if (!groups.has(zip)) groups.set(zip, []);
      groups.get(zip).push(company);
    }
    const median = (values) => values.sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const centers = new Map();
    for (const [zip, list] of groups) {
      const towns = new Map();
      for (const company of list) towns.set(townOf(company), (towns.get(townOf(company)) || 0) + 1);
      const town = [...towns.entries()].filter(([name]) => name).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
      centers.set(zip, { lat: median(list.map((c) => c.latitude)), lon: median(list.map((c) => c.longitude)), town, count: list.length });
    }
    return centers;
  }

  const state = { companies: [], centers: new Map(), origin: null, picks: new Set(), shown: PAGE_SIZE, profile: loadProfile() };

  function renderChips() {
    const groups = [...new Set(Object.values(window.INDUSTRY).map((info) => info.group))].sort();
    const roles = [...new Set(Object.values(window.INDUSTRY).flatMap((info) => info.roles))].sort();
    const skills = [...new Set(Object.values(window.INDUSTRY).flatMap((info) => info.skills))].sort();
    const chip = (kind, value) => `<button type="button" class="chip" data-chip="${kind}:${esc(value)}" aria-pressed="false">${esc(value)}</button>`;
    document.querySelector("[data-chips='group']").innerHTML = groups.map((value) => chip("group", value)).join("");
    document.querySelector("[data-chips='role']").innerHTML = roles.map((value) => chip("role", value)).join("");
    document.querySelector("[data-chips='skill']").innerHTML = skills.map((value) => chip("skill", value)).join("");
    document.querySelectorAll(".chip").forEach((button) => {
      button.addEventListener("click", () => {
        const key = button.dataset.chip;
        if (state.picks.has(key)) state.picks.delete(key);
        else state.picks.add(key);
        syncChips();
        run(true);
      });
    });
  }
  function syncChips() {
    document.querySelectorAll(".chip[data-chip]").forEach((button) => button.setAttribute("aria-pressed", state.picks.has(button.dataset.chip) ? "true" : "false"));
    for (const kind of ["role", "skill"]) {
      const picked = [...state.picks].filter((key) => key.startsWith(`${kind}:`)).map((key) => key.split(/:(.*)/s)[1]);
      const label = document.querySelector(`[data-picked='${kind}']`);
      if (label) label.textContent = picked.length ? `· ${picked.join(", ")}` : "· tap to choose";
    }
  }

  function matchesFor(company) {
    if (!state.picks.size) return { score: 0, hits: [] };
    const info = industryOf(company);
    const hits = [];
    for (const key of state.picks) {
      const [kind, value] = key.split(/:(.*)/s);
      if (kind === "group" && info.group === value) hits.push(value);
      if (kind === "role" && info.roles.includes(value)) hits.push(value);
      if (kind === "skill" && info.skills.includes(value)) hits.push(value);
    }
    return { score: hits.length / state.picks.size, hits };
  }

  function evidenceScore(company) {
    return EVIDENCE[statusOf(company)] + (company.established_employer ? 25 : company.established ? 8 : 0);
  }

  function results() {
    if (!state.origin) return [];
    const radius = Number(field("radius").value);
    const fastOnly = field("fast").checked;
    const evidenceOnly = field("evidence-only").checked;
    const list = [];
    for (const company of state.companies) {
      const distance = miles(state.origin.lat, state.origin.lon, company.latitude, company.longitude);
      if (distance > radius) continue;
      if (fastOnly && industryOf(company).speed !== "fast") continue;
      if (evidenceOnly && !["hiring", "careers_page"].includes(statusOf(company)) && !company.established_employer) continue;
      const match = matchesFor(company);
      if (state.picks.size && !match.hits.length) continue;
      const evidence = evidenceScore(company);
      list.push({ company, distance, match, evidence, best: evidence + match.score * 30 - distance * 2 });
    }
    const sort = field("sort").value;
    if (sort === "nearest") list.sort((a, b) => a.distance - b.distance);
    else if (sort === "evidence") list.sort((a, b) => b.evidence - a.evidence || a.distance - b.distance);
    else list.sort((a, b) => b.best - a.best);
    return list;
  }

  function card(item) {
    const { company, distance, match } = item;
    const status = window.STATUS[statusOf(company)];
    const info = industryOf(company);
    const saved = (state.profile.saved || []).includes(company.slug);
    const site = company.hiring_evidence_url || company.website;
    return `
      <article class="company-card path-card">
        <div class="path-card-top">
          <div>
            <h3><a href="company/${encodeURIComponent(company.slug)}.html">${esc(company.name)}</a></h3>
            <p class="meta">${esc(company.category || "Local business")} · ${esc(townOf(company) || "nearby")} · ${distance.toFixed(1)} mi</p>
          </div>
          <button type="button" class="star" data-save="${esc(company.slug)}" aria-pressed="${saved}" title="${saved ? "Saved" : "Save this place"}">${saved ? "★" : "☆"}</button>
        </div>
        <p><span class="status-pill" style="--c:${status.color}">${esc(status.label)}</span>${company.established_employer ? ` <span class="pop-badge">Established local employer</span>` : company.established ? ` <span class="meta">Established 10+ years</span>` : ""}</p>
        ${company.hiring_track ? `<p class="meta">${esc(company.hiring_track)}.</p>` : ""}
        ${match.hits.length ? `<p class="meta"><b>Matches:</b> ${esc(match.hits.join(", "))}</p>` : `<p class="meta"><b>Typical roles:</b> ${esc(info.roles.slice(0, 4).join(", "))}</p>`}
        <div class="card-actions">
          <a class="button secondary" href="company/${encodeURIComponent(company.slug)}.html">Details</a>
          ${site ? `<a class="button ghost" href="${esc(site)}" rel="noopener">${company.hiring_evidence_url ? "Jobs page" : "Website"}</a>` : ""}
          ${company.phone ? `<a class="button ghost" href="tel:${esc(company.phone.replace(/[^\d+]/g, ""))}">Call</a>` : ""}
          <a class="button ghost" href="https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${company.latitude},${company.longitude}`)}" rel="noopener">Directions</a>
        </div>
      </article>`;
  }

  function render(list) {
    const target = document.querySelector("[data-path-results]");
    const more = field("more");
    if (!state.origin) {
      document.querySelector("[data-path-count]").textContent = "Enter a ZIP to start";
      target.innerHTML = "";
      more.hidden = true;
      return;
    }
    const hiring = list.filter((item) => statusOf(item.company) === "hiring").length;
    document.querySelector("[data-path-count]").textContent = `${fmt.format(list.length)} places within ${field("radius").value} miles${hiring ? `, ${fmt.format(hiring)} showing openings` : ""}`;
    target.innerHTML = list.length
      ? list.slice(0, state.shown).map(card).join("")
      : `<p class="panel">Nothing matches yet. Try a bigger distance or fewer picks.</p>`;
    more.hidden = list.length <= state.shown;
    target.querySelectorAll("[data-save]").forEach((button) => button.addEventListener("click", () => toggleSave(button.dataset.save)));
  }

  function remember() {
    const zip = field("zip").value.trim();
    Object.assign(state.profile, {
      zip,
      radius: field("radius").value,
      sort: field("sort").value,
      fast: field("fast").checked,
      evidenceOnly: field("evidence-only").checked,
      picks: [...state.picks]
    });
    if (state.origin) {
      const label = `${state.origin.label}${state.picks.size ? `: ${[...state.picks].map((key) => key.split(/:(.*)/s)[1]).join(", ")}` : ""} · ${field("radius").value} mi`;
      const recent = (state.profile.recent || []).filter((entry) => entry.label !== label);
      recent.unshift({ label, zip: state.origin.zip || "", lat: state.origin.lat, lon: state.origin.lon, picks: [...state.picks], radius: field("radius").value });
      state.profile.recent = recent.slice(0, 6);
    }
    saveProfile(state.profile);
    renderShortcuts();
    const params = new URLSearchParams();
    if (zip) params.set("zip", zip);
    params.set("r", field("radius").value);
    if (state.picks.size) params.set("picks", [...state.picks].join("|"));
    history.replaceState(null, "", `${location.pathname}?${params}`);
  }

  function toggleSave(slug) {
    const saved = new Set(state.profile.saved || []);
    if (saved.has(slug)) saved.delete(slug);
    else saved.add(slug);
    state.profile.saved = [...saved];
    saveProfile(state.profile);
    renderShortcuts();
    render(results());
  }

  function renderShortcuts() {
    const recent = state.profile.recent || [];
    document.querySelector("[data-path-recent]").innerHTML = recent.length
      ? recent.map((entry, index) => `<button type="button" class="chip" data-recent="${index}">${esc(entry.label)}</button>`).join("")
      : `<p class="meta">Your searches will show up here.</p>`;
    document.querySelectorAll("[data-recent]").forEach((button) =>
      button.addEventListener("click", () => {
        const entry = recent[Number(button.dataset.recent)];
        field("zip").value = entry.zip || "";
        field("radius").value = entry.radius || "10";
        state.picks = new Set(entry.picks || []);
        syncChips();
        state.origin = entry.zip && state.centers.has(entry.zip) ? originForZip(entry.zip) : { lat: entry.lat, lon: entry.lon, label: entry.label.split(":")[0], zip: entry.zip };
        run(true);
      })
    );
    const bySlug = new Map(state.companies.map((company) => [company.slug, company]));
    const saved = (state.profile.saved || []).map((slug) => bySlug.get(slug)).filter(Boolean);
    document.querySelector("[data-path-saved]").innerHTML = saved.length
      ? saved.map((company) => `<a class="chip" href="company/${encodeURIComponent(company.slug)}.html">★ ${esc(company.name)}</a>`).join("")
      : `<p class="meta">Tap ☆ on a place to save it.</p>`;
  }

  function originForZip(zip) {
    const center = state.centers.get(zip);
    if (!center) return null;
    return { lat: center.lat, lon: center.lon, zip, label: `${zip}${center.town ? ` (${center.town})` : ""}` };
  }

  function run(resetPaging) {
    if (resetPaging) state.shown = PAGE_SIZE;
    const where = document.querySelector("[data-path-where]");
    const zip = field("zip").value.trim();
    if (/^\d{5}$/.test(zip) && (!state.origin || state.origin.zip !== zip)) {
      state.origin = originForZip(zip);
      if (!state.origin) where.textContent = `We don't have businesses listed in ${zip} yet. Try a nearby ZIP or "Use my location".`;
    }
    if (state.origin) where.textContent = `Searching around ${state.origin.label}.`;
    render(results());
    if (state.origin) remember();
  }

  async function init() {
    const response = await fetch("companies.json");
    state.companies = await response.json();
    state.centers = zipCenters(state.companies);
    renderChips();

    const params = new URLSearchParams(location.search);
    const profile = state.profile;
    field("zip").value = params.get("zip") || profile.zip || "";
    field("radius").value = params.get("r") || profile.radius || "10";
    field("sort").value = profile.sort || "best";
    field("fast").checked = Boolean(profile.fast);
    field("evidence-only").checked = Boolean(profile.evidenceOnly);
    state.picks = new Set(params.get("picks") ? params.get("picks").split("|") : profile.picks || []);
    syncChips();
    renderShortcuts();

    let timer;
    document.querySelector("[data-path-form]").addEventListener("input", () => {
      clearTimeout(timer);
      timer = setTimeout(() => run(true), 200);
    });
    document.querySelector("[data-path-form]").addEventListener("submit", (event) => event.preventDefault());
    field("more").addEventListener("click", () => {
      state.shown += PAGE_SIZE;
      render(results());
    });
    field("clear").addEventListener("click", () => {
      try {
        localStorage.removeItem(PROFILE_KEY);
      } catch {
        /* ignore */
      }
      state.profile = {};
      renderShortcuts();
      render(results());
    });
    field("locate").addEventListener("click", () => {
      if (!navigator.geolocation) return;
      document.querySelector("[data-path-where]").textContent = "Finding your location…";
      navigator.geolocation.getCurrentPosition(
        (position) => {
          state.origin = { lat: position.coords.latitude, lon: position.coords.longitude, label: "your location", zip: "" };
          field("zip").value = "";
          run(true);
        },
        () => {
          document.querySelector("[data-path-where]").textContent = "Couldn't get your location. Enter a ZIP instead.";
        },
        { maximumAge: 600000, timeout: 10000 }
      );
    });
    run(true);
  }

  init().catch((error) => {
    console.error(error);
    document.querySelector("[data-path-count]").textContent = "Couldn't load the directory. Please refresh.";
  });
})();
