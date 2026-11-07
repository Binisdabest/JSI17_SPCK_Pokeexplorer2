// Homepage: draws the game grid from the registry and wires up search + category chips.
import { games } from "../games/registry.js";
import { el, initUI } from "../core/ui.js";

initUI();

const grid = document.getElementById("game-grid");
const chipBox = document.getElementById("game-chips");
const searchBox = document.getElementById("game-search");
const empty = document.getElementById("game-empty");
let category = "All";

function card(game) {
  const node = el(game.ready ? "a" : "div", "game-card" + (game.ready ? "" : " game-card--soon"));
  if (game.ready) node.href = "game.html?id=" + game.id;

  const thumb = el("div", "game-card__thumb");
  const pic = el("img");
  pic.src = game.image;
  pic.alt = "";
  pic.loading = "lazy";
  thumb.append(pic);
  thumb.style.setProperty("--c", game.color);
  thumb.setAttribute("aria-hidden", "true");

  const tags = el("div", "game-card__tags");
  if (game.label) tags.append(el("span", "game-tag game-tag--" + game.label.toLowerCase(), game.label));
  if (!game.ready) tags.append(el("span", "game-tag game-tag--soon", "SOON"));
  const top = el("div", "game-card__top");
  top.append(el("h3", "", game.name), tags);

  const cats = el("div", "game-card__cats");
  game.categories.forEach((c) => cats.append(el("span", "", c)));

  const body = el("div", "game-card__body");
  body.append(top, el("p", "game-card__desc", game.description), cats);
  node.append(thumb, body);
  return node;
}

function render() {
  const q = searchBox.value.trim().toLowerCase();
  const list = games.filter((g) =>
    (category === "All" || g.categories.includes(category)) &&
    (g.name + " " + g.description).toLowerCase().includes(q));
  grid.replaceChildren(...list.map(card));
  empty.hidden = list.length > 0;
}

["All", ...new Set(games.flatMap((g) => g.categories))].forEach((name) => {
  const chip = el("button", "chip", name);
  chip.setAttribute("aria-pressed", String(name === category));
  chip.addEventListener("click", () => {
    category = name;
    chipBox.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
    render();
  });
  chipBox.append(chip);
});

searchBox.addEventListener("input", render);
render();
