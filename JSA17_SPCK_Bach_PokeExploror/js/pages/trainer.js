// Trainer profile: trainer.html?uid=<uid>   (no uid = your own page)
// Tabs by hash: (posts)  #collection  #badges  #stats
import { el, initUI, toast } from "../core/ui.js";
import { onUser, setDisplayName } from "../core/auth.js";
import * as store from "../core/store.js";
import { getAllNames, artworkUrl } from "../core/api.js";
import { S, emit } from "../community/state.js";
import {
  ensureUser, loadUser, saveProfile, subscribeFollowing, subscribeUserPosts, counts, listFollow, userMs, LIMITS
} from "../community/data.js";
import { syncSelf } from "../community/sync.js";
import { storeImage, removeStored, validateImage, IMAGE_TYPES } from "../community/media.js";
import { createPostCard } from "../community/post-card.js";
import { followButton, trainerRow } from "../community/people.js";
import { openShare } from "../community/share.js";
import { teamAttachment } from "../community/pickers.js";
import { BADGES, PLAYABLE, loadStats, earnedIds } from "../community/achievements.js";
import {
  avatar, hydrate, icon, monThumb, badgeIcon, stateBox, linkButton, openModal, reconcile, clearList, pretty, safeSrc, avatarFallback
} from "../community/view.js";

initUI();

const root = document.getElementById("trainer-root");
const BANNERS = ["#8fd3ff", "#ffcb05", "#ff9fd6", "#b49cff", "#7bdc8c", "#ffa86b"];
const TABS = [["posts", "Posts"], ["collection", "Collection"], ["badges", "Badges"], ["stats", "Stats"]];
let profile = null, isMe = false, cleanTab = null, stopFollowing = null, headerCounts = null;

const bannerFor = (uid) => BANNERS[[...uid].reduce((n, c) => n + c.charCodeAt(0), 0) % BANNERS.length];
const tabFromHash = () => { const h = location.hash.slice(1); return TABS.some(([id]) => id === h) ? h : "posts"; };

/* ---------- header ---------- */
function statBox(label, value, onClick) {
  const box = el(onClick ? "button" : "div", "sum" + (onClick ? " sum--btn" : ""));
  if (onClick) { box.type = "button"; box.addEventListener("click", onClick); }
  const strong = el("strong", "", value);
  box.append(el("span", "", label), strong);
  return { box, strong };
}

function showFollowList(kind) {
  const body = el("div");
  body.append(el("div", "loading-ring"));
  openModal(kind === "followers" ? "Followers" : "Following", body, { wide: true });
  listFollow(profile.uid, kind).then((users) => {
    if (!users.length) { body.replaceChildren(stateBox(kind === "followers" ? "No followers yet" : "Not following anyone yet", "")); return; }
    const ul = el("ul", "trow-list");
    ul.append(...users.map(trainerRow));
    body.replaceChildren(ul);
    hydrate(ul);
  }).catch(() => body.replaceChildren(stateBox("Could not load the list", "Check your connection and try again.")));
}

function header() {
  const card = el("section", "tp-head");
  const banner = el("div", "tp-banner");
  banner.style.setProperty("--c", bannerFor(profile.uid));
  if (profile.favoritePokemon?.id) {
    const fav = el("div", "tp-fav");
    const img = el("img");
    img.src = artworkUrl(profile.favoritePokemon.id);
    img.alt = "";
    img.onerror = () => { img.style.visibility = "hidden"; };
    fav.append(img, el("span", "", "Favourite: " + pretty(profile.favoritePokemon.name)));
    banner.append(fav);
  }

  const body = el("div", "tp-body");
  const av = avatar(profile.uid, profile.username, "xl");
  av.src = safeSrc(profile.photoURL) || avatarFallback(profile.username);
  const info = el("div", "tp-info");
  info.append(el("h1", "tp-name", profile.username || "Trainer"));
  info.append(el("p", "tp-bio", profile.bio || (isMe ? "Add a short bio with Edit profile." : "This trainer has not written a bio yet.")));
  const joined = userMs(profile);
  if (profile.createdAt) info.append(el("p", "tp-joined", "Joined " + new Date(joined).toLocaleDateString(undefined, { month: "long", year: "numeric" })));

  const actions = el("div", "tp-actions");
  if (isMe) {
    const edit = el("button", "btn btn--primary btn--sm", "Edit profile");
    edit.type = "button";
    edit.addEventListener("click", openEditor);
    actions.append(edit);
  } else {
    const f = followButton(profile.uid);
    actions.append(f || el("span"));
    if (!S.user) actions.append(linkButton("Log in to follow", "login.html", "btn btn--ghost btn--sm"));
  }
  body.append(av, info, actions);

  const strip = el("div", "sum-strip tp-stats");
  const posts = statBox("Posts", "-");
  const followers = statBox("Followers", "-", () => showFollowList("followers"));
  const following = statBox("Following", "-", () => showFollowList("following"));
  const points = statBox("PokéPoints", (profile.points || 0).toLocaleString());
  strip.append(posts.box, followers.box, following.box, points.box);
  headerCounts = { posts: posts.strong, followers: followers.strong, following: following.strong };
  loadCounts();

  card.append(banner, body, strip);
  return card;
}

async function loadCounts() {
  const c = await counts(profile.uid);
  if (!headerCounts) return;
  headerCounts.posts.textContent = c.posts.toLocaleString();
  headerCounts.followers.textContent = c.followers.toLocaleString();
  headerCounts.following.textContent = c.following.toLocaleString();
}
window.addEventListener("follow-changed", () => { if (profile) loadCounts(); });

/* ---------- tabs ---------- */
function tabPosts(box) {
  const list = el("div", "cpost-list");
  const status = el("div", "cm-status");
  box.append(status, list);
  let loaded = false;
  const draw = (posts) => {
    reconcile(list, posts, (p) => p.id, (p) => createPostCard(p, { onDeleted: loadCounts }), (c, p) => c.update(p));
    hydrate(list);
    status.replaceChildren();
    if (!posts.length) {
      status.append(isMe
        ? stateBox("You have not posted yet", "Share a photo, a pull or your team with the community.", linkButton("Go to the feed", "community.html"))
        : stateBox("No posts yet", profile.username + " has not shared anything yet."));
    }
  };
  status.append(el("div", "loading-ring"));
  const unsub = subscribeUserPosts(profile.uid, (posts) => { loaded = true; draw(posts); }, (err) => {
    console.warn(err);
    status.replaceChildren(stateBox("Could not load posts", "Check your connection and the Firestore rules."));
  });
  return () => { unsub(); clearList(list); };
}

function section(title, ...content) {
  const s = el("section", "tp-section");
  s.append(el("h2", "cm-h2", title), ...content);
  return s;
}

function tabCollection(box) {
  const team = (profile.team || []).filter((m) => m?.id);
  const rare = profile.rareCards || [];
  const show = profile.showcase || [];

  if (team.length) {
    const row = el("div", "team-row");
    team.forEach((m) => row.append(monThumb({ id: m.id, name: m.name }, "mon mon--md")));
    const parts = [row];
    if (isMe) {
      const share = el("button", "btn btn--ghost btn--sm", "Share team to the feed");
      share.type = "button";
      share.addEventListener("click", () => { const a = teamAttachment(); if (a) openShare({ attachment: a, title: "Share your team", text: "My current team!" }); });
      parts.push(share);
    }
    box.append(section("Team", ...parts));
  } else if (isMe) {
    box.append(section("Team", el("p", "cm-sub", "Pick up to six Pokémon with Edit profile and show them off.")));
  }

  if (!show.length && !rare.length) {
    box.append(section("Collection", stateBox("No Pokémon collected yet", isMe ? "Open Lucky Spin to catch your first one. Favourite a Pokémon in your collection to pin it here." : profile.username + " has not collected anything yet.", isMe ? linkButton("Open Lucky Spin", "games.html") : null)));
    return;
  }
  if (rare.length) {
    const g = el("div", "mon-grid");
    rare.forEach((p) => g.append(monThumb(p, "mon mon--md")));
    box.append(section("Rarest finds", g));
  }
  if (show.length) {
    const g = el("div", "mon-grid");
    show.forEach((p) => g.append(monThumb(p, "mon mon--sm")));
    box.append(section("Showcase", el("p", "cm-sub", (profile.collectionCount || 0) + " Pokémon collected, " + (profile.uniqueCount || 0) + " different species."), g));
  }
  hydrate(box);
}

async function tabBadges(box) {
  box.append(el("div", "loading-ring"));
  const { stats } = await loadStats(profile.uid, profile, S.user);
  const have = new Set(earnedIds(stats));
  const key = "pe_badges_" + profile.uid;
  const seen = isMe ? (() => { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } })() : null;
  const fresh = isMe && seen ? [...have].filter((id) => !seen.includes(id)) : [];
  if (isMe) localStorage.setItem(key, JSON.stringify([...have]));
  fresh.forEach((id) => toast("Badge unlocked: " + BADGES.find((b) => b.id === id).name, "success"));

  const grid = el("div", "bdg-grid");
  [...BADGES].sort((a, b) => have.has(b.id) - have.has(a.id)).forEach((b) => {
    const got = have.has(b.id);
    const card = el("article", "bdg" + (got ? " is-earned" : " is-locked") + (fresh.includes(b.id) ? " is-new" : ""));
    const text = el("div", "bdg__text");
    text.append(el("h3", "", b.name), el("p", "", b.desc));
    card.append(badgeIcon(b, !got), text);
    if (got && isMe) {
      const share = el("button", "btn btn--ghost btn--sm", "Share");
      share.type = "button";
      share.addEventListener("click", () => openShare({ attachment: { kind: "badge", id: b.id }, title: "Share a badge", text: "Just unlocked " + b.name + "!" }));
      card.append(share);
    } else if (!got) card.append(el("span", "bdg__lock", "Locked"));
    grid.append(card);
  });
  box.replaceChildren(section(`Badges (${have.size} of ${BADGES.length})`, grid));
}

async function tabStats(box) {
  box.append(el("div", "loading-ring"));
  const { rows, stats } = await loadStats(profile.uid, profile, S.user);
  const all = store.boardFor(rows, "all");
  const at = all.findIndex((p) => p.uid === profile.uid);
  const strip = el("div", "sum-strip");
  [["Total score", stats.totalScore.toLocaleString()], ["Games tried", stats.gamesTried + " / " + stats.gamesTotal],
    ["Overall rank", at >= 0 ? "#" + (at + 1) : "-"], ["PokéPoints", (profile.points || 0).toLocaleString()]].forEach(([l, v]) => strip.append(statBox(l, v).box));

  const cards = el("div", "stat-cards");
  PLAYABLE.forEach((g) => {
    const mine = rows.find((r) => r.uid === profile.uid && r.gameId === g.id);
    const rank = mine ? store.boardFor(rows, g.id).findIndex((p) => p.uid === profile.uid) + 1 : 0;
    const card = el("a", "stat-card");
    card.href = "game.html?id=" + g.id;
    const pic = el("div", "stat-card__pic");
    pic.style.setProperty("--c", g.color);
    const img = el("img");
    img.src = g.image; img.alt = ""; img.loading = "lazy";
    pic.append(img);
    const t = el("div");
    const line = el("p");
    line.append("Best ", el("strong", "", (mine?.best ?? 0).toLocaleString()), rank ? "  |  Rank #" + rank : "  |  Not played");
    t.append(el("h3", "", g.name), line);
    card.append(pic, t);
    cards.append(card);
  });
  const link = el("p", "profile-note");
  link.append("See everyone on the ", Object.assign(el("a", "", "leaderboard"), { href: "leaderboard.html" }), ".");
  box.replaceChildren(section("Game statistics", strip), section("Rankings by game", cards), link);
}

function showTab() {
  cleanTab?.();
  cleanTab = null;
  const id = tabFromHash();
  root.querySelectorAll(".tp-tabs .chip").forEach((c) => c.setAttribute("aria-pressed", String(c.dataset.id === id)));
  const box = root.querySelector(".tp-content");
  box.replaceChildren();
  const run = { posts: tabPosts, collection: tabCollection, badges: tabBadges, stats: tabStats }[id];
  const out = run(box);
  if (typeof out === "function") cleanTab = out;
  else if (out?.catch) out.catch((e) => { console.warn(e); box.replaceChildren(stateBox("Could not load this section", "Check your connection and try again.")); });
}

/* ---------- edit profile ---------- */
async function openEditor() {
  const form = el("form", "edit");
  const field = (label, input, hint) => {
    const wrap = el("label", "edit__field");
    wrap.append(el("span", "edit__label", label), input);
    if (hint) wrap.append(el("small", "", hint));
    return wrap;
  };
  const name = el("input", "thread__input");
  name.value = profile.username || "";
  name.maxLength = LIMITS.name;
  name.required = true;
  const bio = el("textarea", "cmp__text");
  bio.rows = 3; bio.maxLength = LIMITS.bio; bio.value = profile.bio || "";
  const fav = el("input", "thread__input");
  fav.setAttribute("list", "dex-names");
  fav.placeholder = "e.g. pikachu";
  fav.value = profile.favoritePokemon?.name || "";
  fav.autocomplete = "off";

  // avatar
  let newFile = null, removeAvatar = false, previewUrl = null;
  const prev = el("img", "av av--xl");
  prev.alt = "Profile picture preview";
  prev.src = safeSrc(profile.photoURL) || avatarFallback(profile.username);
  const pick = el("input");
  pick.type = "file"; pick.accept = IMAGE_TYPES.join(","); pick.hidden = true;
  const choose = el("button", "btn btn--ghost btn--sm", "Upload photo");
  choose.type = "button";
  const drop = el("button", "btn btn--ghost btn--sm", "Remove photo");
  drop.type = "button";
  choose.addEventListener("click", () => pick.click());
  pick.addEventListener("change", () => {
    const f = pick.files[0];
    pick.value = "";
    if (!f) return;
    const err = validateImage(f);
    if (err) return toast(err, "error");
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    newFile = f; removeAvatar = false;
    previewUrl = URL.createObjectURL(f);
    prev.src = previewUrl;
  });
  drop.addEventListener("click", () => { newFile = null; removeAvatar = true; prev.src = avatarFallback(name.value); });
  const avRow = el("div", "edit__avatar");
  const avBtns = el("div", "edit__avatar-btns");
  avBtns.append(choose, drop);
  avRow.append(prev, avBtns, pick);

  // team
  const teamBox = el("div", "edit__team");
  const slots = Array.from({ length: 6 }, (_, i) => {
    const input = el("input", "thread__input");
    input.setAttribute("list", "dex-names");
    input.placeholder = "Pokémon " + (i + 1);
    input.autocomplete = "off";
    input.setAttribute("aria-label", "Team Pokémon " + (i + 1));
    input.value = profile.team?.[i]?.name || "";
    teamBox.append(input);
    return input;
  });

  const actions = el("div", "share__actions");
  const cancel = el("button", "btn btn--ghost btn--sm", "Cancel");
  cancel.type = "button";
  const save = el("button", "btn btn--primary btn--sm", "Save changes");
  save.type = "submit";
  actions.append(cancel, save);

  form.append(
    field("Profile picture", avRow),
    field("Username", name, "2 to 20 characters. Also shown on the leaderboard."),
    field("Bio", bio, "Up to " + LIMITS.bio + " characters."),
    field("Favourite Pokémon", fav),
    field("Team (up to 6)", teamBox),
    actions
  );
  const modal = openModal("Edit profile", form, { wide: true, onClose: () => previewUrl && URL.revokeObjectURL(previewUrl) });
  cancel.addEventListener("click", modal.close);

  let names = [];
  try {
    names = await getAllNames();
    if (!document.getElementById("dex-names")) {
      const dl = el("datalist");
      dl.id = "dex-names";
      names.forEach((n) => { const o = document.createElement("option"); o.value = n; dl.append(o); });
      document.body.append(dl);
    }
  } catch { toast("Pokémon names could not be loaded, so favourite and team stay as they are.", "info"); fav.disabled = true; slots.forEach((s) => (s.disabled = true)); }

  const toMon = (text) => {
    const v = text.trim().toLowerCase().replace(/\s+/g, "-");
    if (!v) return null;
    const i = names.indexOf(v);
    if (i < 0) throw new Error(`"${text.trim()}" is not a Pokémon name. Pick one from the list.`);
    return { id: i + 1, name: names[i] };
  };

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const username = name.value.trim();
    if (username.length < 2) return toast("Usernames need at least 2 characters.", "error");
    let favorite = profile.favoritePokemon ?? null, team = profile.team || [];
    try {
      if (!fav.disabled) {
        favorite = toMon(fav.value);
        team = slots.map((s) => toMon(s.value)).filter(Boolean);
      }
    } catch (err) { return toast(err.message, "error"); }

    save.disabled = true;
    save.textContent = "Saving...";
    try {
      const patch = { bio: bio.value.trim().slice(0, LIMITS.bio), favoritePokemon: favorite, team };
      let oldPath = null;
      if (newFile) {
        const stored = await storeImage(newFile, { kind: "avatar", uid: profile.uid });
        if (stored.inline) toast("Image storage is not enabled yet, so a smaller copy was saved on your profile.", "info");
        oldPath = profile.photoPath;
        patch.photoURL = stored.url; patch.photoPath = stored.path;
      } else if (removeAvatar) {
        oldPath = profile.photoPath;
        patch.photoURL = null; patch.photoPath = null;
      }
      const renamed = username !== profile.username;
      if (renamed) {
        await setDisplayName(S.user, username);
        patch.username = username;
      }
      profile = await saveProfile(profile.uid, patch);
      S.doc = profile;
      if (oldPath) removeStored(oldPath);
      if (renamed) store.syncLocal(S.user).catch((e) => console.warn("Leaderboard name not updated:", e.code || e.message)); // same as profile.html
      try { if (profile.photoURL) localStorage.setItem("pe_avatar_" + profile.uid, profile.photoURL); else localStorage.removeItem("pe_avatar_" + profile.uid); } catch { /* storage full */ }
      toast("Profile saved.", "success");
      modal.close();
      render();
    } catch (err) {
      console.warn(err);
      toast("Could not save your profile. Check your connection and the Firestore rules.", "error");
      save.disabled = false;
      save.textContent = "Save changes";
    }
  });
}

/* ---------- page ---------- */
function render() {
  cleanTab?.();
  cleanTab = null;
  const tabs = el("div", "hub-chips tp-tabs");
  tabs.setAttribute("role", "group");
  tabs.setAttribute("aria-label", "Profile sections");
  TABS.forEach(([id, label]) => {
    const c = el("button", "chip", label);
    c.type = "button";
    c.dataset.id = id;
    c.addEventListener("click", () => {
      if (id === "posts") { history.replaceState(null, "", location.pathname + location.search); showTab(); }
      else location.hash = "#" + id; // the hashchange listener shows the tab
    });
    tabs.append(c);
  });
  document.title = (profile.username || "Trainer") + " | PokéExplorer";
  root.replaceChildren(header(), tabs, el("div", "tp-content"));
  showTab();
}

window.addEventListener("hashchange", () => { if (profile) showTab(); });

let started = false;
onUser(async (user) => {
  stopFollowing?.();
  stopFollowing = null;
  S.user = user; S.doc = null; S.following = new Set();
  const wanted = new URLSearchParams(location.search).get("uid") || user?.uid;
  if (user) {
    try {
      S.doc = await syncSelf(user, await ensureUser(user));
      stopFollowing = subscribeFollowing(user.uid, (set) => { S.following = set; emit(); }, () => {});
    } catch (e) { console.warn("Could not open your trainer profile:", e.code || e.message); }
  }
  emit();
  if (!wanted) {
    root.replaceChildren(stateBox("Log in to see your trainer page", "Your page shows your team, collection, badges and rankings.", linkButton("Log in or sign up", "login.html")));
    return;
  }
  isMe = !!user && wanted === user.uid;
  profile = isMe && S.doc ? S.doc : await loadUser(wanted, true);
  if (!profile) {
    root.replaceChildren(stateBox("Trainer not found", "That trainer page does not exist, or the Firestore rules are not published yet.", linkButton("Browse trainers", "community.html#trainers")));
    return;
  }
  if (isMe && profile.photoURL) { try { localStorage.setItem("pe_avatar_" + profile.uid, profile.photoURL); } catch { /* storage full */ } }
  render();
});
