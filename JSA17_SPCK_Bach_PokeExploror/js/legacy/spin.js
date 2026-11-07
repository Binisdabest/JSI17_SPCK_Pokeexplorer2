/* ==========================================================
   spin.js  (Lucky Spin, parked page games.html)
   All dynamic text and images are built with el() / DOM APIs, never innerHTML.
   ========================================================== */

import { getSimplifiedPokemon, RARITY_COLORS } from "../core/api.js";
import { spendPoints, addPoints, addToCollection } from "../core/storage.js";
import { el, safeSrc, toast, renderNavPoints } from "../core/ui.js";
import { initParkedPage, trainerChanged } from "./parked.js";
import { ECONOMY_MODE } from "../economy/config.js";

const SPIN_COST = 500;

/* Curated pools — PokéAPI has no real "rarity" field, so rarity
   here is a hand-picked list per tier, not derived from the API. */
const POOLS = {
  common: { label: "Common", weight: 45, ids: [10, 13, 16, 19, 41, 52, 60, 74, 98, 129] },
  uncommon: { label: "Uncommon", weight: 25, ids: [1, 4, 7, 25, 37, 58, 63, 66, 120, 133] },
  rare: { label: "Rare", weight: 15, ids: [2, 5, 8, 38, 59, 65, 130, 131] },
  "ultra-rare": { label: "Ultra Rare", weight: 8, ids: [3, 6, 9, 68, 94, 149] },
  legendary: { label: "Legendary", weight: 4.5, ids: [144, 145, 146, 243, 244, 245] },
  mythical: { label: "Mythical", weight: 1, ids: [151, 251, 385, 492] }
};

const BONUS_POINTS_WEIGHT = 1;
const FREE_SPIN_WEIGHT = 0.5;

initParkedPage();

const orb = document.getElementById("spin-orb");
const button = document.getElementById("spin-button");
const rewardEl = document.getElementById("spin-reward");
const costLabel = document.getElementById("spin-cost-value");

costLabel.textContent = SPIN_COST;
rewardEl.setAttribute("aria-live", "polite");

let spinning = false;

// Lucky Spin picks its rewards in the browser, which a trusted economy must never accept. It stays a prototype-mode toy.
if (ECONOMY_MODE === "trusted") {
  button.disabled = true;
  rewardEl.style.display = "";
  rewardEl.textContent = "Lucky Spin is a prototype and is switched off while PokéPoints are kept on the server. Pack opening replaces it in a later update.";
}

function weightedRoll() {
  const entries = [
    ...Object.entries(POOLS).map(([key, tier]) => ({ key, weight: tier.weight })),
    { key: "bonus", weight: BONUS_POINTS_WEIGHT },
    { key: "freeSpin", weight: FREE_SPIN_WEIGHT }
  ];

  const total = entries.reduce((sum, e) => sum + e.weight, 0);
  let roll = Math.random() * total;

  for (const entry of entries) {
    if (roll < entry.weight) return entry.key;
    roll -= entry.weight;
  }
  return entries[0].key; // fallback, should never hit
}

function launchConfetti() {
  const colors = ["#E63950", "#8B5CF6", "#FFD23F", "#EDEFF7"];
  for (let i = 0; i < 26; i++) {
    const piece = document.createElement("div");
    piece.className = "confetti-piece";
    piece.style.left = `${Math.random() * 100}vw`;
    piece.style.background = colors[Math.floor(Math.random() * colors.length)];
    piece.style.animationDelay = `${Math.random() * 0.3}s`;
    document.body.appendChild(piece);
    setTimeout(() => piece.remove(), 2800);
  }
}

/** Fills the reward panel. `key` is one of our own rarity keys (never user data); everything else is set as text. */
function showReward({ key, tag, title, text, art = null, artAlt = "", capitalize = false }) {
  rewardEl.replaceChildren();
  rewardEl.style.display = "block";
  rewardEl.dataset.rarity = key;
  rewardEl.style.setProperty("--glow-color", RARITY_COLORS[key] || RARITY_COLORS.common);

  rewardEl.append(el("span", `rarity-tag rarity-${key}`, tag));
  const src = safeSrc(art);
  if (src) {
    const img = el("img");
    img.src = src;
    img.alt = artAlt;
    rewardEl.append(img);
  }
  const heading = el("h3", "", title);
  if (capitalize) heading.style.textTransform = "capitalize";
  rewardEl.append(heading, el("p", "", text));

  rewardEl.classList.remove("is-revealing");
  void rewardEl.offsetWidth; // restart the reveal animation
  rewardEl.classList.add("is-revealing");
}

async function revealPokemonReward(rarityKey) {
  const tier = POOLS[rarityKey];
  const id = tier.ids[Math.floor(Math.random() * tier.ids.length)];
  const pokemon = await getSimplifiedPokemon(id); // may throw: the caller refunds the spin

  addToCollection({
    id: pokemon.id,
    name: pokemon.name,
    types: pokemon.types,
    artwork: pokemon.artwork,
    rarity: tier.label
  });
  trainerChanged();

  showReward({
    key: rarityKey, tag: tier.label, title: pokemon.name, text: "Added to your collection.",
    art: pokemon.artwork, artAlt: pokemon.name, capitalize: true
  });

  const share = el("button", "btn btn--ghost", "Share to Community");
  share.type = "button";
  share.style.marginTop = "14px";
  share.addEventListener("click", async () => {
    const { openShare } = await import("../community/share.js"); // loaded only when someone shares
    const label = pokemon.name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    openShare({
      attachment: { kind: "pokemon", id: pokemon.id, name: pokemon.name, rarity: tier.label, from: "spin" },
      text: `Just pulled ${label} (${tier.label}) from Lucky Spin!`,
      title: "Share your pull"
    });
  });
  rewardEl.append(share);

  if (rarityKey === "legendary" || rarityKey === "mythical" || rarityKey === "ultra-rare") {
    launchConfetti();
  }
  toast(`You got ${pokemon.name}! (${tier.label})`, "success");
}

function revealBonusPoints() {
  const amount = [200, 300, 500, 800][Math.floor(Math.random() * 4)];
  addPoints(amount);
  renderNavPoints();
  trainerChanged();
  showReward({ key: "legendary", tag: "Bonus", title: `+${amount} PokéPoints!`, text: "Lucky roll — straight into your balance." });
  toast(`Bonus! +${amount} PokéPoints`, "success");
}

function revealFreeSpin() {
  addPoints(SPIN_COST); // refund this spin's cost, effectively making it free
  renderNavPoints();
  trainerChanged();
  showReward({ key: "rare", tag: "Free Spin", title: "This one's on the house", text: `Your ${SPIN_COST} PokéPoints were refunded.` });
  toast("Free spin — your points were refunded!", "success");
}

async function spin() {
  if (spinning || ECONOMY_MODE === "trusted") return;

  if (!spendPoints(SPIN_COST)) {
    toast(`You need ${SPIN_COST} PokéPoints to spin.`, "error");
    return;
  }

  spinning = true;
  button.disabled = true;
  renderNavPoints();
  rewardEl.style.display = "none";

  orb.classList.remove("is-spinning");
  void orb.offsetWidth; // restart the CSS animation
  orb.classList.add("is-spinning");

  const outcome = weightedRoll();

  setTimeout(async () => {
    try {
      if (outcome === "bonus") revealBonusPoints();
      else if (outcome === "freeSpin") revealFreeSpin();
      else await revealPokemonReward(outcome);
    } catch (err) {
      // Nothing was added to the collection, so give the points back instead of keeping them.
      addPoints(SPIN_COST);
      renderNavPoints();
      toast("The reward couldn't be loaded, so your points were refunded. Try again.", "error");
    } finally {
      trainerChanged();
      spinning = false;
      button.disabled = false;
    }
  }, 3200);
}

button.addEventListener("click", spin);
