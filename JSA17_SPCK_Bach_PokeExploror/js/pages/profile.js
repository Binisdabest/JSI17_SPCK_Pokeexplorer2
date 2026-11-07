// Profile: who you are, your score per game, and your rank.
import { games } from "../games/registry.js";
import * as store from "../core/store.js";
import { el, initUI, toast, confirmAction, safeSrc } from "../core/ui.js";
import { onUser, logOut, setDisplayName, displayName } from "../core/auth.js";
import { getAvatarSrc } from "../core/storage.js";
import { walletSection } from "./profile-wallet.js";

initUI();

const root = document.getElementById("profile-root");
const playable = games.filter((g) => g.ready);
let user = null, rows = null; // rows: online scores, or null if they could not be loaded

function summary(items) {
  const strip = el("div", "sum-strip");
  items.forEach(([label, value]) => {
    const box = el("div", "sum");
    box.append(el("span", "", label), el("strong", "", String(value)));
    strip.append(box);
  });
  return strip;
}

function statCards() {
  const local = store.getAllLocal();
  const wrap = el("div", "stat-cards");
  playable.forEach((g) => {
    const mine = local[g.id] || { best: 0, plays: 0 };
    const online = rows ? rows.find((r) => r.uid === user?.uid && r.gameId === g.id) : null;
    const best = Math.max(mine.best, online?.best ?? 0);
    let rank = "";
    if (user && rows && online) rank = "  |  Rank #" + (store.boardFor(rows, g.id).findIndex((p) => p.uid === user.uid) + 1);
    const card = el("a", "stat-card");
    card.href = "game.html?id=" + g.id;
    const pic = el("div", "stat-card__pic");
    pic.style.setProperty("--c", g.color);
    const img = el("img"); img.src = g.image; img.alt = ""; img.loading = "lazy";
    pic.append(img);
    const text = el("div");
    const line = el("p");
    line.append("Best ", el("strong", "", best.toLocaleString()), `  |  Plays ${mine.plays}${rank}`);
    text.append(el("h3", "", g.name), line);
    card.append(pic, text);
    wrap.append(card);
  });
  return wrap;
}

function totals() {
  const local = store.getAllLocal();
  const bests = playable.map((g) => Math.max(local[g.id]?.best ?? 0, rows?.find((r) => r.uid === user?.uid && r.gameId === g.id)?.best ?? 0));
  const items = [
    ["Total score", bests.reduce((a, b) => a + b, 0).toLocaleString()],
    ["Games played", playable.reduce((n, g) => n + (local[g.id]?.plays ?? 0), 0)],
    ["Games tried", bests.filter((b) => b > 0).length + " / " + playable.length]
  ];
  if (user && rows) {
    const at = store.boardFor(rows, "all").findIndex((p) => p.uid === user.uid);
    items.push(["Overall rank", at >= 0 ? "#" + (at + 1) : "-"]);
  }
  return summary(items);
}

function headerCard() {
  const card = el("div", "me-card");
  const avatar = el("img", "me-card__avatar");
  avatar.alt = "";
  const info = el("div", "me-card__info");
  const actions = el("div", "me-card__actions");

  if (!user) {
    avatar.src = getAvatarSrc({ username: "Guest" });
    info.append(el("h2", "", "Guest"), el("p", "", "Your scores are saved in this browser only. Log in to put them on the leaderboard."));
    const login = el("a", "btn btn--primary", "Log in or sign up");
    login.href = "login.html";
    actions.append(login);
  } else {
    avatar.src = safeSrc(user.photoURL) || getAvatarSrc({ username: displayName(user) });
    const nameEl = el("h2", "", displayName(user));
    const joined = user.metadata?.creationTime ? new Date(user.metadata.creationTime).toLocaleDateString() : "";
    info.append(nameEl, el("p", "", user.email || ""), el("p", "", joined ? "Joined " + joined : ""));

    const form = el("form", "name-form");
    const input = el("input"); input.value = displayName(user); input.maxLength = 20; input.setAttribute("aria-label", "Display name");
    const save = el("button", "btn btn--ghost", "Change name"); save.type = "submit";
    form.append(input, save);
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const name = input.value.trim();
      if (name.length < 2) return toast("Names need at least 2 characters.", "error");
      save.disabled = true;
      try {
        await setDisplayName(user, name);
        await store.syncLocal(user); // updates the name on the leaderboard too
        toast("Name updated.", "success");
        await render(true);
      } catch (err) { console.warn(err); toast("Could not update your name.", "error"); save.disabled = false; }
    });
    info.append(form);

    const trainerPage = el("a", "btn btn--ghost", "Trainer page");
    trainerPage.href = "trainer.html?uid=" + encodeURIComponent(user.uid);
    actions.append(trainerPage);

    const out = el("button", "btn btn--ghost", "Log out");
    out.addEventListener("click", () => { logOut(); toast("Logged out.", "info"); });
    actions.append(out);
  }
  card.append(avatar, info, actions);
  return card;
}

async function render(force = false) {
  rows = null;
  if (user) {
    try {
      await store.syncLocal(user); // pushes scores played as a guest, once per page load / refresh
      rows = await store.fetchAllScores(force);
    } catch (e) { console.warn(e); }
  }
  let wallet;
  try { wallet = await walletSection(user, () => render()); } catch (e) { console.warn(e); wallet = null; }
  const parts = [headerCard(), totals(), ...(wallet ? [wallet] : []), el("h2", "profile-h", "Your games"), statCards()];

  if (user && !rows) parts.push(el("p", "profile-note", "Online scores could not be loaded, so ranks are hidden. Showing what is saved in this browser."));
  const clear = el("button", "btn btn--ghost", "Clear scores on this device");
  clear.addEventListener("click", async () => {
    if (!(await confirmAction("Remove the scores saved in this browser? Scores already on the leaderboard stay.", "Clear"))) return;
    store.clearLocal();
    render();
  });
  const wrap = el("p", "profile-note");
  wrap.append(clear);
  parts.push(wrap);
  root.replaceChildren(...parts);
}

onUser((u) => { user = u; render(true); });
