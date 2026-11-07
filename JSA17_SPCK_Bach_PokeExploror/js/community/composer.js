// The "create a post" box: text, plus one photo, video link, Pokémon, team or badge.
import { el, toast } from "../core/ui.js";
import { S } from "./state.js";
import { createPost, LIMITS } from "./data.js";
import { storeImage, validateImage, parseVideoUrl, IMAGE_TYPES, videoLabel } from "./media.js";
import { avatar, icon, hydrate, attachmentEl } from "./view.js";
import { pickPokemon, pickBadge, teamAttachment } from "./pickers.js";

export function createComposer({ onPosted } = {}) {
  const root = el("form", "cmp");
  const top = el("div", "cmp__top");
  const me = avatar(S.user.uid, S.doc?.username || S.user.displayName, "md");
  const text = el("textarea", "cmp__text");
  text.rows = 3;
  text.maxLength = LIMITS.post;
  text.placeholder = "What's happening in your Pokémon world?";
  text.setAttribute("aria-label", "Post text");
  top.append(me, text);

  const preview = el("div", "cmp__preview");
  preview.hidden = true;
  const videoRow = el("div", "cmp__video");
  videoRow.hidden = true;
  const videoInput = el("input", "thread__input");
  videoInput.type = "url";
  videoInput.placeholder = "Paste a YouTube or Vimeo link";
  videoInput.setAttribute("aria-label", "Video link");
  const videoAdd = el("button", "btn btn--ghost btn--sm", "Add video");
  videoAdd.type = "button";
  videoRow.append(videoInput, videoAdd);

  const file = el("input");
  file.type = "file";
  file.accept = IMAGE_TYPES.join(",");
  file.hidden = true;

  const tools = el("div", "cmp__tools");
  const mk = (ico, label) => { const b = el("button", "tool"); b.type = "button"; b.append(icon(ico), el("span", "", label)); return b; };
  const bPhoto = mk("image", "Photo"), bVideo = mk("video", "Video"), bMon = mk("ball", "Pokémon"), bTeam = mk("team", "Team"), bBadge = mk("award", "Badge");
  const count = el("span", "cmp__count", "0/" + LIMITS.post);
  const post = el("button", "btn btn--primary btn--sm", "Post");
  post.type = "submit";
  tools.append(bPhoto, bVideo, bMon, bTeam, bBadge, count, post);
  root.append(top, preview, videoRow, tools, file);

  // exactly one attachment at a time
  const A = { image: null, video: null, attachment: null, url: null };
  function clear() {
    if (A.url) URL.revokeObjectURL(A.url);
    A.image = A.video = A.attachment = A.url = null;
    preview.replaceChildren();
    preview.hidden = true;
    videoRow.hidden = true;
    videoInput.value = "";
  }
  function show(node) {
    const x = el("button", "icon-action");
    x.type = "button";
    x.setAttribute("aria-label", "Remove attachment");
    x.append(icon("close"));
    x.addEventListener("click", clear);
    preview.replaceChildren(node, x);
    preview.hidden = false;
  }

  text.addEventListener("input", () => { count.textContent = text.value.length + "/" + LIMITS.post; });

  bPhoto.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    const err = validateImage(f);
    if (err) return toast(err, "error");
    clear();
    A.image = f;
    A.url = URL.createObjectURL(f);
    const img = el("img", "cmp__thumb");
    img.src = A.url;
    img.alt = "Selected photo";
    show(img);
  });

  bVideo.addEventListener("click", () => { videoRow.hidden = !videoRow.hidden; if (!videoRow.hidden) videoInput.focus(); });
  const addVideo = () => {
    const v = parseVideoUrl(videoInput.value);
    if (!v) return toast("Paste a YouTube or Vimeo link.", "error");
    clear();
    A.video = v;
    show(el("p", "cmp__chip", videoLabel(v) + " attached"));
  };
  videoAdd.addEventListener("click", addVideo);
  videoInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addVideo(); } });

  const attach = (a) => { if (!a) return; clear(); A.attachment = a; show(attachmentEl(a)); };
  bMon.addEventListener("click", async () => attach(await pickPokemon()));
  bTeam.addEventListener("click", () => attach(teamAttachment()));
  bBadge.addEventListener("click", async () => attach(await pickBadge()));

  root.addEventListener("submit", async (e) => {
    e.preventDefault();
    const body = text.value.trim();
    if (!body && !A.image && !A.video && !A.attachment) return toast("Write something or attach a photo, video or Pokémon.", "error");
    post.disabled = true;
    post.textContent = A.image ? "Uploading..." : "Posting...";
    try {
      let image = null;
      if (A.image) {
        image = await storeImage(A.image, { kind: "post", uid: S.user.uid });
        if (image.inline) toast("Image storage is not enabled yet, so a smaller copy was saved with the post.", "info");
      }
      await createPost(S.user, { text: body, image, video: A.video, attachment: A.attachment });
      text.value = "";
      count.textContent = "0/" + LIMITS.post;
      clear();
      toast("Posted to the community!", "success");
      onPosted?.();
    } catch (err) {
      console.warn(err);
      toast(err.message?.includes("too large") ? err.message : "Could not post. Check your connection and the Firestore rules.", "error");
    }
    post.disabled = false;
    post.textContent = "Post";
  });

  hydrate(root);
  return root;
}
