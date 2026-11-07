/* ==========================================================
   ui.js
   Cross-page UI plumbing: nav toggle/scroll state, PokéPoints
   readout in the nav, toasts, and scroll-reveal. Every page
   calls initUI() once on load.
   ========================================================== */

import { getPoints, getAvatarSrc } from "./storage.js";
import { onUser, logOut, displayName, loginUrl } from "./auth.js";
import { ECONOMY_MODE } from "../economy/config.js";

/** Builds an element with TEXT content (never innerHTML), so user text cannot run as code. */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** Only https: and data:image/ sources are ever put into an <img>. Returns null for anything else (javascript:, http:, junk). */
export const safeSrc = (u) => (typeof u === "string" && (u.startsWith("https://") || u.startsWith("data:image/")) ? u : null);

/**
 * Shows a glass confirm modal. Resolves true if the user confirms,
 * false if they cancel or click the backdrop. Used before any
 * destructive action (removing a collected Pokémon, deleting a post).
 */
export function confirmAction(message, confirmLabel = "Delete") {
  return new Promise((resolve) => {
    const previous = document.activeElement;
    const overlay = el("div", "confirm-overlay");
    const modal = el("div", "confirm-modal glass");
    const text = el("p", "", message); // textContent only: the message can contain a user-chosen name safely
    text.id = "confirm-text-" + Math.random().toString(36).slice(2, 8);
    const cancelBtn = el("button", "btn btn--ghost", "Cancel");
    const confirmBtn = el("button", "btn btn--danger", confirmLabel);
    cancelBtn.type = confirmBtn.type = "button";
    const actions = el("div", "confirm-modal__actions");
    actions.append(cancelBtn, confirmBtn);
    modal.setAttribute("role", "alertdialog");
    modal.setAttribute("aria-modal", "true");
    modal.setAttribute("aria-describedby", text.id);
    modal.append(text, actions);
    overlay.append(modal);
    document.body.appendChild(overlay);

    let done = false;
    const close = (result) => {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      previous?.focus?.();
      resolve(result);
    };
    // Escape cancels; Tab stays inside the two buttons.
    const onKey = (e) => {
      if (e.key === "Escape") { e.preventDefault(); close(false); }
      else if (e.key === "Tab") {
        const first = cancelBtn, last = confirmBtn;
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
        else if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", onKey, true);

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close(false);
    });
    cancelBtn.addEventListener("click", () => close(false));
    confirmBtn.addEventListener("click", () => close(true));
    cancelBtn.focus(); // the safe choice is focused first, so a stray Enter never deletes anything
  });
}

export function toast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const node = el("div", `toast toast--${type}`, message);
  container.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

// Prototype economy: the balance is this browser's. Trusted economy: it is the server wallet of the logged-in player
// (shown as "-" until they log in and set the wallet up). The local number is then only the old Lucky Spin balance.
let navUser = null, navHooked = false;
export function renderNavPoints() {
  const slot = document.getElementById("nav-points");
  if (!slot) return;
  if (ECONOMY_MODE !== "trusted") { slot.textContent = getPoints().toLocaleString(); return; }
  if (!navHooked) { navHooked = true; onUser((u) => { navUser = u; renderNavPoints(); }); }
  if (!navUser) { slot.textContent = "-"; return; }
  import("../economy/wallet.js").then(({ getWallet }) => getWallet(navUser))
    .then((w) => { slot.textContent = w.ready ? w.balance.toLocaleString() : "-"; })
    .catch(() => { slot.textContent = "-"; });
}

export function renderNavProfile() {
  const slot = document.getElementById("nav-profile");
  if (!slot) return;
  onUser((user) => {
    slot.replaceChildren();
    if (!user) {
      const login = el("a", "nav__profile", "Log in");
      login.href = loginUrl(); // comes back to this page after logging in
      slot.append(login);
      return;
    }
    const wrap = el("div", "avatar-action");
    wrap.tabIndex = 0;
    const img = el("img", "avatar-action__img");
    let saved = null;
    try { saved = localStorage.getItem("pe_avatar_" + user.uid); } catch { /* private mode */ }
    img.src = safeSrc(saved) || safeSrc(user.photoURL) || getAvatarSrc({ username: displayName(user) });
    img.alt = displayName(user) + "'s avatar";
    const popup = el("div", "avatar-action__popup");
    const profile = el("a", "avatar-action__item", "Profile");
    profile.href = "profile.html";
    const out = el("button", "avatar-action__item avatar-action__item--danger", "Log out");
    out.addEventListener("click", () => { logOut(); toast("Logged out.", "info"); });
    const trainer = el("a", "avatar-action__item", "Trainer page");
    trainer.href = "trainer.html?uid=" + encodeURIComponent(user.uid);
    popup.append(profile, trainer, out);
    wrap.append(img, popup);
    slot.append(wrap);
  });
}

function initNav() {
  const toggle = document.getElementById("nav-toggle");
  const menu = document.getElementById("nav-menu");
  const nav = document.getElementById("site-nav");

  toggle?.addEventListener("click", () => {
    const isOpen = menu.classList.toggle("nav__menu--open");
    toggle.setAttribute("aria-expanded", String(isOpen));
  });

  window.addEventListener("scroll", () => {
    nav?.classList.toggle("site-nav--scrolled", window.scrollY > 24);
  });
}

function initScrollReveal() {
  const targets = document.querySelectorAll("[data-reveal]");
  if (!targets.length) return;
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-revealed");
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.15 }
  );
  targets.forEach((el) => observer.observe(el));
}

/** Call once per page, after DOMContentLoaded. */
export function initUI() {
  initNav();
  initScrollReveal();
  renderNavPoints();
  renderNavProfile();
}
