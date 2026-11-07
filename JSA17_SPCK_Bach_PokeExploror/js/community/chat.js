// Discussion rooms: a room list (reusing the game-card look) and a live chat room.
import { el, toast } from "../core/ui.js";
import { S, onState } from "./state.js";
import { ROOMS, roomById } from "./rooms.js";
import { subscribeMessages, sendMessage, deleteMessage, LIMITS } from "./data.js";
import { artworkUrl } from "../core/api.js";
import { avatar, userLink, clockTime, icon, hydrate, reconcile, clearList, stateBox } from "./view.js";

export function renderRoomList(container) {
  container.append(el("h2", "cm-h2", "Discussion rooms"), el("p", "cm-sub", "Pick a topic and chat with other trainers in real time."));
  const grid = el("div", "game-grid cm-rooms");
  ROOMS.forEach((r) => {
    const card = el("a", "game-card");
    card.href = "#rooms/" + r.id;
    const thumb = el("div", "game-card__thumb");
    thumb.style.setProperty("--c", r.color);
    const img = el("img");
    img.src = artworkUrl(r.mon);
    img.alt = "";
    img.loading = "lazy";
    img.onerror = () => { img.style.visibility = "hidden"; };
    thumb.append(img);
    const body = el("div", "game-card__body");
    const top = el("div", "game-card__top");
    top.append(el("h3", "", r.name));
    body.append(top, el("p", "game-card__desc", r.blurb));
    card.append(thumb, body);
    grid.append(card);
  });
  container.append(grid);
}

function messageCard(m) {
  const li = el("li", "msg");
  const body = el("div", "msg__body");
  const meta = el("div", "msg__meta");
  meta.append(userLink(m.authorUid, m.authorName, "msg__name"), el("time", "msg__time", clockTime(m.createdMs)));
  const del = el("button", "icon-action icon-action--danger msg__del");
  del.type = "button";
  del.title = "Delete message";
  del.setAttribute("aria-label", "Delete message");
  del.append(icon("trash"));
  del.addEventListener("click", async () => {
    del.disabled = true;
    try { await deleteMessage(m.id); } catch (e) { console.warn(e); toast("Could not delete that message.", "error"); del.disabled = false; }
  });
  meta.append(del);
  body.append(meta, el("p", "msg__text", m.text));
  li.append(avatar(m.authorUid, m.authorName, "sm"), body);
  const card = { el: li, update(next) { del.hidden = !(S.user && S.user.uid === next.authorUid); } };
  card.update(m);
  return card;
}

export function renderRoom(container, roomId) {
  const room = roomById(roomId);
  if (!room) {
    const back = el("a", "btn btn--ghost", "All rooms");
    back.href = "#rooms";
    container.append(stateBox("Room not found", "That room does not exist.", back));
    return null;
  }
  const head = el("div", "cm-row");
  const back = el("a", "btn btn--ghost btn--sm", "All rooms");
  back.href = "#rooms";
  const title = el("div");
  title.append(el("h2", "cm-h2", room.name), el("p", "cm-sub", room.blurb));
  head.append(title, back);

  const panel = el("div", "chat");
  const scroller = el("div", "chat__scroll");
  scroller.tabIndex = 0;
  scroller.setAttribute("aria-label", room.name + " messages");
  const status = el("p", "chat__status", "Loading messages...");
  const list = el("ul", "chat__list");
  list.setAttribute("aria-live", "polite");
  scroller.append(status, list);

  const form = el("form", "chat__form");
  const input = el("input", "chat__input");
  input.maxLength = LIMITS.message;
  input.autocomplete = "off";
  input.setAttribute("aria-label", "Message");
  const send = el("button", "btn btn--primary btn--sm", "Send");
  send.type = "submit";
  form.append(input, send);
  const guest = el("p", "chat__guest");
  const login = el("a", "", "Log in");
  login.href = "login.html";
  guest.append(login, " to join the chat.");
  panel.append(scroller, form, guest);
  container.append(head, panel);

  const authUi = () => {
    form.hidden = !S.user;
    guest.hidden = !!S.user;
    input.placeholder = "Message #" + room.name;
  };
  authUi();

  let messages = [], first = true, lastSent = 0;
  const draw = () => {
    const stick = first || scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 90;
    reconcile(list, messages, (m) => m.id, messageCard, (c, m) => c.update(m));
    status.hidden = messages.length > 0;
    status.textContent = "No messages yet. Say hello!";
    hydrate(list);
    if (stick) scroller.scrollTop = scroller.scrollHeight;
    first = false;
  };

  const unsub = subscribeMessages(room.id, (data) => { messages = data; draw(); }, (err) => {
    console.warn(err);
    status.hidden = false;
    const link = String(err.message || "").match(/https:\/\/console\.firebase\.google\.com\S+/);
    status.textContent = err.code === "failed-precondition"
      ? "This chat needs a one-time Firestore index. " + (link ? "Open this link and press Create: " + link[0] : "See the README (Firestore indexes).")
      : "Could not load messages. Check your connection and the Firestore rules.";
  });
  const unState = onState(() => { authUi(); draw(); });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !S.user) return;
    if (Date.now() - lastSent < 800) return toast("Slow down a little.", "info");
    lastSent = Date.now();
    input.value = "";
    try { await sendMessage(S.user, room.id, text); }
    catch (err) { console.warn(err); input.value = text; toast("Could not send your message.", "error"); }
    input.focus();
  });

  return () => { unsub(); unState(); clearList(list); };
}
