/* ==========================================================
   search-filters.js
   The Pokédex explorer under the search box: filter panel, sorting and the results grid.
   All the matching lives in core/dex.js; this file only builds the controls and draws the answer.
   Everything is built with el(); API data is only ever set as text.
   ========================================================== */

import { el } from "../core/ui.js";
import { TYPE_COLORS, spriteUrl } from "../core/api.js";
import { cacheClear } from "../core/cache.js";
import {
  TYPES, GENERATIONS, FIELDS, ready, query, subscribe, progress, startIndexing, canAutoPrefetch,
  prettyName, rangeActive, fieldValue
} from "../core/dex.js";

const PAGE = 48; // cards drawn per batch while scrolling

// Slider bounds. A handle left at its end means "no limit", so a Pokémon above a bound is never wrongly excluded.
const STAT_RANGE = { min: 0, max: 255, step: 1 };
const RANGES = {
  height: { min: 0, max: 20, step: 0.1, unit: "m" },
  weight: { min: 0, max: 1000, step: 1, numStep: 0.1, unit: "kg" },
  bst: { min: 0, max: 800, step: 5 },
  hp: STAT_RANGE, attack: STAT_RANGE, defense: STAT_RANGE,
  "special-attack": STAT_RANGE, "special-defense": STAT_RANGE, speed: STAT_RANGE
};

const PREF_KEY = "pe_search_prefs";
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* private mode: preferences just won't stick */ }
}

const labelOf = (key) => FIELDS.find((f) => f.key === key)?.label || key;

export function initExplorer({ root, onOpen }) {
  const prefs = loadPrefs();
  const validSort = FIELDS.some((f) => f.key === prefs.sort);
  const state = {
    types: new Set(),
    typeMode: prefs.typeMode === "all" ? "all" : "any",
    typeSlot: ["primary", "secondary"].includes(prefs.typeSlot) ? prefs.typeSlot : "either",
    gens: new Set(),
    ranges: Object.fromEntries(Object.keys(RANGES).map((k) => [k, { min: null, max: null }])),
    sort: { key: validSort ? prefs.sort : "id", dir: prefs.dir === "desc" ? "desc" : "asc" }
  };
  const panelOpen = prefs.panelOpen ?? window.matchMedia("(min-width: 760px)").matches;
  const remember = () => savePrefs({
    sort: state.sort.key, dir: state.sort.dir, typeMode: state.typeMode, typeSlot: state.typeSlot,
    panelOpen: !body.hidden
  });

  /* ---------- skeleton of the section ---------- */

  const header = el("div", "dex-filters__header");
  const toggle = el("button", "btn btn--ghost dex-filters__toggle");
  toggle.type = "button";
  toggle.setAttribute("aria-controls", "dex-filter-body");
  const countBadge = el("span", "dex-filters__count");
  const toggleText = el("span", "", "Filters");
  toggle.append(toggleText, countBadge);
  const resetBtn = el("button", "btn btn--ghost btn--small dex-filters__reset", "Reset filters");
  resetBtn.type = "button";
  header.append(toggle, resetBtn);

  const body = el("div", "dex-filters__body");
  body.id = "dex-filter-body";
  body.hidden = !panelOpen;
  const panel = el("section", "dex-filters glass");
  panel.setAttribute("aria-label", "Pokédex filters");
  panel.append(header, body);

  const toolbar = el("div", "dex-toolbar");
  const status = el("div", "dex-status");
  status.setAttribute("role", "status");
  status.hidden = true;
  const grid = el("div", "dex-grid");
  grid.setAttribute("aria-label", "Pokémon results");
  const more = el("div", "dex-more");
  root.replaceChildren(panel, toolbar, status, grid, more);

  /* ---------- filter controls ---------- */

  // Types
  const typeSet = el("fieldset", "dex-fieldset");
  typeSet.append(el("legend", "", "Type"));
  const typeRow = el("div", "dex-chips");
  const typeButtons = new Map();
  TYPES.forEach((t) => {
    const b = el("button", "type-chip", t);
    b.type = "button";
    b.setAttribute("aria-pressed", "false");
    b.style.setProperty("--badge-color", TYPE_COLORS[t]);
    b.addEventListener("click", () => {
      state.types.has(t) ? state.types.delete(t) : state.types.add(t);
      b.setAttribute("aria-pressed", String(state.types.has(t)));
      syncTypeControls(); change();
    });
    typeButtons.set(t, b);
    typeRow.append(b);
  });

  const slotSelect = el("select", "dex-select");
  slotSelect.id = "dex-slot";
  [["either", "Primary or secondary type"], ["primary", "Primary type only"], ["secondary", "Secondary type only"]]
    .forEach(([v, text]) => { const o = el("option", "", text); o.value = v; slotSelect.append(o); });
  slotSelect.value = state.typeSlot;
  const slotLabel = el("label", "dex-inline-label", "Look at");
  slotLabel.htmlFor = "dex-slot";

  const modeGroup = el("div", "dex-radios");
  modeGroup.setAttribute("role", "radiogroup");
  modeGroup.setAttribute("aria-label", "How selected types must match");
  const modeInputs = {};
  [["any", "Match ANY selected type"], ["all", "Match ALL selected types"]].forEach(([v, text]) => {
    const label = el("label", "dex-radio");
    const input = el("input");
    input.type = "radio"; input.name = "dex-type-mode"; input.value = v;
    input.checked = state.typeMode === v;
    input.addEventListener("change", () => { state.typeMode = v; syncTypeControls(); change(); });
    modeInputs[v] = input;
    label.append(input, el("span", "", text));
    modeGroup.append(label);
  });
  const typeHint = el("p", "dex-hint");
  typeHint.setAttribute("aria-live", "polite");
  slotSelect.addEventListener("change", () => { state.typeSlot = slotSelect.value; syncTypeControls(); change(); });
  const slotRow = el("div", "dex-row");
  slotRow.append(slotLabel, slotSelect);
  typeSet.append(typeRow, slotRow, modeGroup, typeHint);

  function syncTypeControls() {
    const either = state.typeSlot === "either";
    modeInputs.any.disabled = modeInputs.all.disabled = !either; // ALL/ANY only means something across both slots
    modeInputs[state.typeMode].checked = true;
    const picked = [...state.types].map(prettyName);
    let text = "";
    if (!picked.length) text = "Pick one or more types. No type selected means every type.";
    else if (!either) text = `${state.typeSlot === "primary" ? "Primary" : "Secondary"} type is ${picked.join(" or ")}.`;
    else if (state.typeMode === "all") {
      text = state.types.size > 2
        ? "No Pokémon has more than two types, so matching ALL of these gives no results."
        : `Pokémon that are ${picked.join(" and ")} (in either slot).`;
    } else text = `Pokémon with ${picked.join(" or ")} as a type.`;
    typeHint.textContent = text;
  }

  // Generations
  const genSet = el("fieldset", "dex-fieldset");
  genSet.append(el("legend", "", "Generation"));
  const genRow = el("div", "dex-chips");
  GENERATIONS.forEach((g) => {
    const b = el("button", "chip chip--toggle", `Gen ${g.roman}`);
    b.type = "button";
    b.title = `${g.region} (#${g.from}–${g.to})`;
    b.setAttribute("aria-pressed", "false");
    b.addEventListener("click", () => {
      state.gens.has(g.n) ? state.gens.delete(g.n) : state.gens.add(g.n);
      b.setAttribute("aria-pressed", String(state.gens.has(g.n)));
      change();
    });
    genRow.append(b);
  });
  genSet.append(genRow, el("p", "dex-hint", "Select several generations to combine them."));

  // Numeric ranges: two sliders (low / high) plus two number boxes
  const rangeUpdaters = [];
  function rangeControl(key) {
    const cfg = RANGES[key];
    const r = state.ranges[key];
    const wrap = el("div", "range");
    const head = el("div", "range__head");
    const name = el("span", "range__name", labelOf(key) + (cfg.unit ? ` (${cfg.unit})` : ""));
    const out = el("output", "range__out mono");
    head.append(name, out);

    const sliders = el("div", "range__sliders");
    const mk = (cls, label, value) => {
      const i = el("input", cls);
      i.type = "range"; i.min = cfg.min; i.max = cfg.max; i.step = cfg.step; i.value = value;
      i.setAttribute("aria-label", `${label} ${labelOf(key)}`);
      return i;
    };
    const lo = mk("range__lo", "Minimum", cfg.min);
    const hi = mk("range__hi", "Maximum", cfg.max);
    sliders.append(lo, hi);

    const nums = el("div", "range__nums");
    const mkNum = (label, ph) => {
      const i = el("input", "range__num");
      i.type = "number"; i.min = cfg.min; i.max = cfg.max; i.step = cfg.numStep || cfg.step;
      i.placeholder = ph; i.inputMode = "decimal";
      i.setAttribute("aria-label", `${label} ${labelOf(key)}`);
      return i;
    };
    const numLo = mkNum("Minimum", "min"), numHi = mkNum("Maximum", "max");
    nums.append(numLo, el("span", "", "to"), numHi);

    function paint() {
      const lov = r.min ?? cfg.min, hiv = r.max ?? cfg.max;
      lo.value = lov; hi.value = hiv;
      numLo.value = r.min ?? ""; numHi.value = r.max ?? "";
      const span = cfg.max - cfg.min;
      sliders.style.setProperty("--lo", ((lov - cfg.min) / span) * 100 + "%");
      sliders.style.setProperty("--hi", ((hiv - cfg.min) / span) * 100 + "%");
      lo.classList.toggle("is-top", lov - cfg.min > span * 0.9); // keep the low handle reachable when both sit at the right end
      const u = cfg.unit ? " " + cfg.unit : "";
      out.textContent = !rangeActive(r) ? "Any" : r.min !== null && r.max !== null ? `${r.min} – ${r.max}${u}` : r.min !== null ? `≥ ${r.min}${u}` : `≤ ${r.max}${u}`;
      wrap.classList.toggle("is-active", rangeActive(r));
    }
    const commit = () => { paint(); change(); };
    const clampNum = (v) => Math.min(cfg.max, Math.max(cfg.min, v));
    // A handle resting on its end of the track means "no limit".
    lo.addEventListener("input", () => { const v = Math.min(Number(lo.value), r.max ?? cfg.max); r.min = v <= cfg.min ? null : v; commit(); });
    hi.addEventListener("input", () => { const v = Math.max(Number(hi.value), r.min ?? cfg.min); r.max = v >= cfg.max ? null : v; commit(); });
    numLo.addEventListener("change", () => { r.min = numLo.value === "" ? null : clampNum(Number(numLo.value)); if (r.min !== null && r.max !== null && r.min > r.max) r.max = r.min; commit(); });
    numHi.addEventListener("change", () => { r.max = numHi.value === "" ? null : clampNum(Number(numHi.value)); if (r.min !== null && r.max !== null && r.max < r.min) r.min = r.max; commit(); });

    rangeUpdaters.push(paint);
    paint();
    wrap.append(head, sliders, nums);
    return wrap;
  }
  const rangeSet = el("fieldset", "dex-fieldset");
  rangeSet.append(el("legend", "", "Size and base stats"));
  const rangeGrid = el("div", "dex-ranges");
  FIELDS.filter((f) => !f.sortOnly).forEach((f) => rangeGrid.append(rangeControl(f.key)));
  rangeSet.append(rangeGrid, el("p", "dex-hint", "These use base stats. Leave a handle at the end of its track for no limit."));

  const clearCache = el("button", "dex-link", "Clear saved Pokédex data");
  clearCache.type = "button";
  clearCache.title = "Deletes the downloaded index from this browser; it downloads again when needed.";
  clearCache.addEventListener("click", async () => { await cacheClear(); location.reload(); });

  const foot = el("div", "dex-filters__foot");
  foot.append(clearCache);
  body.append(typeSet, genSet, rangeSet, foot);

  /* ---------- sorting + count toolbar ---------- */

  const count = el("p", "dex-count");
  count.setAttribute("aria-live", "polite");
  const sortLabel = el("label", "dex-inline-label", "Sort by");
  sortLabel.htmlFor = "dex-sort";
  const sortSelect = el("select", "dex-select");
  sortSelect.id = "dex-sort";
  FIELDS.forEach((f) => { const o = el("option", "", f.label); o.value = f.key; sortSelect.append(o); });
  sortSelect.value = state.sort.key;
  const dirBtn = el("button", "btn btn--ghost btn--small dex-dir");
  dirBtn.type = "button";
  const speedNote = el("p", "dex-hint dex-toolbar__note",
    "Base Speed is the species stat. Real battle Speed also depends on level, IVs, EVs, nature and items, so it is not calculated here.");
  const sortBox = el("div", "dex-sort");
  sortBox.append(sortLabel, sortSelect, dirBtn);
  toolbar.append(count, sortBox, speedNote);

  function syncSort() {
    const asc = state.sort.dir === "asc";
    dirBtn.textContent = asc ? "↑ Ascending" : "↓ Descending";
    dirBtn.setAttribute("aria-label", `Sort order: ${asc ? "ascending" : "descending"}. Press to reverse.`);
    speedNote.hidden = state.sort.key !== "speed";
  }
  sortSelect.addEventListener("change", () => { state.sort.key = sortSelect.value; syncSort(); change(); });
  dirBtn.addEventListener("click", () => { state.sort.dir = state.sort.dir === "asc" ? "desc" : "asc"; syncSort(); change(); });

  /* ---------- panel toggle / reset ---------- */

  function activeCount() {
    return (state.types.size ? 1 : 0) + (state.gens.size ? 1 : 0) + Object.values(state.ranges).filter(rangeActive).length;
  }
  function syncHeader() {
    const n = activeCount();
    countBadge.textContent = n ? String(n) : "";
    countBadge.hidden = !n;
    resetBtn.hidden = !n;
    toggle.setAttribute("aria-expanded", String(!body.hidden));
    toggleText.textContent = body.hidden ? "Show filters" : "Hide filters";
    toggle.setAttribute("aria-label", `${body.hidden ? "Show" : "Hide"} filters${n ? `, ${n} active` : ""}`);
  }
  toggle.addEventListener("click", () => { body.hidden = !body.hidden; syncHeader(); remember(); });

  function reset() {
    state.types.clear(); state.gens.clear();
    Object.values(state.ranges).forEach((r) => { r.min = null; r.max = null; });
    state.typeSlot = "either"; slotSelect.value = "either";
    typeButtons.forEach((b) => b.setAttribute("aria-pressed", "false"));
    genRow.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", "false"));
    rangeUpdaters.forEach((paint) => paint());
    syncTypeControls(); change();
  }
  resetBtn.addEventListener("click", reset);

  /* ---------- results ---------- */

  let result = { items: [], pendingStats: 0, usesStats: false };
  let shown = 0;
  let timer = 0;
  let baseError = null;
  let observer = null;
  let lastRefresh = 0;
  let refreshTimer = 0;

  function stateBox(title, text, ...buttons) {
    const box = el("div", "state-message dex-state");
    box.append(el("h3", "", title), el("p", "", text));
    buttons.forEach((b) => box.append(b));
    return box;
  }
  const button = (text, onClick) => {
    const b = el("button", "btn btn--primary", text);
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };

  function buildCard(item) {
    const c = el("div", "poke-card dex-card");
    c.setAttribute("role", "button");
    c.tabIndex = 0;
    c.dataset.id = item.id;
    c.setAttribute("aria-label", `${prettyName(item.name)}, number ${item.id}. Show details`);
    c.style.setProperty("--card-glow", TYPE_COLORS[item.types?.[0]] || TYPE_COLORS.normal);

    const art = el("img", "dex-card__art");
    art.src = spriteUrl(item.id);
    art.alt = "";
    art.width = art.height = 96;
    art.loading = "lazy";
    art.decoding = "async";

    const badges = el("div", "poke-card__badges");
    (item.types || []).forEach((t) => {
      const b = el("span", "badge", t);
      b.style.setProperty("--badge-color", TYPE_COLORS[t]);
      badges.append(b);
    });
    c.append(art, el("span", "poke-card__number", "#" + String(item.id).padStart(3, "0")), el("span", "poke-card__name", prettyName(item.name)), badges);

    // When sorted by a number, show that number on the card so the order is readable.
    const k = state.sort.key;
    if (k !== "id" && k !== "name") {
      const v = fieldValue(item.rec, k);
      const unit = FIELDS.find((f) => f.key === k)?.unit;
      c.append(el("span", "dex-card__value mono", `${labelOf(k)}: ${v === null ? "…" : v + (unit ? " " + unit : "")}`));
    }
    return c;
  }

  function appendBatch() {
    const slice = result.items.slice(shown, shown + PAGE);
    if (!slice.length) return;
    const frag = document.createDocumentFragment();
    slice.forEach((item) => frag.append(buildCard(item)));
    grid.append(frag);
    shown += slice.length;
    renderMore();
  }

  function renderMore() {
    more.replaceChildren();
    if (observer) observer.disconnect();
    if (shown >= result.items.length) return;
    const b = el("button", "btn btn--ghost", `Show more (${result.items.length - shown} left)`);
    b.type = "button";
    b.addEventListener("click", appendBatch);
    more.append(b);
    // Scrolling near the button loads the next batch by itself; the button stays as the keyboard / no-JS-observer path.
    if ("IntersectionObserver" in window) {
      observer = new IntersectionObserver((entries) => { if (entries.some((e) => e.isIntersecting)) appendBatch(); }, { rootMargin: "700px" });
      observer.observe(b);
    }
  }

  function renderStatus() {
    const p = progress();
    const missing = p.statsTotal - p.statsLoaded;
    status.replaceChildren();
    if (baseError || !missing && !p.failed) { status.hidden = true; return; }

    if (p.running && p.phase === "stats" && missing) {
      const bar = el("progress", "dex-status__bar");
      bar.max = p.statsTotal; bar.value = p.statsLoaded;
      bar.setAttribute("aria-label", "Stats downloaded");
      status.append(el("span", "", `Downloading base stats: ${p.statsLoaded} of ${p.statsTotal} Pokémon. `), bar);
      if (result.usesStats) {
        status.append(el("strong", "", ` Results only include the ${p.statsLoaded} Pokémon loaded so far and update as more arrive.`));
      }
      status.hidden = false;
    } else if (!p.running && p.failed) { // a finished run that left gaps: say so first, offer a retry
      status.append(el("span", "", `${p.failed} Pokémon could not be loaded (PokéAPI may be busy). `), button("Try again", () => startIndexing({ boost: true })));
      status.hidden = false;
    } else if (!p.running && missing && result.usesStats) {
      status.append(el("span", "", `Stats for ${missing} Pokémon are not downloaded yet, so these results are incomplete. `), button("Download now", () => { startIndexing({ boost: true }); renderStatus(); }));
      status.hidden = false;
    } else if (!p.running && missing && !canAutoPrefetch()) {
      status.append(el("span", "", "Data Saver is on, so base stats are not downloaded in the background. Number filters and sorts need them. "), button("Download now", () => startIndexing({ boost: true })));
      status.hidden = false;
    } else {
      status.hidden = true;
    }
  }

  function draw({ keepScroll = false } = {}) {
    syncHeader();
    lastRefresh = Date.now();
    if (baseError) {
      count.textContent = "";
      grid.replaceChildren(stateBox("Couldn't load the Pokédex", "PokéAPI could not be reached, so the list can't be built yet.", button("Try again", () => start())));
      more.replaceChildren();
      renderStatus();
      return;
    }
    result = query(state);
    const total = result.items.length;
    const keep = keepScroll ? Math.min(Math.max(shown, PAGE), total) : PAGE;
    count.textContent = total === 1 ? "1 Pokémon" : `${total.toLocaleString()} Pokémon`;
    if (result.pendingStats && result.usesStats) count.textContent += " (partial: stats still loading)";

    grid.replaceChildren();
    shown = 0;
    if (!total) {
      const loading = progress().running && result.usesStats && result.pendingStats;
      grid.append(loading
        ? stateBox("Still loading stats…", "Nothing matches yet among the Pokémon downloaded so far. Results will appear as more arrive.")
        : stateBox("No Pokémon match these filters", state.typeMode === "all" && state.types.size > 2 && state.typeSlot === "either"
            ? "No Pokémon has more than two types. Pick fewer types or switch to ANY."
            : "Try removing a filter or widening a range.", button("Reset filters", reset)));
      more.replaceChildren();
    } else {
      const target = Math.min(keep, total); // fewer results than one page: stop at the end, don't loop
      while (shown < target) appendBatch();
      if (shown >= total) renderMore();
    }
    renderStatus();
    // A numeric filter or sort is being used: make sure the stats are on their way, at full speed.
    if (result.usesStats && result.pendingStats) startIndexing({ boost: true }); // idempotent: also speeds up a run already in progress
  }

  function change() { // many controls fire in quick succession (slider drags): redraw once per burst
    syncHeader(); remember();
    clearTimeout(timer);
    timer = setTimeout(() => draw(), 60);
  }

  grid.addEventListener("click", (e) => {
    const card = e.target.closest(".dex-card");
    if (card) onOpen({ id: Number(card.dataset.id) });
  });
  grid.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const card = e.target.closest(".dex-card");
    if (!card) return;
    e.preventDefault();
    onOpen({ id: Number(card.dataset.id) });
  });

  /* ---------- start-up ---------- */

  subscribe((evt) => {
    if (evt.type === "progress") { requestAnimationFrame(renderStatus); return; }
    if (evt.type === "base") return; // handled by start()
    // New records arrived (or a run ended): redraw if the visible answer depends on them, at most every 1.5 s.
    if (!result.usesStats) { renderStatus(); return; }
    // Throttled to one redraw per 1.5 s, but never dropped: a trailing redraw makes sure the final records show.
    const wait = 1500 - (Date.now() - lastRefresh);
    clearTimeout(refreshTimer);
    if (wait <= 0) draw({ keepScroll: true });
    else { renderStatus(); refreshTimer = setTimeout(() => draw({ keepScroll: true }), wait); }
  });

  function showSkeleton() {
    grid.replaceChildren(...Array.from({ length: 12 }, () => el("div", "poke-card poke-card--skeleton")));
    count.textContent = "Loading the Pokédex…";
  }

  async function start() {
    baseError = null;
    showSkeleton();
    try {
      await ready();
    } catch {
      baseError = true;
      draw();
      return;
    }
    syncTypeControls(); syncSort(); syncHeader();
    draw();
    // Fetch the stats in the background once the browser is idle, unless Data Saver / 2G says not to.
    if (canAutoPrefetch()) setTimeout(() => startIndexing(), 1200);
    else renderStatus();
  }

  syncTypeControls(); syncSort(); syncHeader();
  start();

  return { reset, state };
}
