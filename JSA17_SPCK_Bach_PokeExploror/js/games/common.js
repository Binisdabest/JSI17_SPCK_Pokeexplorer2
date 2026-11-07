// Small helpers shared by the games.
import { el } from "../core/ui.js";
import { MAX_DEX_ID } from "../core/api.js";

export const randomId = () => Math.floor(Math.random() * MAX_DEX_ID) + 1;
export const pretty = (name) => name.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const shuffle = (list) => {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
};

/** Same Pokédex number for everyone on the same calendar day. */
export function dailyId(salt) {
  const day = Math.floor(Date.now() / 86400000) + salt;
  let t = (day * 2654435761) >>> 0;
  t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) % MAX_DEX_ID + 1;
}

/** Name box with autocomplete. Calls onSubmit(name) only for real Pokémon names. */
export function namePicker(names, ui, onSubmit) {
  const set = new Set(names);
  const form = el("form", "picker");
  const input = el("input", "picker__input");
  input.setAttribute("list", "dex-names");
  input.placeholder = "Type a Pokémon name";
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Pokémon name");
  let list = document.getElementById("dex-names");
  if (!list) {
    list = el("datalist");
    list.id = "dex-names";
    names.forEach((n) => { const o = document.createElement("option"); o.value = n; list.append(o); });
    document.body.append(list);
  }
  const btn = el("button", "btn btn--primary", "Guess");
  btn.type = "submit";
  form.append(input, btn);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const value = input.value.trim().toLowerCase().replace(/\s+/g, "-");
    if (!set.has(value)) return ui.toast("Pick a Pokémon from the list.", "error");
    input.value = "";
    onSubmit(value);
  });
  return { root: form, focus: () => input.focus(), setDisabled: (d) => { input.disabled = d; btn.disabled = d; } };
}

/** Saves the score and shows the end-of-run card. */
export async function showEnd({ store, gameId, container, title, text, score, again }) {
  const result = await store.saveScore(gameId, score);
  const card = el("div", "end-card");
  card.append(el("h2", "", title), el("p", "end-card__text", text), el("div", "end-card__score", String(score)));
  card.append(el("p", "end-card__best", result.isBest && score > 0 ? "New best!" : "Best: " + result.best));
  const row = el("div", "end-card__actions");
  const playAgain = el("button", "btn btn--primary", "Play again");
  playAgain.addEventListener("click", again);
  const back = el("a", "btn btn--ghost", "All games");
  back.href = "index.html#games";
  row.append(playAgain, back);
  card.append(row);
  container.append(card);
  card.scrollIntoView({ behavior: "smooth", block: "nearest" });
}
