// Copy this file to start a new game, then register it in registry.js.
let cleanup = [];

export function init(container, { api, store, ui }) {
  const title = ui.el("h2", "", "My new game");
  container.replaceChildren(title);
  // Build the game here. On finish: store.saveScore("my-game-id", score)
}

export function destroy() {
  cleanup.forEach((fn) => fn());
  cleanup = [];
}
