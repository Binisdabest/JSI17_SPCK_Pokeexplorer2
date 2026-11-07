// Emoji Riddle: five riddles per run. Fewer tries means more points.
import { getAllNames, artworkUrl } from "../core/api.js";
import { namePicker, showEnd, shuffle, pretty } from "./common.js";

const RIDDLES = [
  ["pikachu", "⚡🐭"], ["charizard", "🔥🐉"], ["bulbasaur", "🌱🐸"], ["squirtle", "💧🐢"],
  ["jigglypuff", "🎤🎈"], ["snorlax", "😴🍙"], ["gengar", "👻😈"], ["magikarp", "🐟💦"],
  ["psyduck", "🦆🤕"], ["meowth", "🐱💰"], ["eevee", "🦊🧬"], ["onix", "🪨🐍"],
  ["gyarados", "🌊🐲"], ["vulpix", "🦊🔥"], ["zubat", "🦇👀"], ["machop", "💪🥋"],
  ["abra", "🔮💤"], ["caterpie", "🐛🍃"], ["lapras", "🐢🚢"], ["ponyta", "🐴🔥"],
  ["togepi", "🥚🍀"], ["lucario", "🐺🥋"], ["mewtwo", "🧬🧠"], ["geodude", "🪨✊"]
];
const ROUNDS = 5, POINTS = [100, 60, 30];
let alive = false;

export async function init(container, { store, ui }) {
  alive = true;
  const { el } = ui;
  container.replaceChildren(el("p", "game-note", "Loading..."));
  let names;
  try { names = await getAllNames(); } catch { container.replaceChildren(el("p", "game-note", "Could not reach PokéAPI. Reload to try again.")); return; }
  if (!alive) return;

  function run() {
    const deck = shuffle(RIDDLES).slice(0, ROUNDS);
    let round = 0, score = 0;

    function next() {
      if (!alive) return;
      if (round >= ROUNDS) {
        container.replaceChildren();
        return showEnd({ store, gameId: "emoji-riddle", container, title: "All done!", text: `You solved the riddles for ${score} points.`, score, again: run });
      }
      const [answer, clue] = deck[round];
      let tries = 0, over = false;
      const status = el("p", "game-status", `Riddle ${round + 1} of ${ROUNDS}   |   Score ${score}`);
      const riddle = el("div", "er-clue", clue);
      riddle.setAttribute("aria-label", "Emoji clue");
      const hint = el("p", "game-note", "Which Pokémon is hiding in these emoji?");
      const result = el("div");
      const picker = namePicker(names, ui, (guess) => {
        if (over) return;
        if (guess === answer) return finish(true);
        tries++;
        if (tries >= 3) return finish(false);
        hint.textContent = tries === 1
          ? `Nope. Hint: ${answer.length} letters.`
          : `Nope. Hint: it starts with "${answer[0].toUpperCase()}" and has ${answer.length} letters.`;
        picker.focus();
      });
      function finish(won) {
        over = true;
        picker.setDisabled(true);
        const gained = won ? POINTS[tries] : 0;
        score += gained;
        hint.textContent = won ? `Correct! +${gained} points` : `Out of tries.`;
        const art = el("img", "er-art"); art.src = artworkUrl(names.indexOf(answer) + 1); art.alt = pretty(answer);
        const nextBtn = el("button", "btn btn--primary", round + 1 >= ROUNDS ? "See results" : "Next riddle");
        nextBtn.addEventListener("click", () => { round++; next(); });
        result.append(art, el("p", "game-status", pretty(answer)), nextBtn);
        nextBtn.focus();
      }
      container.replaceChildren(status, riddle, hint, picker.root, result);
      picker.focus();
    }
    next();
  }
  run();
}

export function destroy() { alive = false; }
