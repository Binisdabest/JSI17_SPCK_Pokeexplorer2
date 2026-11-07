// game.html?id=<game id>: loads that game's module from js/games/ and runs it.
import { games } from "../games/registry.js";
import * as api from "../core/api.js";
import * as store from "../core/store.js";
import { el, toast, initUI } from "../core/ui.js";
import { onUser } from "../core/auth.js";

initUI();

const root = document.getElementById("game-root");
const bestEl = document.getElementById("game-best");
const game = games.find((g) => g.id === new URLSearchParams(location.search).get("id") && g.ready);

if (!game) {
  document.getElementById("game-title").textContent = "Game not found";
  root.append(el("p", "game-note", "That game doesn't exist yet."));
  const back = el("a", "btn btn--primary", "Back to games");
  back.href = "index.html#games";
  root.append(back);
} else {
  document.title = game.name + " | PokéExplorer";
  document.getElementById("game-title").textContent = game.name;
  document.getElementById("game-desc").textContent = game.description;
  const showBest = () => (bestEl.textContent = store.getBest(game.id).toLocaleString());
  showBest();
  window.addEventListener("scores-changed", showBest);
  onUser((user) => (document.getElementById("game-guest").hidden = !!user));

  import(`../games/${game.id}.js`)
    .then((mod) => {
      mod.init(root, { api, store, ui: { el, toast } });
      window.addEventListener("pagehide", () => mod.destroy());
    })
    .catch((e) => {
      console.error(e);
      root.replaceChildren(el("p", "game-note", "This game failed to load. Try reloading the page."));
    });
}
