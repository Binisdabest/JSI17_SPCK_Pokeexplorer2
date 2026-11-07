// Community home: feed, rooms, trainers, notifications and single-post pages, switched by the URL hash.
//   #feed (default)   #rooms   #rooms/<id>   #trainers   #notifications   #post/<id>
import { el, initUI } from "../core/ui.js";
import { onUser } from "../core/auth.js";
import { S, emit, onState } from "../community/state.js";
import {
  ensureUser, subscribeFollowing, subscribeNotifications, subscribePosts, subscribePost, sortPosts, hotScore
} from "../community/data.js";
import { syncSelf } from "../community/sync.js";
import { createPostCard, postGone } from "../community/post-card.js";
import { createComposer } from "../community/composer.js";
import { renderRoomList, renderRoom } from "../community/chat.js";
import { renderTrainerSearch, renderSuggestions, loginPrompt } from "../community/people.js";
import { renderNotifications } from "../community/notifications.js";
import { icon, reconcile, clearList, avatar, hydrate, stateBox, linkButton } from "../community/view.js";

initUI();

const view = document.getElementById("view");
const rail = document.getElementById("cm-rail");
let cleanup = null, ready = false;

/* ---------- left rail ---------- */
const NAV = [["feed", "Feed", "home"], ["rooms", "Rooms", "comment"], ["trainers", "Trainers", "search"], ["notifications", "Alerts", "bell"]];
const unread = el("span", "rail__badge");
unread.hidden = true;
NAV.forEach(([id, label, ico]) => {
  const a = el("a", "rail__link");
  a.href = "#" + id;
  a.dataset.view = id;
  a.append(icon(ico), el("span", "", label));
  if (id === "notifications") a.append(unread);
  rail.append(a);
});
const mine = el("a", "rail__link rail__link--me");
mine.href = "trainer.html";
mine.append(icon("user"), el("span", "", "My trainer page"));
rail.append(mine);

function paintRail(active) {
  rail.querySelectorAll("[data-view]").forEach((a) => a.classList.toggle("is-active", a.dataset.view === active));
  const n = S.notifs.filter((x) => !x.read).length;
  unread.hidden = n === 0;
  unread.textContent = n > 9 ? "9+" : String(n);
  mine.href = S.user ? "trainer.html?uid=" + encodeURIComponent(S.user.uid) : "login.html";
}

/* ---------- feed ---------- */
const SORTS = [["newest", "Newest"], ["popular", "Popular"], ["liked", "Most liked"]];
const SCOPES = [["all", "Everyone"], ["following", "Following"]];

function chips(items, current, onPick, label) {
  const box = el("div", "hub-chips");
  box.setAttribute("role", "group");
  box.setAttribute("aria-label", label);
  items.forEach(([id, text]) => {
    const c = el("button", "chip", text);
    c.type = "button";
    c.dataset.id = id;
    c.setAttribute("aria-pressed", String(id === current));
    c.addEventListener("click", () => { onPick(id); box.querySelectorAll(".chip").forEach((x) => x.setAttribute("aria-pressed", String(x.dataset.id === id))); });
    box.append(c);
  });
  return box;
}

function renderFeed(container) {
  let sort = "newest", scope = "all", n = 30, data = [], unsub = null, loaded = false, failed = false;

  const top = el("div", "cm-composer-slot");
  const bar = el("div", "cm-bar");
  const status = el("div", "cm-status");
  const list = el("div", "cpost-list");
  const more = el("button", "btn btn--ghost", "Show more posts");
  more.type = "button";
  more.hidden = true;
  const sortChips = chips(SORTS, sort, (id) => { const refetch = (id === "liked") !== (sort === "liked"); sort = id; refetch ? subscribe() : draw(); }, "Sort posts");
  const scopeChips = chips(SCOPES, scope, (id) => { scope = id; subscribe(); }, "Whose posts");
  bar.append(scopeChips, sortChips);
  container.append(top, bar, status, list, more);

  function paintComposer() {
    if (!S.user) top.replaceChildren(loginPrompt("Log in to post photos, share your pulls and join the conversation."));
    else if (!S.doc) top.replaceChildren(stateBox("Your trainer profile could not be opened", "Publish the Firestore rules from the README, then reload this page."));
    else top.replaceChildren(createComposer());
  }

  function draw() {
    let posts = sortPosts(data, sort);
    if (scope === "following") posts = posts.slice(0, n);
    reconcile(list, posts, (p) => p.id, (p) => createPostCard(p, { onDeleted: (d) => { data = data.filter((x) => x.id !== d.id); draw(); } }), (c, p) => c.update(p));
    hydrate(list);
    more.hidden = !(scope === "all" && data.length >= n && !failed);
    if (failed) return;
    status.replaceChildren();
    if (!loaded) status.append(el("div", "loading-ring"));
    else if (!posts.length) {
      if (scope === "following") {
        status.append(stateBox(S.following.size ? "Nothing new yet" : "You are not following anyone yet", S.following.size ? "The trainers you follow have not posted lately." : "Follow a few trainers and their posts show up here.", linkButton("Find trainers", "#trainers", "btn btn--primary")));
      } else status.append(stateBox("No posts yet", "Be the first to share something with the community."));
    }
  }

  function subscribe() {
    unsub?.();
    loaded = false; failed = false; data = [];
    clearList(list);
    draw();
    const authors = scope === "following" ? (S.user ? [S.user.uid, ...S.following] : []) : null;
    unsub = subscribePosts({ sort, n, authors }, (posts) => { data = posts; loaded = true; draw(); }, (err) => {
      console.warn(err);
      failed = true;
      status.replaceChildren(stateBox("Could not load the feed", "Check your connection and that the Firestore rules are published (see the README)."));
    });
  }

  more.addEventListener("click", () => { n += 30; subscribe(); });

  let seenFollowing = S.following.size, seenUser = S.user?.uid;
  const off = onState(() => {
    if (seenUser !== S.user?.uid) { seenUser = S.user?.uid; paintComposer(); }
    if (scope === "following" && seenFollowing !== S.following.size) { seenFollowing = S.following.size; subscribe(); return; }
    seenFollowing = S.following.size;
    draw();
  });

  paintComposer();
  subscribe();
  return () => { unsub?.(); off(); clearList(list); };
}

/* ---------- single post ---------- */
function renderPost(container, id) {
  const back = el("a", "btn btn--ghost btn--sm", "Back to feed");
  back.href = "#feed";
  const slot = el("div");
  const row = el("div", "cm-row");
  row.append(back);
  container.append(row, slot);
  let card = null;
  const unsub = subscribePost(id, (post) => {
    if (!post) { card?.destroy(); card = null; slot.replaceChildren(postGone()); return; }
    if (!card) { card = createPostCard(post, { openComments: true, onDeleted: () => { location.hash = "#feed"; } }); slot.replaceChildren(card.el); }
    else card.update(post);
  }, () => slot.replaceChildren(stateBox("Could not load this post", "Check your connection and try again.")));
  return () => { unsub(); card?.destroy(); };
}

/* ---------- other views ---------- */
function renderRooms(container, id) {
  if (id) return renderRoom(container, id);
  renderRoomList(container);
  return null;
}
function renderTrainers(container) {
  container.append(el("h2", "cm-h2", "Find trainers"));
  return renderTrainerSearch(container);
}

const VIEWS = {
  feed: renderFeed,
  post: renderPost,
  rooms: renderRooms,
  trainers: renderTrainers,
  notifications: (c) => (S.user ? renderNotifications(c) : (c.append(loginPrompt("Log in to see likes, comments and new followers.")), null))
};

function route() {
  if (!ready) return;
  cleanup?.();
  cleanup = null;
  view.replaceChildren();
  const [name, arg] = location.hash.replace(/^#\/?/, "").split("/");
  const key = VIEWS[name] ? name : "feed";
  paintRail(key === "post" ? "feed" : key);
  cleanup = VIEWS[key](view, arg ? decodeURIComponent(arg) : undefined) || null;
}
window.addEventListener("hashchange", () => { route(); window.scrollTo({ top: 0 }); });

/* ---------- sidebar ---------- */
const trendingBox = document.getElementById("trending");
const suggestBox = document.getElementById("suggest");
subscribePosts({ sort: "newest", n: 50 }, (posts) => {
  const now = Date.now();
  const top = posts.filter((p) => (p.likeCount || 0) + (p.commentCount || 0) > 0).sort((a, b) => hotScore(b, now) - hotScore(a, now)).slice(0, 5);
  if (!top.length) { trendingBox.replaceChildren(el("p", "side__empty", "Nothing is trending yet. Like and comment to get things moving.")); return; }
  const ul = el("ul", "trend");
  top.forEach((p) => {
    const li = el("li");
    const a = el("a", "trend__item");
    a.href = "#post/" + encodeURIComponent(p.id);
    const label = p.text || ({ image: "Shared a photo", video: "Shared a video", pack: "Opened a Lucky Spin pack", card: "Showed off a Pokémon", team: "Shared a team", badge: "Unlocked a badge" }[p.type] || "New post");
    a.append(avatar(p.authorUid, p.authorName, "sm"), el("span", "trend__text", label), el("span", "trend__n", String(p.likeCount || 0)));
    li.append(a);
    ul.append(li);
  });
  hydrate(ul);
  trendingBox.replaceChildren(ul);
}, () => trendingBox.replaceChildren(el("p", "side__empty", "Trending is unavailable right now.")));

/* ---------- account ---------- */
let stopFollowing = null, stopNotifs = null, suggestFor = null;
onUser(async (user) => {
  stopFollowing?.(); stopNotifs?.();
  stopFollowing = stopNotifs = null;
  S.user = user; S.doc = null; S.following = new Set(); S.notifs = [];
  if (user) {
    try {
      S.doc = await ensureUser(user);
      S.doc = await syncSelf(user, S.doc);
      stopFollowing = subscribeFollowing(user.uid, (set) => { S.following = set; emit(); }, (e) => console.warn(e));
      stopNotifs = subscribeNotifications(user.uid, (list) => { S.notifs = list; emit(); }, (e) => console.warn(e));
    } catch (e) {
      console.warn("Could not open your trainer profile:", e.code || e.message);
    }
  }
  ready = true;
  emit();
  route();
});

onState(() => {
  paintRail(rail.querySelector(".is-active")?.dataset.view || "feed");
  const key = (S.user?.uid || "") + ":" + S.following.size;
  if (suggestFor !== key) { suggestFor = key; renderSuggestions(suggestBox); }
});
