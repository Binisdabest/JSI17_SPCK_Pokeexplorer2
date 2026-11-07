// Leaderboard: top players per game, or everything added together.
import { games } from "../games/registry.js";
import * as store from "../core/store.js";
import { el, initUI } from "../core/ui.js";
import { onUser } from "../core/auth.js";

initUI();

const tabs = document.getElementById("board-tabs");
const list = document.getElementById("board-list");
const you = document.getElementById("board-you");
const playable = games.filter((g) => g.ready);
let current = "all", user = null, token = 0;

function row(rank, name, score, extra, isMe, uid) {
  const r = el("div", "board-row" + (isMe ? " board-row--me" : ""));
  const nameCell = el("span", "board-name");
  if (uid) { const a = el("a", "board-link", name); a.href = "trainer.html?uid=" + encodeURIComponent(uid); nameCell.append(a); }
  else nameCell.append(name);
  if (extra) nameCell.append(el("small", "", extra));
  r.append(el("span", "board-rank" + (rank <= 3 ? " board-rank--" + rank : ""), "#" + rank), nameCell, el("span", "board-score", score.toLocaleString()));
  return r;
}

function message(text, withLogin) {
  const box = el("div", "board-state", text);
  if (withLogin) { const a = el("a", "btn btn--primary", "Log in"); a.href = "login.html"; box.append(a); }
  list.replaceChildren(box);
}

async function load(force = false) {
  const mine = ++token;
  you.hidden = true;
  message("Loading scores...");
  let rows;
  try { rows = await store.fetchAllScores(force); }
  catch (e) {
    console.warn(e);
    if (mine === token) message("Could not load the leaderboard. Check your connection, and that Firestore is enabled with the rules published.");
    return;
  }
  if (mine !== token) return; // another tab was clicked while loading
  const board = store.boardFor(rows, current);
  if (!board.length) return message("No scores yet. Be the first!", !user);

  const head = el("div", "board-row board-row--head");
  head.append(el("span", "", "Rank"), el("span", "", "Player"), el("span", "", "Score"));
  list.replaceChildren(head, ...board.slice(0, 50).map((p, i) =>
    row(i + 1, p.name, p.score, current === "all" ? `${p.games} ${p.games === 1 ? "game" : "games"}` : "", user && p.uid === user.uid, p.uid)));

  if (user) {
    const at = board.findIndex((p) => p.uid === user.uid);
    you.textContent = at >= 0 ? `You are #${at + 1} of ${board.length}.` : "You have no score here yet. Play a game to join the board.";
    you.hidden = false;
  }
}

function select(id) {
  current = id;
  tabs.querySelectorAll(".chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === id)));
  load();
}

[["all", "All games"], ...playable.map((g) => [g.id, g.name])].forEach(([id, label]) => {
  const chip = el("button", "chip", label);
  chip.type = "button";
  chip.dataset.id = id;
  chip.setAttribute("aria-pressed", String(id === current));
  chip.addEventListener("click", () => select(id));
  tabs.append(chip);
});

onUser((u) => { user = u; load(); });
