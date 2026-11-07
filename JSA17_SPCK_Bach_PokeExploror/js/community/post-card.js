// One feed post: author, text, photo / video / Pokémon / team / badge, like button, and a live comment thread.
// createPostCard() returns { el, update(post), destroy() } so the feed can refresh it in place.
import { el, toast, confirmAction } from "../core/ui.js";
import { S } from "./state.js";
import {
  setLike, hasLiked, deletePost, subscribeComments, addComment, deleteComments, LIMITS
} from "./data.js";
import { embedSrc, validVideo } from "./media.js";
import {
  avatar, userLink, timeEl, icon, hydrate, attachmentEl, safeSrc, openLightbox, stateBox
} from "./view.js";

const VERBS = { pack: "opened a Lucky Spin pack", card: "is showing off a Pokémon", team: "shared a team", badge: "unlocked a badge" };
const likedMemo = new Map(); // postId -> did the signed-in trainer like it (cleared when the account changes)
let memoOwner = null;

function pill(iconName, label) {
  const b = el("button", "pill");
  b.type = "button";
  const count = el("span", "pill__n", label);
  b.append(icon(iconName), count);
  return { b, count };
}

/* ---------------------------------------------------------- */
/* Comments                                                     */
/* ---------------------------------------------------------- */
function createThread(getPost) {
  const wrap = el("section", "thread");
  wrap.hidden = true;
  const list = el("ul", "thread__list");
  const note = el("p", "thread__note", "Loading comments...");
  const form = el("form", "thread__form");
  const replying = el("div", "thread__replying");
  replying.hidden = true;
  const replyText = el("span");
  const cancel = el("button", "text-link-btn", "Cancel");
  cancel.type = "button";
  replying.append(replyText, cancel);
  const row = el("div", "thread__row");
  const input = el("input", "thread__input");
  input.maxLength = LIMITS.comment;
  input.placeholder = "Write a comment";
  input.setAttribute("aria-label", "Write a comment");
  const send = el("button", "btn btn--primary btn--sm", "Send");
  send.type = "submit";
  row.append(input, send);
  form.append(replying, row);
  const guest = el("p", "thread__guest");
  const login = el("a", "", "Log in");
  login.href = "login.html";
  guest.append(login, " to join the conversation.");
  wrap.append(note, list, form, guest);

  let comments = [], unsub = null, reply = null;

  const setReply = (r) => {
    reply = r;
    replying.hidden = !r;
    if (r) { replyText.textContent = "Replying to " + r.name; input.focus(); } else replyText.textContent = "";
  };
  cancel.addEventListener("click", () => setReply(null));

  function item(c, isReply, replies) {
    const post = getPost();
    const li = el("li", "comment" + (isReply ? " comment--reply" : ""));
    const body = el("div", "comment__body");
    const meta = el("div", "comment__meta");
    meta.append(userLink(c.authorUid, c.authorName, "comment__name"), timeEl(c.createdMs, "comment__time"));
    body.append(meta, el("p", "comment__text", c.text));
    const actions = el("div", "comment__actions");
    if (S.user) {
      const r = el("button", "text-link-btn", "Reply");
      r.type = "button";
      r.addEventListener("click", () => {
        setReply({ topId: c.parentId || c.id, uid: c.authorUid, name: c.authorName });
        if (isReply && !input.value) input.value = "@" + c.authorName + " ";
      });
      actions.append(r);
    }
    if (S.user && (S.user.uid === c.authorUid || S.user.uid === post.authorUid)) {
      const d = el("button", "text-link-btn text-link-btn--danger", "Delete");
      d.type = "button";
      d.addEventListener("click", async () => {
        const ids = [c.id, ...(replies.get(c.id) || []).map((x) => x.id)];
        if (!(await confirmAction(ids.length > 1 ? "Delete this comment and its replies?" : "Delete this comment?"))) return;
        try { await deleteComments(post.id, ids); toast("Comment deleted.", "info"); }
        catch (e) { console.warn(e); toast("Could not delete that comment.", "error"); }
      });
      actions.append(d);
    }
    body.append(actions);
    li.append(avatar(c.authorUid, c.authorName, "sm"), body);
    return li;
  }

  function draw() {
    const ids = new Set(comments.map((c) => c.id));
    const replies = new Map();
    const tops = [];
    comments.forEach((c) => {
      if (c.parentId && ids.has(c.parentId)) replies.set(c.parentId, [...(replies.get(c.parentId) || []), c]);
      else tops.push(c);
    });
    list.replaceChildren(...tops.flatMap((c) => [item(c, false, replies), ...(replies.get(c.id) || []).map((r) => item(r, true, replies))]));
    note.hidden = comments.length > 0;
    note.textContent = "No comments yet. Start the conversation.";
    hydrate(list);
  }

  function refreshAuth() {
    form.hidden = !S.user;
    guest.hidden = !!S.user;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text || !S.user) return;
    send.disabled = true;
    try {
      await addComment(S.user, getPost(), text, reply ? { topId: reply.topId, toUid: reply.uid } : null);
      input.value = "";
      setReply(null);
    } catch (err) {
      console.warn(err);
      toast("Could not post your comment.", "error");
    }
    send.disabled = false;
  });

  return {
    el: wrap,
    refreshAuth,
    start() {
      wrap.hidden = false;
      refreshAuth();
      if (unsub) return;
      unsub = subscribeComments(getPost().id, (list2) => { comments = list2; draw(); }, (err) => {
        console.warn(err);
        note.hidden = false;
        note.textContent = "Could not load comments.";
      });
    },
    stop() { wrap.hidden = true; unsub?.(); unsub = null; }
  };
}

/* ---------------------------------------------------------- */
/* Post                                                         */
/* ---------------------------------------------------------- */
export function createPostCard(initial, { openComments = false, onDeleted } = {}) {
  let post = initial;
  let liked = false, busy = false;
  const root = el("article", "cpost");

  /* header */
  const head = el("header", "cpost__head");
  const avLink = el("a", "cpost__av");
  avLink.href = "trainer.html?uid=" + encodeURIComponent(post.authorUid);
  avLink.setAttribute("aria-label", post.authorName + "'s profile");
  avLink.append(avatar(post.authorUid, post.authorName, "md"));
  const who = el("div", "cpost__who");
  const line = el("div", "cpost__line");
  line.append(userLink(post.authorUid, post.authorName, "cpost__name"));
  if (VERBS[post.type]) line.append(el("span", "cpost__verb", VERBS[post.type]));
  who.append(line, timeEl(post.createdMs, "cpost__time"));
  const del = el("button", "icon-action icon-action--danger");
  del.type = "button";
  del.title = "Delete post";
  del.setAttribute("aria-label", "Delete post");
  del.append(icon("trash"));
  head.append(avLink, who, del);
  root.append(head);

  /* body: text, then at most one of photo / video / attachment */
  if (post.text) root.append(el("p", "cpost__text", post.text));
  const src = safeSrc(post.imageURL);
  if (src) {
    const btn = el("button", "cpost__photo");
    btn.type = "button";
    btn.setAttribute("aria-label", "View photo full size");
    const img = el("img");
    img.src = src;
    img.alt = "Photo shared by " + post.authorName;
    img.loading = "lazy";
    btn.append(img);
    btn.addEventListener("click", () => openLightbox(src, img.alt));
    root.append(btn);
  } else if (post.video && validVideo(post.video)) {
    const box = el("div", "cpost__video");
    const frame = el("iframe");
    frame.src = embedSrc(post.video);
    frame.title = "Video shared by " + post.authorName;
    frame.loading = "lazy";
    frame.allowFullscreen = true;
    frame.setAttribute("allow", "fullscreen; picture-in-picture; encrypted-media");
    frame.setAttribute("referrerpolicy", "strict-origin-when-cross-origin");
    frame.setAttribute("sandbox", "allow-scripts allow-same-origin allow-presentation allow-popups");
    box.append(frame);
    root.append(box);
  }
  const att = attachmentEl(post.attachment);
  if (att) root.append(att);

  /* footer */
  const bar = el("footer", "cpost__bar");
  const like = pill("heart", "0");
  const talk = pill("comment", "0");
  talk.b.setAttribute("aria-expanded", "false");
  const share = el("button", "pill pill--quiet");
  share.type = "button";
  share.append(icon("link"), el("span", "pill__n", "Copy link"));
  bar.append(like.b, talk.b, share);
  root.append(bar);

  let thread = null;
  const getPost = () => post;

  function paintLike() {
    like.b.classList.toggle("is-on", liked);
    like.b.setAttribute("aria-pressed", String(liked));
    like.b.setAttribute("aria-label", (liked ? "Unlike" : "Like") + " this post");
  }

  like.b.addEventListener("click", async () => {
    if (!S.user) return toast("Log in to like posts.", "info");
    if (busy) return;
    busy = true;
    const next = !liked;
    liked = next; paintLike();
    try { await setLike(S.user, post, next); likedMemo.set(post.id, next); }
    catch (e) { console.warn(e); liked = !next; paintLike(); toast("Could not update your like.", "error"); }
    busy = false;
  });

  function toggleThread(open) {
    if (!thread) { thread = createThread(getPost); root.append(thread.el); }
    const show = open ?? thread.el.hidden;
    if (show) thread.start(); else thread.stop();
    talk.b.setAttribute("aria-expanded", String(show));
  }
  talk.b.addEventListener("click", () => toggleThread());

  share.addEventListener("click", async () => {
    const url = new URL("community.html#post/" + post.id, location.href).href;
    try { await navigator.clipboard.writeText(url); toast("Link copied.", "success"); }
    catch { toast(url, "info"); }
  });

  del.addEventListener("click", async () => {
    if (!(await confirmAction("Delete this post? Its comments and likes go with it."))) return;
    del.disabled = true;
    try { await deletePost(post); toast("Post deleted.", "info"); onDeleted?.(post); }
    catch (e) { console.warn(e); toast("Could not delete that post.", "error"); del.disabled = false; }
  });

  function update(next) {
    post = next;
    like.count.textContent = String(Math.max(0, post.likeCount || 0));
    talk.count.textContent = String(Math.max(0, post.commentCount || 0));
    del.hidden = !(S.user && S.user.uid === post.authorUid);
    thread?.refreshAuth();

    if (memoOwner !== (S.user?.uid || null)) { likedMemo.clear(); memoOwner = S.user?.uid || null; }
    if (!S.user) { liked = false; paintLike(); return; }
    if (likedMemo.has(post.id)) { if (!busy) { liked = likedMemo.get(post.id); paintLike(); } return; }
    likedMemo.set(post.id, false);
    hasLiked(S.user.uid, post.id).then((v) => { likedMemo.set(post.id, v); if (!busy) { liked = v; paintLike(); } });
  }

  update(post);
  hydrate(root);
  if (openComments) toggleThread(true);
  return { el: root, update, destroy: () => thread?.stop() };
}

export const postGone = () => stateBox("This post is gone", "It may have been deleted by its author.");
