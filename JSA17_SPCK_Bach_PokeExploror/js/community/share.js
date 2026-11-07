// "Share to Community": a small dialog that posts a Pokémon, team or badge to the feed.
// Used by the Community page itself and by the Lucky Spin / Collection pages (which load this file on demand).
import { el, toast } from "../core/ui.js";
import { auth } from "./fb.js";
import { ensureUser, createPost, LIMITS } from "./data.js";
import { openModal, attachmentEl, stateBox, linkButton } from "./view.js";

function ensureCss() {
  if (document.querySelector('link[href*="community.css"]')) return;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = new URL("../../css/community.css", import.meta.url).href;
  document.head.append(link);
}

export function openShare({ attachment, text = "", title = "Share to Community" }) {
  ensureCss();
  const user = auth.currentUser;
  const body = el("div", "share");

  if (!user) {
    body.append(stateBox("Log in to share", "Your post goes on the community feed, so you need an account.", linkButton("Log in or sign up", "login.html")));
    openModal(title, body);
    return;
  }

  const preview = attachmentEl(attachment);
  if (preview) body.append(preview);
  const ta = el("textarea", "cmp__text");
  ta.rows = 3;
  ta.maxLength = LIMITS.post;
  ta.value = text;
  ta.setAttribute("aria-label", "Say something about it");
  ta.placeholder = "Say something about it (optional)";
  const actions = el("div", "share__actions");
  const cancel = el("button", "btn btn--ghost btn--sm", "Cancel");
  cancel.type = "button";
  const send = el("button", "btn btn--primary btn--sm", "Post to feed");
  send.type = "button";
  actions.append(cancel, send);
  body.append(ta, actions);
  const modal = openModal(title, body);
  cancel.addEventListener("click", modal.close);

  send.addEventListener("click", async () => {
    send.disabled = true;
    send.textContent = "Posting...";
    try {
      await ensureUser(user);
      await createPost(user, { text: ta.value, attachment });
      body.replaceChildren(stateBox("Shared!", "Other trainers can now see and like it.", linkButton("Open the feed", "community.html")));
      toast("Shared to the community feed.", "success");
    } catch (e) {
      console.warn(e);
      toast("Could not share. Check your connection and the Firestore rules.", "error");
      send.disabled = false;
      send.textContent = "Post to feed";
    }
  });
}
