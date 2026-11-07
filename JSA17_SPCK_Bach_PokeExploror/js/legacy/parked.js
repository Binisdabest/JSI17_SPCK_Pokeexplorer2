/* ==========================================================
   parked.js
   Shared start-up for the parked pages (games.html = Lucky Spin, collection.html, cards.html).

   - Runs the normal page UI (nav, PokéPoints, avatar).
   - Draws a "trainer strip" that says who is playing, using the real Firebase login (the old local
     trainer profiles are gone). Guests keep playing; their data stays in this browser.
   - When someone is logged in, mirrors PokéPoints + collection summary to users/{uid} through the
     existing Community modules (ensureUser + syncSelf). localStorage stays the source of the data.
   ========================================================== */

import { el, initUI, safeSrc } from "../core/ui.js";
import { ECONOMY_MODE } from "../economy/config.js";
import { onUser, displayName, loginUrl } from "../core/auth.js";
import { getPoints, getCollection, getAvatarSrc } from "../core/storage.js";

let user = null;      // Firebase user, or null for a guest
let profile = null;   // users/{uid} document once it has been loaded
let syncState = "";   // "", "syncing", "synced", "pending"
let strip = null;
let timer = 0;
let run = 0;          // bumps on every login change so a slow sync for a previous user is ignored

function avatarSrc() {
  if (!user) return getAvatarSrc({ username: "Guest" });
  let saved = null;
  try { saved = localStorage.getItem("pe_avatar_" + user.uid); } catch { /* private mode */ }
  return safeSrc(profile?.photoURL) || safeSrc(saved) || safeSrc(user.photoURL) || getAvatarSrc({ username: displayName(user) });
}

function render() {
  if (!strip) return;
  const img = el("img", "trainer-strip__avatar");
  img.alt = "";
  img.width = img.height = 44;
  img.src = avatarSrc();

  const text = el("div", "trainer-strip__text");
  const actions = el("div", "trainer-strip__actions");
  const stats = getPoints().toLocaleString() + " PokéPoints  |  " + getCollection().length + " Pokémon collected";

  if (user) {
    const name = el("strong", "", profile?.username || displayName(user));
    const who = el("p", "trainer-strip__who");
    who.append("Playing as ", name);
    const note = { syncing: "Updating your trainer page...", synced: "Shown on your trainer page.", pending: "Could not update your trainer page yet. It will retry on your next change." }[syncState] || "";
    text.append(who, el("p", "trainer-strip__meta", note ? stats + "  |  " + note : stats));
    const page = el("a", "btn btn--ghost btn--sm", "Trainer page");
    page.href = "trainer.html?uid=" + encodeURIComponent(user.uid);
    actions.append(page);
  } else {
    text.append(
      el("p", "trainer-strip__who", "Playing as a guest"),
      el("p", "trainer-strip__meta", stats + "  |  Saved in this browser only. Log in to show them on your trainer page.")
    );
    const login = el("a", "btn btn--primary btn--sm", "Log in or sign up");
    login.href = loginUrl();
    actions.append(login);
  }
  strip.replaceChildren(img, text, actions);
  strip.hidden = false;
}

async function syncNow() {
  const me = user, mine = run;
  if (!me) return;
  syncState = "syncing";
  render();
  try {
    const [{ ensureUser }, { syncSelf, localSnapshot }] = await Promise.all([import("../community/data.js"), import("../community/sync.js")]);
    let doc = await ensureUser(me);
    doc = await syncSelf(me, doc);
    if (mine !== run) return;
    profile = doc;
    const snap = localSnapshot();
    // syncSelf swallows write errors, so check that the profile really has this browser's balance.
    syncState = !snap.hasPoints || snap.points === doc.points || ECONOMY_MODE === "trusted" ? "synced" : "pending";
  } catch (e) {
    console.warn("Could not update the trainer profile:", e.code || e.message);
    if (mine !== run) return;
    syncState = "pending";
  }
  render();
}

/** Call after PokéPoints or the collection changed: redraws the strip now and updates the trainer page shortly after. */
export function trainerChanged() {
  render();
  clearTimeout(timer);
  if (user) timer = setTimeout(syncNow, 1200);
}

export function initParkedPage() {
  initUI();
  strip = document.getElementById("trainer-strip");
  onUser((u) => {
    user = u;
    profile = null;
    syncState = "";
    run++;
    render();
    if (u) syncNow();
  });
}
