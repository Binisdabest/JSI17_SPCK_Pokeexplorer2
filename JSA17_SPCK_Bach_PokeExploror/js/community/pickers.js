// "Attach something" choosers: a Pokémon from your collection, a badge you earned, or your team.
import { el, toast } from "../core/ui.js";
import { getCollection } from "../core/storage.js";
import { S } from "./state.js";
import { openModal, monThumb, badgeIcon, stateBox, linkButton } from "./view.js";
import { BADGES, loadStats, earnedIds } from "./achievements.js";

const ORDER = ["Mythical", "Legendary", "Ultra Rare", "Rare", "Uncommon", "Common"];

function choose(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    let done = false;
    const pick = (value) => { if (done) return; done = true; resolve(value); modal.close(); };
    const body = el("div", "picker");
    build(body, pick);
    const modal = openModal(title, body, { wide, onClose: () => { if (!done) { done = true; resolve(null); } } });
  });
}

/** Resolves a Pokémon attachment from this browser's collection, or null. */
export function pickPokemon() {
  const coll = [...getCollection()].sort((a, b) => ORDER.indexOf(a.rarity) - ORDER.indexOf(b.rarity));
  return choose("Pick a Pokémon to share", (body, pick) => {
    if (!coll.length) {
      body.append(stateBox("Your collection is empty", "Spin the Lucky Spin to catch your first Pokémon, then come back to show it off.", linkButton("Open Lucky Spin", "games.html")));
      return;
    }
    const grid = el("div", "picker__grid");
    coll.forEach((p) => {
      const b = el("button", "picker__item");
      b.type = "button";
      b.append(monThumb(p, "mon mon--sm"));
      b.addEventListener("click", () => pick({ kind: "pokemon", id: p.id, name: p.name, rarity: p.rarity, from: "collection" }));
      grid.append(b);
    });
    body.append(grid);
  }, { wide: true });
}

/** Resolves a badge attachment from the badges you have earned, or null. */
export async function pickBadge() {
  if (!S.user) return null;
  toast("Checking your badges...", "info");
  const { stats } = await loadStats(S.user.uid, S.doc, S.user);
  const have = new Set(earnedIds(stats));
  return choose("Pick a badge to share", (body, pick) => {
    const list = BADGES.filter((b) => have.has(b.id));
    if (!list.length) {
      body.append(stateBox("No badges yet", "Play a game or collect a Pokémon to earn your first one.", linkButton("Play a game", "index.html#games")));
      return;
    }
    const grid = el("div", "picker__list");
    list.forEach((b) => {
      const row = el("button", "picker__row");
      row.type = "button";
      const text = el("div");
      text.append(el("strong", "", b.name), el("p", "", b.desc));
      row.append(badgeIcon(b), text);
      row.addEventListener("click", () => pick({ kind: "badge", id: b.id }));
      grid.append(row);
    });
    body.append(grid);
  });
}

/** Your team as set on your trainer page, or null (with a hint) when none is set. */
export function teamAttachment() {
  const team = (S.doc?.team || []).filter((m) => m && m.id);
  if (!team.length) {
    toast("Set your team first: open your trainer page and choose Edit profile.", "info");
    return null;
  }
  return { kind: "team", title: (S.doc.username || "My") + "'s team", members: team.slice(0, 6).map((m) => ({ id: m.id, name: m.name })) };
}
