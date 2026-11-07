// Shared building blocks for the Community UI. Everything is built with el()/DOM APIs, never innerHTML,
// so a trainer's name, bio or post text can never run as code.
import { el, safeSrc } from "../core/ui.js";
import { getAvatarSrc } from "../core/storage.js";
import { artworkUrl, MAX_DEX_ID, RARITY_COLORS } from "../core/api.js";
import { cachedUser, loadUser } from "./data.js";
import { badgeById } from "./achievements.js";

/* ---------- small formatters ---------- */
export const pretty = (name = "") => String(name).replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
export const validDex = (id) => Number.isInteger(id) && id >= 1 && id <= MAX_DEX_ID;
const RARITIES = ["Common", "Uncommon", "Rare", "Ultra Rare", "Legendary", "Mythical"];
export const cleanRarity = (r) => (RARITIES.includes(r) ? r : "Common");
export const rarityKey = (r) => cleanRarity(r).toLowerCase().replace(/\s+/g, "-");
export { safeSrc }; // lives in core/ui.js now; re-exported so existing Community imports keep working

export function timeAgo(ms) {
  const s = Math.max(0, Math.floor((Date.now() - ms) / 1000));
  if (s < 60) return "just now";
  if (s < 3600) return Math.floor(s / 60) + "m ago";
  if (s < 86400) return Math.floor(s / 3600) + "h ago";
  if (s < 604800) return Math.floor(s / 86400) + "d ago";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}
export const absTime = (ms) => new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
export function clockTime(ms) {
  const d = new Date(ms), now = new Date();
  const t = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  return d.toDateString() === now.toDateString() ? t : d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) + " " + t;
}
/** A <time> element that keeps itself fresh ("5m ago" becomes "6m ago"). */
export function timeEl(ms, className = "") {
  const t = el("time", className, timeAgo(ms));
  t.dataset.ms = String(ms);
  t.title = absTime(ms);
  return t;
}
setInterval(() => document.querySelectorAll("time[data-ms]").forEach((t) => { t.textContent = timeAgo(+t.dataset.ms); }), 30000);

/* ---------- icons (stroke SVG built from path data) ---------- */
const ICONS = {
  heart: "M12 21s-7-4.35-9.5-8.5C.5 8.5 3 5 6.5 5c1.9 0 3.4 1.1 4.5 2.6C12.1 6.1 13.6 5 15.5 5 19 5 21.5 8.5 19.5 12.5 17 16.65 12 21 12 21z",
  comment: "M21 11.5a8.4 8.4 0 0 1-9 8.4 8.6 8.6 0 0 1-3.6-.8L3 21l1.9-5.1A8.4 8.4 0 1 1 21 11.5z",
  trash: ["M4 7h16", "M10 11v6", "M14 11v6", "M6 7l1 13h10l1-13", "M9 7V4h6v3"],
  image: ["M3 5h18v14H3z", "M3 16l5-5 4 4 3-3 6 6", "M8.5 9.5h.01"],
  video: ["M3 6h13v12H3z", "M16 10l5-3v10l-5-3"],
  team: ["M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2", "M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M22 21v-2a4 4 0 0 0-3-3.9", "M16 3.1a4 4 0 0 1 0 7.8"],
  ball: ["M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z", "M2 12h6", "M16 12h6", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z"],
  award: ["M12 15a6 6 0 1 0 0-12 6 6 0 0 0 0 12z", "M8.2 13.9L7 22l5-3 5 3-1.2-8.1"],
  bell: ["M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9", "M13.7 21a2 2 0 0 1-3.4 0"],
  send: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4 20-7z"],
  close: ["M6 6l12 12", "M18 6L6 18"],
  link: ["M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7", "M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"],
  home: ["M3 11l9-8 9 8", "M5 10v10h14V10"],
  search: ["M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M21 21l-4.3-4.3"],
  share: ["M4 12v8h16v-8", "M16 6l-4-4-4 4", "M12 2v13"],
  user: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z"]
};
export function icon(name, cls = "icn") {
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("class", cls);
  [].concat(ICONS[name] || []).forEach((d) => {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", d);
    svg.append(p);
  });
  return svg;
}

/* ---------- avatars and names that stay in sync with the trainer's profile ---------- */
export const avatarFallback = (name) => getAvatarSrc({ username: name || "?" });

export function avatar(uid, name, size = "md") {
  const img = el("img", `av av--${size}`);
  img.alt = "";
  img.loading = "lazy";
  img.src = avatarFallback(name);
  img.dataset.av = uid || "";
  return img;
}

/** <a> to a trainer page. data-nm lets hydrate() swap in the current username after they rename themselves. */
export function userLink(uid, name, className = "") {
  const a = el("a", className, name || "Trainer");
  a.href = "trainer.html?uid=" + encodeURIComponent(uid);
  a.dataset.nm = uid;
  return a;
}

function applyUser(uid, u, root) {
  if (!u) return;
  const sel = (attr) => `[${attr}="${CSS.escape(uid)}"]`;
  root.querySelectorAll("img" + sel("data-av")).forEach((img) => { img.src = safeSrc(u.photoURL) || avatarFallback(u.username); });
  root.querySelectorAll(sel("data-nm")).forEach((n) => { if (u.username) n.textContent = u.username; });
}

/** Fills every avatar and name inside `root` from the trainer profile cache (loading missing ones once). */
export function hydrate(root = document) {
  const uids = new Set();
  root.querySelectorAll("[data-av],[data-nm]").forEach((n) => { const u = n.dataset.av || n.dataset.nm; if (u) uids.add(u); });
  uids.forEach((uid) => {
    const known = cachedUser(uid);
    if (known !== undefined) applyUser(uid, known, root);
    else loadUser(uid).then((u) => applyUser(uid, u, root));
  });
}

/* ---------- keyed list: updates cards in place instead of rebuilding them ---------- */
/** `parent` must contain only items made here. make(item) => { el, destroy? }; update(card, item) refreshes one. */
export function reconcile(parent, items, key, make, update) {
  const live = parent.__live || (parent.__live = new Map());
  const seen = new Set();
  items.forEach((item, i) => {
    const k = key(item);
    seen.add(k);
    let card = live.get(k);
    if (!card) { card = make(item); live.set(k, card); }
    else if (update) update(card, item);
    if (parent.children[i] !== card.el) parent.insertBefore(card.el, parent.children[i] || null);
  });
  for (const [k, card] of live) {
    if (!seen.has(k)) { card.destroy?.(); card.el.remove(); live.delete(k); }
  }
}
export function clearList(parent) {
  parent.__live?.forEach((c) => c.destroy?.());
  parent.__live = null;
  parent.replaceChildren();
}

/* ---------- modal + lightbox ---------- */
export function openModal(title, content, { wide = false, onClose } = {}) {
  const previous = document.activeElement;
  const overlay = el("div", "cm-overlay");
  const box = el("div", "cm-modal" + (wide ? " cm-modal--wide" : ""));
  box.setAttribute("role", "dialog");
  box.setAttribute("aria-modal", "true");
  box.setAttribute("aria-label", title);
  const head = el("div", "cm-modal__head");
  const x = el("button", "icon-action");
  x.type = "button";
  x.setAttribute("aria-label", "Close");
  x.append(icon("close"));
  head.append(el("h3", "", title), x);
  box.append(head, content);
  overlay.append(box);
  document.body.append(overlay);
  let closed = false;
  const close = () => { if (closed) return; closed = true; document.removeEventListener("keydown", onKey); overlay.remove(); previous?.focus?.(); onClose?.(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("mousedown", (e) => { if (e.target === overlay) close(); });
  x.addEventListener("click", close);
  (box.querySelector("textarea,input,select,button:not(.icon-action)") || x).focus();
  return { close, box };
}

export function openLightbox(src, alt = "") {
  const img = el("img", "cm-lightbox__img");
  img.src = src;
  img.alt = alt;
  const overlay = el("div", "cm-overlay cm-overlay--dark");
  overlay.append(img);
  const close = () => { document.removeEventListener("keydown", onKey); overlay.remove(); };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);
  overlay.addEventListener("click", close);
  document.body.append(overlay);
}

/* ---------- Pokémon, rarity and badge pictures ---------- */
export function rarityPill(rarity) {
  const pill = el("span", "rar", cleanRarity(rarity));
  pill.style.setProperty("--glow-color", RARITY_COLORS[rarityKey(rarity)]);
  return pill;
}

export function monThumb(p, className = "mon") {
  const box = el("div", className);
  box.dataset.rarity = rarityKey(p.rarity);
  box.style.setProperty("--glow-color", RARITY_COLORS[rarityKey(p.rarity)]);
  const img = el("img");
  img.src = validDex(p.id) ? artworkUrl(p.id) : "";
  img.alt = pretty(p.name);
  img.loading = "lazy";
  img.onerror = () => { img.style.visibility = "hidden"; };
  box.append(img, el("span", "mon__name", pretty(p.name)));
  if (p.rarity) box.append(rarityPill(p.rarity));
  return box;
}

export function badgeIcon(b, locked = false) {
  const wrap = el("div", "bdg__icon" + (locked ? " is-locked" : ""));
  wrap.style.setProperty("--c", b.c);
  const img = el("img");
  img.src = artworkUrl(b.mon);
  img.alt = "";
  img.loading = "lazy";
  img.onerror = () => { img.style.visibility = "hidden"; };
  wrap.append(img);
  return wrap;
}

/** The thing a post carries: a Pokémon, a team or a badge. Data is validated, never trusted. */
export function attachmentEl(att) {
  if (!att || typeof att !== "object") return null;
  if (att.kind === "pokemon" && validDex(att.id)) {
    const wrap = el("div", "att att--mon");
    wrap.append(monThumb(att, "mon mon--lg"));
    return wrap;
  }
  if (att.kind === "team" && Array.isArray(att.members) && att.members.length) {
    const wrap = el("div", "att att--team");
    wrap.append(el("strong", "att__title", att.title ? String(att.title).slice(0, 40) : "My team"));
    const row = el("div", "team-row");
    att.members.slice(0, 6).filter((m) => validDex(m.id)).forEach((m) => row.append(monThumb({ id: m.id, name: m.name }, "mon mon--sm")));
    wrap.append(row);
    return wrap;
  }
  if (att.kind === "badge" && badgeById(att.id)) {
    const b = badgeById(att.id);
    const wrap = el("div", "att att--badge");
    const text = el("div");
    text.append(el("strong", "", b.name), el("p", "", b.desc));
    wrap.append(badgeIcon(b), text);
    return wrap;
  }
  return null;
}

export function stateBox(title, text, action) {
  const box = el("div", "cm-state");
  box.append(el("h3", "", title));
  if (text) box.append(el("p", "", text));
  if (action) box.append(action);
  return box;
}

export function linkButton(label, href, cls = "btn btn--primary") {
  const a = el("a", cls, label);
  a.href = href;
  return a;
}
