// Follow buttons, trainer rows, trainer search and "who to follow".
import { el, toast } from "../core/ui.js";
import { S, onState, emit } from "./state.js";
import { setFollow, searchUsers, topTrainers } from "./data.js";
import { avatar, hydrate, userLink, stateBox, linkButton } from "./view.js";

function paint(btn) {
  const on = S.following.has(btn.dataset.uid);
  btn.textContent = on ? "Following" : "Follow";
  btn.setAttribute("aria-pressed", String(on));
  btn.classList.toggle("is-on", on);
}
// One listener repaints every follow button on the page whenever the follow list changes.
onState(() => document.querySelectorAll(".follow-btn").forEach(paint));

export function followButton(uid) {
  if (S.user && S.user.uid === uid) return null;
  const btn = el("button", "btn btn--ghost btn--sm follow-btn");
  btn.type = "button";
  btn.dataset.uid = uid;
  paint(btn);
  btn.addEventListener("click", async () => {
    if (!S.user) { location.href = "login.html"; return; }
    const want = !S.following.has(uid);
    btn.disabled = true;
    try {
      await setFollow(S.user, uid, want);
      if (want) S.following.add(uid); else S.following.delete(uid);
      emit();
      window.dispatchEvent(new CustomEvent("follow-changed", { detail: { uid, following: want } }));
    } catch (e) {
      console.warn(e);
      toast("Could not update that follow.", "error");
    }
    btn.disabled = false;
  });
  return btn;
}

export function trainerRow(u) {
  const li = el("li", "trow");
  const a = el("a", "trow__av");
  a.href = "trainer.html?uid=" + encodeURIComponent(u.uid);
  a.setAttribute("aria-label", (u.username || "Trainer") + "'s profile");
  a.append(avatar(u.uid, u.username, "md"));
  const text = el("div", "trow__text");
  text.append(userLink(u.uid, u.username, "trow__name"));
  if (u.bio) text.append(el("p", "trow__bio", u.bio));
  const pts = el("span", "trow__pts", (u.points || 0).toLocaleString() + " pts");
  pts.title = "PokéPoints";
  li.append(a, text, pts);
  const f = followButton(u.uid);
  if (f) li.append(f);
  return li;
}

function list(users) {
  const ul = el("ul", "trow-list");
  ul.append(...users.map(trainerRow));
  hydrate(ul);
  return ul;
}

/** Search box + results. With an empty box it shows the top trainers by PokéPoints. */
export function renderTrainerSearch(container) {
  const form = el("form", "tsearch");
  form.setAttribute("role", "search");
  const input = el("input", "hub-search");
  input.type = "search";
  input.placeholder = "Search trainers by name";
  input.setAttribute("aria-label", "Search trainers by name");
  input.autocomplete = "off";
  form.append(input);
  const heading = el("h2", "cm-h2", "Top trainers");
  const results = el("div", "tsearch__results", "");
  container.append(form, heading, results);

  let token = 0, timer = null;
  async function run() {
    const mine = ++token;
    const term = input.value.trim();
    heading.textContent = term ? "Results" : "Top trainers";
    results.replaceChildren(el("div", "loading-ring"));
    try {
      const users = term ? await searchUsers(term) : await topTrainers(12);
      if (mine !== token) return;
      results.replaceChildren(users.length ? list(users) : stateBox(term ? "No trainers found" : "No trainers yet", term ? "Check the spelling, or try the first few letters of the name." : "Be the first: set up your trainer page."));
    } catch (e) {
      console.warn(e);
      if (mine === token) results.replaceChildren(stateBox("Could not load trainers", "Check your connection and that the Firestore rules are published."));
    }
  }
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 250); });
  form.addEventListener("submit", (e) => { e.preventDefault(); clearTimeout(timer); run(); });
  run();
  return () => { clearTimeout(timer); token++; };
}

/** Sidebar box: a few top trainers you do not follow yet. */
export async function renderSuggestions(box) {
  try {
    const all = await topTrainers(12);
    const pick = all.filter((u) => !(S.user && u.uid === S.user.uid) && !S.following.has(u.uid)).slice(0, 4);
    box.replaceChildren(pick.length ? list(pick) : el("p", "side__empty", S.user ? "You are following the top trainers already." : "Log in to follow trainers."));
  } catch {
    box.replaceChildren(el("p", "side__empty", "Trainers could not be loaded."));
  }
}

export function loginPrompt(text) {
  const box = stateBox("Join the community", text, linkButton("Log in or sign up", "login.html"));
  box.classList.add("cm-card");
  return box;
}
