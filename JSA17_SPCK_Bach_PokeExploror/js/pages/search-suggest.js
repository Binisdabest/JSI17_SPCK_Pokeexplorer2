/* ==========================================================
   search-suggest.js
   Autocomplete for the search box (ARIA combobox). Suggestions come from the local Pokédex index in dex.js,
   so typing never makes a network request. Everything is built with el(); typed text is never parsed as HTML.
   ========================================================== */

import { el } from "../core/ui.js";
import { TYPE_COLORS, spriteUrl } from "../core/api.js";
import { suggest, prettyName, isReady } from "../core/dex.js";

const MIN_CHARS = 2;
const DEBOUNCE_MS = 120;

/**
 * input:    the text field
 * onSelect: called with the chosen {id, name} (click, or Enter on a highlighted row)
 * Plain Enter with nothing highlighted still submits the surrounding form as before.
 * Returns {refresh(), close()}.
 */
export function attachAutocomplete({ input, onSelect }) {
  const listId = "suggest-list";
  const list = el("ul", "suggest");
  list.id = listId;
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Pokémon suggestions");
  list.hidden = true;
  const status = el("div", "visually-hidden"); // screen readers: "5 suggestions"
  status.setAttribute("role", "status");
  input.parentElement.parentElement.append(list, status); // .search-box > form.search-bar > input

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", listId);
  input.setAttribute("aria-expanded", "false");

  let rows = [];     // current suggestions
  let active = -1;   // highlighted row
  let timer = 0;

  function setActive(i) {
    active = i;
    [...list.children].forEach((li, n) => {
      const on = n === i;
      li.setAttribute("aria-selected", String(on));
      li.classList.toggle("is-active", on);
      if (on) li.scrollIntoView({ block: "nearest" });
    });
    if (i >= 0) input.setAttribute("aria-activedescendant", list.children[i].id);
    else input.removeAttribute("aria-activedescendant");
  }

  function close() {
    clearTimeout(timer);
    list.hidden = true;
    input.setAttribute("aria-expanded", "false");
    input.removeAttribute("aria-activedescendant");
    active = -1;
  }

  function choose(i) {
    const row = rows[i];
    if (!row) return;
    input.value = prettyName(row.name);
    close();
    onSelect(row);
  }

  function typeBadge(type) {
    const b = el("span", "suggest__type", type);
    b.style.setProperty("--badge-color", TYPE_COLORS[type]);
    return b;
  }

  function render() {
    list.replaceChildren();
    rows.forEach((row, i) => {
      const li = el("li", "suggest__row");
      li.id = `suggest-opt-${i}`;
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", "false");

      const img = el("img", "suggest__sprite");
      img.src = spriteUrl(row.id);
      img.alt = "";
      img.width = img.height = 40;
      img.loading = "lazy";

      const main = el("span", "suggest__main");
      main.append(el("span", "suggest__name", prettyName(row.name)));
      if (row.alt) main.append(el("span", "suggest__alt", row.alt));

      const types = el("span", "suggest__types");
      row.types.forEach((t) => types.append(typeBadge(t)));

      li.append(img, el("span", "suggest__id mono", "#" + String(row.id).padStart(3, "0")), main, types);
      // mousedown (not click) so the input keeps focus and never fires blur-close first
      li.addEventListener("mousedown", (e) => { e.preventDefault(); choose(i); });
      li.addEventListener("mousemove", () => { if (active !== i) setActive(i); });
      list.append(li);
    });
  }

  function refresh() {
    const text = input.value.trim();
    if (text.length < MIN_CHARS) return close();
    if (!isReady()) { // index still loading: say so instead of showing nothing
      list.replaceChildren(el("li", "suggest__note", "Loading the Pokédex index…"));
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      rows = [];
      return;
    }
    rows = suggest(text, 8);
    if (!rows.length) {
      list.replaceChildren(el("li", "suggest__note", `No Pokémon match “${text}”`));
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      status.textContent = "No suggestions";
      return;
    }
    render();
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
    status.textContent = rows.length === 1 ? "1 suggestion" : rows.length + " suggestions";
    setActive(-1);
  }

  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(refresh, DEBOUNCE_MS); // debounce: one lookup per pause, not per key
  });

  input.addEventListener("keydown", (e) => {
    const open = !list.hidden && rows.length > 0;
    if (e.key === "ArrowDown") {
      if (!open) { refresh(); if (rows.length) setActive(0); } else setActive((active + 1) % rows.length);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      if (open) setActive(active <= 0 ? rows.length - 1 : active - 1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (open && active >= 0) { e.preventDefault(); choose(active); }
      else close(); // plain Enter: let the form submit, and close the list
    } else if (e.key === "Escape") {
      if (!list.hidden) { e.preventDefault(); close(); }
    } else if (e.key === "Tab") {
      close();
    }
  });

  // Click outside closes. (Clicks inside the list are handled on mousedown above.)
  document.addEventListener("pointerdown", (e) => {
    if (!list.hidden && !list.contains(e.target) && e.target !== input) close();
  });

  return { refresh, close };
}
