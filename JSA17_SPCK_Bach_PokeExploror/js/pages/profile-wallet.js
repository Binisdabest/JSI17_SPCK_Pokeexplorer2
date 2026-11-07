// Wallet section of the profile page: balance, card inventory summary, duplicate exchange, recent transactions.
// Talks only to js/economy/wallet.js, so it behaves the same in prototype and trusted mode. DOM is built with el().
import { el, toast, confirmAction, safeSrc, renderNavPoints } from "../core/ui.js";
import { economyMode, isTrusted, getWallet, initWallet, getInventory, getHistory, exchangeDuplicates, newRequestId } from "../economy/wallet.js";
import { getCardsMeta } from "../economy/catalog.js";
import { collectionStats, rarityLabel } from "../economy/cards.js";
import { EXCHANGE_RATE, LEGACY_MIGRATION_CAP, STARTER_POINTS } from "../economy/config.js";

const fmt = (n) => Number(n).toLocaleString();
const TYPE_LABEL = {
  "wallet-init": "Wallet started", "exchange-duplicates": "Duplicates exchanged", "legacy-reward": "Lucky Spin reward",
  "legacy-spend": "Lucky Spin", "dev-grant": "Cards added (test)", "pack-open": "Pack opened"
};
// A request id is kept until the server gives a definite answer, so retrying after a dropped connection can't pay twice.
const RETRYABLE = new Set(["unavailable", "internal", "unknown", "deadline-exceeded", "network"]);

function summaryBox(label, value) {
  const box = el("div", "sum");
  box.append(el("span", "", label), el("strong", "", String(value)));
  return box;
}

function modeBadge() {
  const trusted = isTrusted();
  const badge = el("p", "wallet__mode " + (trusted ? "wallet__mode--trusted" : "wallet__mode--proto"));
  badge.append(el("strong", "", trusted ? "Server wallet" : "Prototype mode"));
  badge.append(trusted
    ? " Your PokéPoints and cards are stored on the server and can only be changed by it."
    : " Your PokéPoints and cards are saved in this browser only. They can be edited in dev tools and don't follow you to another device.");
  return badge;
}

export async function walletSection(user, rerender) {
  const section = el("section", "wallet");
  section.setAttribute("aria-label", "Wallet");
  section.append(el("h2", "profile-h", "Wallet"), modeBadge());

  if (isTrusted() && !user) {
    section.append(el("p", "profile-note", "Log in to see your wallet."));
    return section;
  }

  let wallet;
  try { wallet = await getWallet(user); }
  catch (e) {
    console.warn("Wallet unavailable:", e.code || e.message);
    section.append(el("p", "profile-note", "Couldn't load your wallet right now. Try again in a moment."));
    return section;
  }

  const balanceBox = el("div", "wallet__balance");
  balanceBox.append(el("span", "", "PokéPoints"), el("strong", "", wallet.ready ? fmt(wallet.balance) : "-"));
  section.append(balanceBox);

  /* ---- trusted mode: the wallet has to be created once ---- */
  if (!wallet.ready) {
    section.append(setupPanel(user, wallet, rerender));
    return section;
  }
  if (wallet.migration) {
    const m = wallet.migration;
    section.append(el("p", "profile-note", `Moved ${fmt(m.credited)} PokéPoints from this browser's old balance` +
      (m.capped ? ` (you had ${fmt(m.claimed)}; the most that can be moved is ${fmt(m.cap)}).` : ".")));
  }

  /* ---- inventory ---- */
  let inventory = [], meta = new Map();
  try {
    inventory = await getInventory(user);
    meta = await getCardsMeta(inventory.map((r) => r.cardId));
  } catch (e) { console.warn("Inventory unavailable:", e.code || e.message); section.append(el("p", "profile-note", "Couldn't load your cards right now.")); }

  const stats = collectionStats(inventory, meta);
  const strip = el("div", "sum-strip");
  [["Cards", fmt(stats.copies)], ["Unique", fmt(stats.unique)], ["Duplicates", fmt(stats.duplicates)], ["Collection value", fmt(stats.value) + " pts"]]
    .forEach(([l, v]) => strip.append(summaryBox(l, v)));
  section.append(el("h3", "wallet__h", "Card inventory"), strip);

  if (!inventory.length) {
    section.append(el("p", "profile-note", "No cards yet. Cards arrive when pack opening launches."));
  } else {
    section.append(inventoryList(user, inventory, meta, rerender));
  }

  /* ---- history ---- */
  let history = [];
  try { history = await getHistory(user, 10); } catch (e) { console.warn("History unavailable:", e.code || e.message); }
  section.append(el("h3", "wallet__h", "Recent activity"));
  if (!history.length) section.append(el("p", "profile-note", "Nothing yet."));
  else {
    const list = el("ul", "wallet__history");
    history.forEach((t) => {
      const li = el("li");
      const sign = t.amount > 0 ? "+" : "";
      const amount = el("strong", t.amount < 0 ? "is-neg" : t.amount > 0 ? "is-pos" : "", t.amount === 0 ? "-" : sign + fmt(t.amount));
      li.append(el("span", "wallet__history-name", TYPE_LABEL[t.type] || t.type), amount,
        el("span", "wallet__history-when", t.createdAt ? new Date(t.createdAt).toLocaleString() : ""));
      list.append(li);
    });
    section.append(list);
  }
  return section;
}

function setupPanel(user, wallet, rerender) {
  const box = el("div", "wallet__setup");
  const status = el("p", "profile-note");
  status.setAttribute("role", "status");
  let pending = null; // {key, id}

  async function run(claimLegacy) {
    const key = claimLegacy ? "legacy" : "starter";
    if (!pending || pending.key !== key) pending = { key, id: newRequestId() };
    buttons.forEach((b) => (b.disabled = true));
    status.textContent = "Setting up your wallet...";
    const result = await initWallet(user, { claimLegacy, requestId: pending.id });
    if (result.ok) { pending = null; toast("Wallet ready.", "success"); renderNavPoints(); return rerender(); }
    if (!RETRYABLE.has(result.code)) pending = null;
    status.textContent = RETRYABLE.has(result.code) ? "Couldn't reach the server. Press the button again to retry." : result.message;
    buttons.forEach((b) => (b.disabled = false));
  }

  const buttons = [];
  box.append(el("p", "", "Your wallet hasn't been set up yet."));
  if (wallet.legacy.hasLocal) {
    box.append(el("p", "profile-note", `This browser holds ${fmt(wallet.legacy.localBalance)} PokéPoints from before. ` +
      `Moving them is a one-time step and counts at most ${fmt(wallet.legacy.cap ?? LEGACY_MIGRATION_CAP)}, because the server can't verify a number kept in a browser.`));
    const move = el("button", "btn btn--primary", "Move my PokéPoints");
    move.type = "button";
    move.addEventListener("click", () => run(true));
    const fresh = el("button", "btn btn--ghost", `Start fresh with ${fmt(STARTER_POINTS)}`);
    fresh.type = "button";
    fresh.addEventListener("click", async () => {
      if (await confirmAction("Start with the standard balance and leave your old PokéPoints behind? This can't be undone.", "Start fresh")) run(false);
    });
    buttons.push(move, fresh);
    box.append(el("div", "wallet__actions"));
    box.lastChild.append(move, fresh);
  } else {
    const start = el("button", "btn btn--primary", `Start my wallet (${fmt(STARTER_POINTS)} PokéPoints)`);
    start.type = "button";
    start.addEventListener("click", () => run(false));
    buttons.push(start);
    box.append(start);
  }
  box.append(status);
  return box;
}

function inventoryList(user, inventory, meta, rerender) {
  const rows = [...inventory].sort((a, b) => (meta.get(b.cardId)?.pointValue ?? 0) - (meta.get(a.cardId)?.pointValue ?? 0) || a.cardId.localeCompare(b.cardId));
  const grid = el("ul", "wallet__cards");
  rows.slice(0, 24).forEach((row) => {
    const card = meta.get(row.cardId);
    const li = el("li", "wallet__card");
    const src = safeSrc(card?.imageUrl);
    if (src) { const img = el("img"); img.src = src; img.alt = ""; img.loading = "lazy"; img.width = 56; img.height = 78; li.append(img); }
    const info = el("div", "wallet__card-info");
    info.append(el("strong", "", card?.name || row.cardId));
    const pill = el("span", "rar rar--" + (card?.rarity || "unknown"), card ? rarityLabel(card.rarity) : "Unknown");
    info.append(pill, el("span", "wallet__card-meta", `${card?.setName ? card.setName + " - " : ""}x${row.count}`));
    li.append(info);
    const extras = row.count - 1;
    if (extras > 0 && card) {
      const each = Math.max(1, Math.floor(card.pointValue * EXCHANGE_RATE));
      const btn = el("button", "btn btn--ghost btn--small", `Exchange ${extras} extra (+${fmt(each * extras)})`);
      btn.type = "button";
      let pending = null;
      btn.addEventListener("click", async () => {
        if (!(await confirmAction(`Exchange ${extras} extra ${card.name} for about ${fmt(each * extras)} PokéPoints? You keep one copy.`, "Exchange"))) return;
        if (!pending) pending = newRequestId();
        btn.disabled = true;
        const result = await exchangeDuplicates(user, { cardId: row.cardId, quantity: extras, requestId: pending });
        if (result.ok) { pending = null; toast(`+${fmt(result.credited)} PokéPoints`, "success"); renderNavPoints(); return rerender(); }
        if (!RETRYABLE.has(result.code)) pending = null;
        toast(RETRYABLE.has(result.code) ? "Couldn't reach the server. Try again." : result.message, "error");
        btn.disabled = false;
      });
      li.append(btn);
    }
    grid.append(li);
  });
  if (rows.length > 24) grid.append(el("li", "profile-note", `...and ${rows.length - 24} more.`));
  return grid;
}
