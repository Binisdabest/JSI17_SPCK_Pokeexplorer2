/* ==========================================================
   search.js
   Pokédex lookup: the detail view for one Pokémon, wired to autocomplete (search-suggest.js) and the filterable
   grid (search-filters.js). Everything is built with el() / textContent,
   so neither the typed query nor API data can run as HTML.
   ========================================================== */

import { getSimplifiedPokemon, getEvolutionLine, TYPE_COLORS, STAT_COLORS } from "../core/api.js";
import { el, initUI, toast } from "../core/ui.js";
import { ready, isReady, suggest } from "../core/dex.js";
import { attachAutocomplete } from "./search-suggest.js";
import { initExplorer } from "./search-filters.js";

const STAT_LABELS = {
  hp: "HP", attack: "Attack", defense: "Defense",
  "special-attack": "Sp. Atk", "special-defense": "Sp. Def", speed: "Speed"
};
const STAT_MAX = 255; // ceiling used for bar-fill percentage, not a real limit
const SVG_NS = "http://www.w3.org/2000/svg";

const resultsEl = document.getElementById("search-results");

// Bumped on every search. Slow responses from older searches compare against it and give up.
let latestSearch = 0;

function stateMessage(title, text, { loading = false, icon = false } = {}) {
  const box = el("div", "state-message");
  if (loading) box.append(el("div", "loading-ring"));
  if (icon) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.5");
    svg.innerHTML = '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'; // fixed markup, no user data
    box.append(svg);
  }
  box.append(el("h3", "", title), el("p", "", text));
  return box;
}

const showLoading = () => {
  resultsEl.hidden = false;
  resultsEl.replaceChildren(stateMessage("Scanning the Pokédex...", "Reaching out to PokéAPI.", { loading: true }));
};

const showError = (query) => {
  resultsEl.hidden = false;
  resultsEl.replaceChildren(stateMessage(
    `No Pokémon found for "${query}"`,
    "Check the spelling, or try a Pokédex number between 1 and 1025.",
    { icon: true }
  ));
};

function statRow(label, value, percent, color, extraClass = "") {
  const row = el("div", "stat-row " + extraClass);
  const fill = el("div", "stat-fill");
  fill.style.width = percent + "%";
  fill.style.setProperty("--stat-color", color);
  const track = el("div", "stat-track");
  track.append(fill);
  row.append(el("span", "stat-label", label), track, el("span", "stat-value mono", String(value)));
  return row;
}

function buildStats(stats) {
  const wrap = el("div", "stats");
  Object.entries(stats).forEach(([key, value]) => {
    const percent = Math.min(100, Math.round((value / STAT_MAX) * 100));
    wrap.append(statRow(STAT_LABELS[key] || key, value, percent, STAT_COLORS[key] || "var(--violet)"));
  });
  const total = Object.values(stats).reduce((sum, v) => sum + v, 0);
  const totalPercent = Math.min(100, Math.round((total / (STAT_MAX * 6)) * 100));
  wrap.append(statRow("Total", total, totalPercent, "var(--gradient-brand)", "stat-row--total"));
  return wrap;
}

function metaItem(label, value) {
  const item = el("div", "meta-item");
  item.append(el("span", "label", label), el("span", "value", value));
  return item;
}

async function buildEvolution(pokemon) {
  try {
    const line = await getEvolutionLine(pokemon.id);
    if (line.length < 2) return null;
    const stages = await Promise.all(line.map((name) => getSimplifiedPokemon(name)));
    const wrap = el("div", "evolution-line");
    stages.forEach((stage, i) => {
      if (i > 0) wrap.append(el("span", "evolution-arrow", "→"));
      const step = el("div", "evolution-step");
      const img = el("img");
      img.src = stage.artwork;
      img.alt = stage.name;
      step.append(img, el("span", "", stage.name));
      wrap.append(step);
    });
    return wrap;
  } catch {
    return null; // evolution data is a bonus, not worth failing the whole card over
  }
}

async function renderResult(pokemon, searchId) {
  const card = el("article", "result-card glass is-revealed");
  card.style.setProperty("--card-glow", TYPE_COLORS[pokemon.types[0]] || TYPE_COLORS.normal);

  const artWrap = el("div", "result-card__art-wrap");
  const art = el("img");
  art.src = pokemon.artwork;
  art.alt = pokemon.name;
  art.style.width = "80%";
  artWrap.append(el("span", "result-card__number mono", "#" + String(pokemon.id).padStart(3, "0")), art);

  const badges = el("div", "result-card__badges");
  pokemon.types.forEach((type) => {
    const badge = el("span", "badge", type);
    badge.style.setProperty("--badge-color", TYPE_COLORS[type]);
    badges.append(badge);
  });

  const meta = el("div", "meta-row");
  meta.append(metaItem("Height", pokemon.height + " m"), metaItem("Weight", pokemon.weight + " kg"));

  const abilities = el("div", "abilities");
  pokemon.abilities.forEach((a) => abilities.append(el("span", "ability-pill", a.replace(/-/g, " "))));

  const evolutionSlot = el("div");
  const info = el("div");
  info.append(el("h2", "result-card__name", pokemon.name), badges, meta, abilities, buildStats(pokemon.stats), evolutionSlot);
  card.append(artWrap, info);
  resultsEl.replaceChildren(card);

  const evolution = await buildEvolution(pokemon);
  if (searchId !== latestSearch) return; // a newer search replaced this card while we waited
  if (evolution) evolutionSlot.append(evolution);
}

async function search(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    toast("Type a name or Pokédex number first.", "error");
    return;
  }

  const searchId = ++latestSearch;
  showLoading();

  try {
    // Resolve through the Pokédex index first, so a partial name ("pika") or "Mr. Mime" finds its best match.
    // If the index is not available, fall back to asking PokéAPI for exactly what was typed.
    try { await ready(); } catch { /* offline or PokéAPI down: the direct lookup below decides */ }
    const best = isReady() ? suggest(trimmed, 1)[0] : null;
    const pokemon = await getSimplifiedPokemon(best ? best.id : trimmed);
    if (searchId !== latestSearch) return; // newer search already started
    await renderResult(pokemon, searchId);
  } catch {
    if (searchId === latestSearch) showError(trimmed);
  }
}

const searchInput = document.getElementById("search-input");
const autocomplete = attachAutocomplete({
  input: searchInput,
  onSelect: (row) => { search(String(row.id)); resultsEl.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "start" }); }
});

document.getElementById("search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  autocomplete.close();
  search(searchInput.value);
});

const motionOk = () => !window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// The Pokédex grid, filters and sorting under the search box. Clicking a card opens the same detail view.
initExplorer({
  root: document.getElementById("dex-explorer"),
  onOpen: ({ id }) => {
    search(String(id));
    resultsEl.scrollIntoView({ behavior: motionOk() ? "smooth" : "auto", block: "start" });
  }
});

document.querySelectorAll(".chip[data-query]").forEach((chip) => {
  chip.addEventListener("click", () => {
    searchInput.value = chip.dataset.query;
    autocomplete.close();
    search(chip.dataset.query);
  });
});

document.addEventListener("DOMContentLoaded", initUI);
