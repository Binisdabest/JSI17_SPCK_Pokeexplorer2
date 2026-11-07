// Higher or Lower: is the hidden Pokémon's stat higher or lower? One wrong answer ends the streak.
import { getSimplifiedPokemon } from "../core/api.js";
import { randomId, showEnd, pretty } from "./common.js";

const STATS = [
  ["hp", "HP"], ["attack", "Attack"], ["defense", "Defense"], ["speed", "Speed"],
  ["total", "total base stats"], ["height", "height"], ["weight", "weight"]
];
const value = (p, key) =>
  key === "total" ? Object.values(p.stats).reduce((a, b) => a + b, 0) : key === "height" || key === "weight" ? p[key] : p.stats[key];
const show = (key, v) => (key === "height" ? v + " m" : key === "weight" ? v + " kg" : String(v));
const pickStat = () => STATS[Math.floor(Math.random() * STATS.length)];

let alive = false;

export async function init(container, { store, ui }) {
  alive = true;
  const { el } = ui;

  async function nextChallenger(a, key, pending) {
    for (let i = 0; i < 6; i++) {
      const b = i === 0 && pending ? await pending : await getSimplifiedPokemon(randomId());
      if (b && b.id !== a.id && value(b, key[0]) !== value(a, key[0])) return b;
    }
    throw new Error("no challenger");
  }

  async function run() {
    let streak = 0;
    container.replaceChildren(el("p", "game-note", "Finding challengers..."));
    let a, b, key = pickStat(), pending;
    try {
      a = await getSimplifiedPokemon(randomId());
      b = await nextChallenger(a, key);
    } catch { container.replaceChildren(el("p", "game-note", "Could not reach PokéAPI. Reload to try again.")); return; }

    while (alive) {
      pending = getSimplifiedPokemon(randomId()).catch(() => null); // preload the next challenger
      const answer = await playRound(a, b, key, streak);
      if (!alive) return;
      if (!answer.correct) {
        await showEnd({
          store, gameId: "higher-lower", container, title: "Streak over",
          text: `${pretty(b.name)} had ${show(key[0], value(b, key[0]))} ${key[1]}. You reached a streak of ${streak}.`,
          score: streak, again: run
        });
        return;
      }
      streak++;
      await new Promise((r) => setTimeout(r, 1200));
      if (!alive) return;
      a = b; key = pickStat();
      try { b = await nextChallenger(a, key, pending); } catch { b = await nextChallenger(a, key); }
    }
  }

  function playRound(a, b, key, streak) {
    return new Promise((resolve) => {
      const card = (p, shown) => {
        const c = el("div", "hl-card");
        const img = el("img"); img.src = p.artwork; img.alt = pretty(p.name);
        c.append(img, el("h3", "", pretty(p.name)), el("div", "hl-value", shown));
        return c;
      };
      const left = card(a, show(key[0], value(a, key[0])));
      const right = card(b, "?");
      const valueEl = right.querySelector(".hl-value");
      const buttons = el("div", "hl-buttons");
      const higher = el("button", "btn btn--primary", "Higher");
      const lower = el("button", "btn btn--ghost", "Lower");
      buttons.append(higher, lower);
      const arena = el("div", "hl-arena");
      arena.append(left, el("div", "vs-badge", "VS"), right);
      container.replaceChildren(
        el("p", "game-status", "Streak: " + streak),
        el("p", "game-note", `Is ${pretty(b.name)}'s ${key[1]} higher or lower than ${pretty(a.name)}'s?`),
        arena, buttons
      );
      const answer = (wantHigher) => {
        higher.disabled = lower.disabled = true;
        const correct = wantHigher ? value(b, key[0]) > value(a, key[0]) : value(b, key[0]) < value(a, key[0]);
        valueEl.textContent = show(key[0], value(b, key[0]));
        right.classList.add(correct ? "is-correct" : "is-wrong");
        resolve({ correct });
      };
      higher.addEventListener("click", () => answer(true));
      lower.addEventListener("click", () => answer(false));
    });
  }

  run();
}

export function destroy() { alive = false; }
