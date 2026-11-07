/* ==========================================================
   cards.js  (parked page cards.html: Pokémon TCG card search)
   Card data comes from a third-party API, so every value is set as text or through safeSrc() — never innerHTML.
   ========================================================== */

import { searchCards, normalizeRarity, RARITY_COLORS } from "../core/api.js";
import { el, safeSrc, toast } from "../core/ui.js";
import { initParkedPage } from "./parked.js";

const grid = document.getElementById("card-grid");
const detailSlot = document.getElementById("card-detail-slot");

function formatPrice(value) {
  return typeof value === "number" ? `$${value.toFixed(2)}` : "—";
}

function cardImage(card) {
  const src = safeSrc(card.image);
  if (!src) return null;
  const img = el("img");
  img.src = src;
  img.alt = card.name;
  return img;
}

function buildCardTile(card) {
  const tier = normalizeRarity(card.rarity);
  const glow = RARITY_COLORS[tier];

  const tile = el("article", "tcg-card");
  tile.dataset.rarity = tier;
  tile.style.setProperty("--glow-color", glow);
  tile.tabIndex = 0; // keyboard users can open a card too
  tile.setAttribute("role", "button");
  tile.setAttribute("aria-label", `${card.name}, ${card.rarity}. Show details`);

  const wrap = el("div", "tcg-card__art-wrap");
  const img = cardImage(card);
  if (img) { img.loading = "lazy"; wrap.append(img); }

  const gem = el("span", "rarity-gem", card.rarity);
  gem.style.setProperty("--glow-color", glow);
  const meta = el("div", "tcg-card__meta");
  meta.append(gem, el("span", "tcg-card__price", card.prices ? formatPrice(card.prices.market) : "—"));

  tile.append(wrap, el("h3", "", card.name), meta);
  tile.addEventListener("click", () => renderDetail(card));
  tile.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") { e.preventDefault(); renderDetail(card); }
  });
  return tile;
}

function priceTable(prices) {
  const table = el("table", "price-table");
  const head = el("thead");
  const headRow = el("tr");
  headRow.append(el("th", "", "Condition (approx.)"), el("th", "", "Price"));
  head.append(headRow);
  const body = el("tbody");
  [
    ["Damaged / Heavily Played", prices.low],
    ["Lightly Played", prices.mid],
    ["Near Mint (market avg.)", prices.market],
    ["Mint / Gem Mint", prices.high]
  ].forEach(([label, value]) => {
    const row = el("tr");
    row.append(el("td", "", label), el("td", "value", formatPrice(value)));
    body.append(row);
  });
  table.append(head, body);
  return table;
}

function renderDetail(card) {
  const tier = normalizeRarity(card.rarity);
  const glow = RARITY_COLORS[tier];

  const detail = el("div", "card-detail glass");
  detail.style.setProperty("--glow-color", glow);
  const img = cardImage(card);
  if (img) detail.append(img);

  const info = el("div");
  const title = el("h2", "", card.name);
  title.style.marginBottom = "6px";
  const setName = el("p", "", card.set);
  setName.style.marginBottom = "8px";
  const tag = el("span", `rarity-tag rarity-${tier}`, card.rarity);
  info.append(title, setName, tag);

  if (!card.prices) {
    const none = el("p", "empty-state", "No market pricing available for this card yet.");
    none.style.cssText = "padding:16px 0 0; text-align:left;";
    info.append(none);
  } else {
    tag.style.marginBottom = "18px";
    const note = el("p", "", "Condition labels are an approximation — TCGplayer reports price tiers (low/mid/market/high), not graded conditions directly.");
    note.style.cssText = "font-size:0.75rem; margin-top:12px;";
    info.append(priceTable(card.prices), note);
  }

  detail.append(info);
  detailSlot.replaceChildren(detail);
  detailSlot.scrollIntoView({ behavior: "smooth", block: "center" });
}

function buildSkeletons(count) {
  grid.replaceChildren();
  for (let i = 0; i < count; i++) {
    grid.appendChild(el("div", "poke-card poke-card--skeleton"));
  }
}

function stateMessage(title, text) {
  const box = el("div", "state-message");
  box.style.gridColumn = "1 / -1";
  box.append(el("h3", "", title), el("p", "", text));
  return box;
}

async function runSearch(query) {
  const trimmed = query.trim();
  if (!trimmed) {
    toast("Type a card name first.", "error");
    return;
  }

  detailSlot.replaceChildren();
  buildSkeletons(8);

  try {
    const cards = await searchCards(trimmed);
    grid.replaceChildren();

    if (cards.length === 0) {
      // The search text goes in as text, so something like <script> is shown, never run.
      grid.append(stateMessage(`No cards found for "${trimmed}"`, "Try a different spelling or a shorter search term."));
      return;
    }

    cards.forEach((card) => grid.appendChild(buildCardTile(card)));
    renderDetail(cards[0]);
  } catch (err) {
    grid.replaceChildren(stateMessage("Couldn't reach the card database", "The Pokémon TCG API might be rate-limiting or unreachable — try again shortly."));
    toast("Card search failed.", "error");
  }
}

document.getElementById("card-search-form").addEventListener("submit", (event) => {
  event.preventDefault();
  runSearch(document.getElementById("card-search-input").value);
});

initParkedPage();
