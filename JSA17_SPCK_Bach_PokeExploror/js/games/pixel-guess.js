// Pixel Guess: name the Pokémon from a blocky picture. Every wrong guess sharpens it.
import { getAllNames, artworkUrl } from "../core/api.js";
import { randomId, namePicker, showEnd, pretty } from "./common.js";

const SIZES = [6, 10, 16, 28, 56]; // picture is drawn this many pixels wide, then enlarged
const SIDE = 360;
let alive = false;

export async function init(container, { store, ui }) {
  alive = true;
  const { el } = ui;
  container.replaceChildren(el("p", "game-note", "Loading..."));
  let names;
  try { names = await getAllNames(); } catch { container.replaceChildren(el("p", "game-note", "Could not reach PokéAPI. Reload to try again.")); return; }

  async function start() {
    if (!alive) return;
    const id = randomId(), answer = names[id - 1];
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.src = artworkUrl(id);
    try { await img.decode(); } catch { container.replaceChildren(el("p", "game-note", "Could not load the picture. Reload to try again.")); return; }
    if (!alive) return;

    const canvas = el("canvas", "px-canvas");
    canvas.width = canvas.height = SIDE;
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "A blocky picture of a mystery Pokémon");
    const ctx = canvas.getContext("2d");
    function draw(size) {
      ctx.clearRect(0, 0, SIDE, SIDE);
      if (!size) { ctx.imageSmoothingEnabled = true; ctx.drawImage(img, 0, 0, SIDE, SIDE); return; }
      const small = document.createElement("canvas");
      small.width = small.height = size;
      small.getContext("2d").drawImage(img, 0, 0, size, size);
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(small, 0, 0, SIDE, SIDE);
    }
    draw(SIZES[0]);

    let wrong = 0, over = false;
    const status = el("p", "game-status", `Guesses left: ${SIZES.length}`);
    const msg = el("p", "game-note", "Who's that Pokémon?");
    const end = el("div");
    const picker = namePicker(names, ui, async (guess) => {
      if (over) return;
      if (guess !== answer) {
        wrong++;
        if (wrong < SIZES.length) {
          draw(SIZES[wrong]);
          status.textContent = `Guesses left: ${SIZES.length - wrong}`;
          msg.textContent = `Not ${pretty(guess)}. The picture just got sharper.`;
          picker.focus();
          return;
        }
      }
      over = true;
      picker.setDisabled(true);
      draw(0);
      const won = guess === answer;
      msg.textContent = "";
      await showEnd({
        store, gameId: "pixel-guess", container: end,
        title: won ? "Got it!" : "Out of guesses",
        text: won ? `It's ${pretty(answer)}!` : `It was ${pretty(answer)}.`,
        score: won ? (SIZES.length - wrong) * 100 : 0, again: start
      });
    });
    container.replaceChildren(status, msg, canvas, picker.root, end);
    picker.focus();
  }
  start();
}

export function destroy() { alive = false; }
