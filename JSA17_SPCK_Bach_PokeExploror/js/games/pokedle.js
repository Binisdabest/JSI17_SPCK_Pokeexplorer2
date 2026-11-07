// Pokédle: guess the mystery Pokémon in six tries. Each guess shows how its clues compare.
import { getSimplifiedPokemon, getAllNames, artworkUrl } from "../core/api.js";
import { dailyId, randomId, namePicker, showEnd, pretty } from "./common.js";

const MAX_GUESSES = 6;
const GEN_ENDS = [151, 251, 386, 493, 649, 721, 809, 905, 1025];
const gen = (id) => GEN_ENDS.findIndex((end) => id <= end) + 1;
const total = (p) => Object.values(p.stats).reduce((a, b) => a + b, 0);
const COLUMNS = ["Type 1", "Type 2", "Gen", "Height", "Weight", "Stats"];

let alive = false;

function numeric(g, t, fmt = String) {
  if (g === t) return { cls: "ok", text: fmt(g) };
  return { cls: "no", text: fmt(g) + (t > g ? " ▲" : " ▼") };
}

function cells(g, t) {
  const g2 = g.types[1] || "none", t2 = t.types[1] || "none";
  return [
    { cls: g.types[0] === t.types[0] ? "ok" : t.types.includes(g.types[0]) ? "near" : "no", text: g.types[0] },
    { cls: g2 === t2 ? "ok" : g2 !== "none" && t.types.includes(g2) ? "near" : "no", text: g2 },
    numeric(gen(g.id), gen(t.id), (v) => "Gen " + v),
    numeric(g.height, t.height, (v) => v + " m"),
    numeric(g.weight, t.weight, (v) => v + " kg"),
    numeric(total(g), total(t))
  ];
}

export async function init(container, { store, ui }) {
  alive = true;
  const { el } = ui;
  container.replaceChildren(el("p", "game-note", "Loading the Pokédex..."));
  let names;
  try { names = await getAllNames(); } catch { container.replaceChildren(el("p", "game-note", "Could not reach PokéAPI. Check your connection and reload.")); return; }
  if (!alive) return;

  let useDaily = true;

  async function start() {
    const targetId = useDaily ? dailyId(1) : randomId();
    let target, tries = 0, over = false;
    container.replaceChildren(el("p", "game-note", "Picking a mystery Pokémon..."));
    try { target = await getSimplifiedPokemon(targetId); } catch { container.replaceChildren(el("p", "game-note", "Could not load a Pokémon. Reload to try again.")); return; }
    if (!alive) return;

    const intro = el("p", "game-note", (useDaily ? "Today's mystery Pokémon. " : "A random mystery Pokémon. ") + "Green is a match, yellow is the right type in the wrong slot, ▲ ▼ show which way the answer lies.");
    const status = el("p", "game-status", `Guesses left: ${MAX_GUESSES}`);
    const board = el("div", "pk-board");
    const head = el("div", "pk-row pk-row--head");
    ["Pokémon", ...COLUMNS].forEach((c) => head.append(el("span", "", c)));
    board.append(head);
    const end = el("div");

    const picker = namePicker(names, ui, async (name) => {
      if (over) return;
      picker.setDisabled(true);
      let guess;
      try { guess = await getSimplifiedPokemon(name); } catch { ui.toast("Could not load that Pokémon.", "error"); picker.setDisabled(false); return; }
      if (!alive) return;
      tries++;
      const row = el("div", "pk-row");
      const who = el("span", "pk-who");
      const img = el("img"); img.src = guess.artwork; img.alt = ""; img.width = 44; img.height = 44;
      who.append(img, el("b", "", pretty(guess.name)));
      row.append(who);
      cells(guess, target).forEach((c) => row.append(el("span", "pk-cell pk-cell--" + c.cls, pretty(c.text))));
      board.append(row);
      status.textContent = `Guesses left: ${MAX_GUESSES - tries}`;

      const won = guess.id === target.id;
      if (won || tries >= MAX_GUESSES) {
        over = true;
        const reveal = el("div", "reveal");
        const art = el("img"); art.src = target.artwork || artworkUrl(target.id); art.alt = pretty(target.name);
        reveal.append(art);
        end.append(reveal);
        await showEnd({
          store, gameId: "pokedle", container: end,
          title: won ? "You got it!" : "Out of guesses",
          text: won ? `${pretty(target.name)} in ${tries} ${tries === 1 ? "try" : "tries"}.` : `It was ${pretty(target.name)}.`,
          score: won ? (MAX_GUESSES + 1 - tries) * 100 : 0,
          again: () => { useDaily = false; start(); }
        });
      } else { picker.setDisabled(false); picker.focus(); }
    });

    container.replaceChildren(intro, status, picker.root, board, end);
    picker.focus();
  }
  start();
}

export function destroy() { alive = false; }
