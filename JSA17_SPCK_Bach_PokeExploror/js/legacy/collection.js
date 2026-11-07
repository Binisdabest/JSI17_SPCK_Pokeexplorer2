/* ==========================================================
   collection.js  (parked page collection.html)
   Cards are built with el() / DOM APIs, never innerHTML. The collection itself still lives in localStorage
   (js/core/storage.js); parked.js mirrors a summary to the trainer profile when someone is logged in.
   ========================================================== */

import { TYPE_COLORS, RARITY_COLORS, getPokemonCount } from "../core/api.js";
import { getCollection, removeFromCollection, toggleFavorite } from "../core/storage.js";
import { el, safeSrc, toast, confirmAction } from "../core/ui.js";
import { initParkedPage, trainerChanged } from "./parked.js";

const RARITY_ORDER = ["Mythical", "Legendary", "Ultra Rare", "Rare", "Uncommon", "Common"];
const KNOWN_RARITY = new Set(["common", "uncommon", "rare", "ultra-rare", "legendary", "mythical"]);

const grid = document.getElementById("collection-grid");
const sortSelect = document.getElementById("sort-select");
const typeSelect = document.getElementById("type-select");
const favoritesOnly = document.getElementById("favorites-only");

/** "Ultra Rare" -> "ultra-rare". Anything that is not one of our six tiers counts as common. */
function rarityKeyOf(label) {
  const key = String(label || "").toLowerCase().replace(/\s+/g, "-");
  return KNOWN_RARITY.has(key) ? key : "common";
}

function formatDate(iso) {
  const d = new Date(iso);
  return isNaN(d) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function populateTypeFilter() {
  Object.keys(TYPE_COLORS)
    .sort()
    .forEach((type) => {
      const option = document.createElement("option");
      option.value = type;
      option.textContent = type;
      typeSelect.appendChild(option);
    });
}

function getFilteredSorted() {
  let items = getCollection();

  if (favoritesOnly.checked) {
    items = items.filter((p) => p.favorite);
  }
  if (typeSelect.value !== "all") {
    items = items.filter((p) => Array.isArray(p.types) && p.types.includes(typeSelect.value));
  }

  if (sortSelect.value === "az") {
    items = items.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  } else if (sortSelect.value === "rarity") {
    items = items.slice().sort((a, b) => RARITY_ORDER.indexOf(a.rarity) - RARITY_ORDER.indexOf(b.rarity));
  }
  // "recent" is already the natural stored order (newest first)

  return items;
}

/** Small stroke icon from path data. */
function svgIcon(paths) {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("aria-hidden", "true");
  [].concat(paths).forEach((d) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  });
  return svg;
}

const ICON_SHARE = ["M4 12v8h16v-8", "M16 6l-4-4-4 4", "M12 2v13"];
const ICON_HEART = "M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c1.9 0 3.4 1.1 4.5 2.6C12.1 6.1 13.6 5 15.5 5 19 5 21.5 8.5 19.5 12.5 17 16.65 12 21 12 21z";
const ICON_CLOSE = ["M6 6L18 18", "M6 18L18 6"];

function iconButton(extraClass, action, label, icon) {
  const b = el("button", "icon-btn " + extraClass);
  b.type = "button";
  b.dataset.action = action;
  b.title = label;
  b.setAttribute("aria-label", label);
  b.append(svgIcon(icon));
  return b;
}

function buildCard(entry) {
  const rarityKey = rarityKeyOf(entry.rarity);
  const name = String(entry.name ?? "?");

  const card = el("article", "collection-card");
  card.dataset.rarity = rarityKey;
  card.style.setProperty("--glow-color", RARITY_COLORS[rarityKey]);

  const share = iconButton("", "share", "Share to Community", ICON_SHARE);
  const fav = iconButton(entry.favorite ? "is-favorited" : "", "favorite", entry.favorite ? "Remove from favorites" : "Add to favorites", ICON_HEART);
  fav.setAttribute("aria-pressed", String(!!entry.favorite));
  const remove = iconButton("is-remove", "remove", "Remove from collection", ICON_CLOSE);
  const actions = el("div", "collection-card__actions");
  actions.append(share, fav, remove);
  const top = el("div", "collection-card__top");
  top.append(el("span", `rarity-tag rarity-${rarityKey}`, String(entry.rarity || "Common")), actions);

  const badges = el("div", "poke-card__badges");
  (Array.isArray(entry.types) ? entry.types : []).forEach((type) => {
    const badge = el("span", "badge", String(type));
    if (TYPE_COLORS[type]) badge.style.setProperty("--badge-color", TYPE_COLORS[type]);
    badges.append(badge);
  });

  const meta = el("div", "collection-card__meta");
  meta.append(el("span", "collection-card__date", "Obtained " + formatDate(entry.obtainedAt)));

  card.append(top);
  const src = safeSrc(entry.artwork);
  if (src) {
    const img = el("img");
    img.src = src;
    img.alt = name;
    img.loading = "lazy";
    card.append(img);
  }
  card.append(el("h3", "", name), badges, meta);

  share.addEventListener("click", async () => {
    const { openShare } = await import("../community/share.js");
    openShare({ attachment: { kind: "pokemon", id: entry.id, name: entry.name, rarity: entry.rarity, from: "collection" }, title: "Share a Pokémon" });
  });

  fav.addEventListener("click", () => {
    toggleFavorite(entry.uid);
    render();
    trainerChanged(); // favourites decide the trainer-page showcase
  });

  remove.addEventListener("click", async () => {
    const confirmed = await confirmAction(`Remove ${name} from your collection? This can't be undone.`);
    if (!confirmed) return;
    removeFromCollection(entry.uid);
    toast(`${name} removed from your collection.`, "info");
    updateProgressBar();
    render();
    trainerChanged();
  });

  return card;
}

function render() {
  const items = getFilteredSorted();
  grid.replaceChildren();

  if (items.length === 0) {
    const empty = el("div", "empty-state");
    empty.style.gridColumn = "1 / -1";
    const link = el("a", "", "Lucky Spin");
    link.href = "games.html";
    link.style.color = "var(--violet)";
    empty.append("No Pokémon here yet — head to ", link, " to start collecting.");
    grid.append(empty);
    return;
  }

  items.forEach((entry) => grid.appendChild(buildCard(entry)));
}

sortSelect.addEventListener("change", render);
typeSelect.addEventListener("change", render);
favoritesOnly.addEventListener("change", render);

let totalSpeciesCount = null;

function updateProgressBar() {
  const uniqueOwned = new Set(getCollection().map((p) => p.id)).size;
  if (totalSpeciesCount) {
    const percent = Math.min(100, Math.round((uniqueOwned / totalSpeciesCount) * 100));
    document.getElementById("progress-label").textContent = `${uniqueOwned} of ${totalSpeciesCount} Pokémon species collected`;
    document.getElementById("progress-percent").textContent = `${percent}%`;
    document.getElementById("progress-fill").style.width = `${percent}%`;
  } else {
    document.getElementById("progress-label").textContent = `${uniqueOwned} Pokémon species collected`;
    document.getElementById("progress-percent").textContent = "—";
  }
}

async function renderProgress() {
  try {
    totalSpeciesCount = await getPokemonCount();
  } catch {
    totalSpeciesCount = null;
  }
  updateProgressBar();
}

initParkedPage();
populateTypeFilter();
renderProgress();
render();
