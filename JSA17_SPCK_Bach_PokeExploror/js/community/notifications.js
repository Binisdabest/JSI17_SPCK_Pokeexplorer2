// Notification list: likes, comments, replies and follows. The data comes from S.notifs (one live listener in the page).
import { el } from "../core/ui.js";
import { S, onState } from "./state.js";
import { markRead, markAllRead } from "./data.js";
import { avatar, timeEl, hydrate, stateBox, icon } from "./view.js";

const TEXT = {
  like: (n) => " liked your post",
  comment: (n) => " commented on your post",
  reply: (n) => " replied to your comment",
  follow: () => " started following you"
};

function row(n) {
  const a = el("a", "note" + (n.read ? "" : " is-unread"));
  a.href = n.type === "follow" ? "trainer.html?uid=" + encodeURIComponent(n.fromUid) : "community.html#post/" + encodeURIComponent(n.postId || "");
  const text = el("div", "note__text");
  const line = el("p", "note__line");
  const who = el("strong", "", n.fromName || "Someone");
  who.dataset.nm = n.fromUid;
  line.append(who, (TEXT[n.type] || (() => " sent you an update"))(n));
  text.append(line);
  if (n.snippet && n.type !== "follow") text.append(el("p", "note__snippet", "\u201C" + n.snippet + "\u201D"));
  text.append(timeEl(n.createdMs, "note__time"));
  a.append(avatar(n.fromUid, n.fromName, "md"), text);
  if (!n.read) a.append(el("span", "note__dot"));
  a.addEventListener("click", () => { if (!n.read && S.user) markRead(S.user.uid, n.id).catch(() => {}); });
  return a;
}

export function renderNotifications(container) {
  const head = el("div", "cm-row");
  head.append(el("h2", "cm-h2", "Notifications"));
  const all = el("button", "btn btn--ghost btn--sm", "Mark all as read");
  all.type = "button";
  head.append(all);
  const list = el("div", "note-list");
  container.append(head, list);

  all.addEventListener("click", () => { if (S.user) markAllRead(S.user.uid, S.notifs).catch(() => {}); });

  function draw() {
    all.hidden = !S.notifs.some((n) => !n.read);
    if (!S.notifs.length) {
      list.replaceChildren(stateBox("Nothing yet", "Likes, comments, replies and new followers show up here."));
      return;
    }
    list.replaceChildren(...S.notifs.map(row));
    hydrate(list);
  }
  draw();
  return onState(draw);
}

export const bellIcon = () => icon("bell");
