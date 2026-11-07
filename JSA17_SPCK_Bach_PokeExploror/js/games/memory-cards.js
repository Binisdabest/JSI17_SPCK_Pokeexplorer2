// Memory Cards: flip cards and match the Pokémon pairs in as few moves as you can.
import { getAllNames, artworkUrl, MAX_DEX_ID } from "../core/api.js";
import { shuffle, showEnd, pretty } from "./common.js";

const PAIRS = 8;
let timer = null, flipBack = null, alive = false;

export async function init(container, { store, ui }) {
  alive = true;
  const { el } = ui;
  container.replaceChildren(el("p", "game-note", "Shuffling cards..."));
  let names;
  try { names = await getAllNames(); } catch { container.replaceChildren(el("p", "game-note", "Could not reach PokéAPI. Reload to try again.")); return; }
  if (!alive) return;

  function start() {
    clearInterval(timer);
    const ids = shuffle(Array.from({ length: MAX_DEX_ID }, (_, i) => i + 1)).slice(0, PAIRS);
    ids.forEach((id) => { new Image().src = artworkUrl(id); }); // warm the cache so flips are instant
    let moves = 0, matched = 0, seconds = 0, open = [], busy = false;

    const status = el("p", "game-status", "Moves: 0   |   Time: 0s");
    const grid = el("div", "mem-grid");
    const end = el("div");
    const update = () => (status.textContent = `Moves: ${moves}   |   Time: ${seconds}s`);

    shuffle([...ids, ...ids]).forEach((id) => {
      const card = el("button", "mem-card");
      card.type = "button";
      card.setAttribute("aria-label", "Hidden card");
      const inner = el("span", "mem-card__inner");
      const back = el("span", "mem-card__face mem-card__back");
      const front = el("span", "mem-card__face mem-card__front");
      const img = el("img"); img.src = artworkUrl(id); img.alt = pretty(names[id - 1]);
      front.append(img);
      inner.append(back, front);
      card.append(inner);
      card.addEventListener("click", async () => {
        if (busy || card.classList.contains("is-flipped")) return;
        if (!timer) timer = setInterval(() => { seconds++; update(); }, 1000);
        card.classList.add("is-flipped");
        card.setAttribute("aria-label", pretty(names[id - 1]));
        open.push({ card, id });
        if (open.length < 2) return;
        moves++; update(); busy = true;
        const [a, b] = open; open = [];
        if (a.id === b.id) {
          a.card.classList.add("is-matched"); b.card.classList.add("is-matched");
          busy = false; matched++;
          if (matched === PAIRS) {
            clearInterval(timer); timer = null;
            await showEnd({
              store, gameId: "memory-cards", container: end, title: "All pairs found!",
              text: `${moves} moves in ${seconds} seconds.`,
              score: Math.max(50, 1000 - (moves - PAIRS) * 25 - seconds * 2), again: start
            });
          }
        } else {
          flipBack = setTimeout(() => {
            [a, b].forEach((x) => { x.card.classList.remove("is-flipped"); x.card.setAttribute("aria-label", "Hidden card"); });
            busy = false;
          }, 800);
        }
      });
      grid.append(card);
    });
    container.replaceChildren(el("p", "game-note", "Flip two cards at a time. Match all eight pairs."), status, grid, end);
  }
  start();
}

export function destroy() { alive = false; clearInterval(timer); clearTimeout(flipBack); timer = null; }
