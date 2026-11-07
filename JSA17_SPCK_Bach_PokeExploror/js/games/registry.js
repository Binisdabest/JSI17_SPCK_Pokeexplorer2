// THE GAME LIST. The homepage grid, search and category chips are all built from this array.
// To add a game: create js/games/<id>.js, then add one entry here.
//
// Every game file exports:
//   init(container, context)  - draws the game inside `container`
//                               context = { api, store, ui }
//   destroy()                 - removes listeners/timers when the player leaves
// Set ready: true once the game is playable; the card then links to game.html?id=<id>.
// `pokemon` is the Pokédex number whose artwork is shown on the card.
const art = (id) => `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

export const games = [
  { id: "pokedle", name: "Pokédle", description: "Guess the mystery Pokémon in six tries using type and stat clues.", categories: ["Daily", "Puzzle"], label: "DAILY", image: art(201), color: "#ffcb05", ready: true },
  { id: "higher-lower", name: "Higher or Lower", description: "Which Pokémon has the bigger stat? Build the longest streak you can.", categories: ["Quick"], label: "NEW", image: art(68), color: "#4a8dff", ready: true },
  { id: "pixel-guess", name: "Pixel Guess", description: "Name the Pokémon from a blocky picture. Each wrong guess sharpens it.", categories: ["Puzzle"], label: "NEW", image: art(137), color: "#ff6fa3", ready: true },
  { id: "emoji-riddle", name: "Emoji Riddle", description: "Work out which Pokémon a pair of emoji is hiding.", categories: ["Trivia"], label: "", image: art(54), color: "#4cc764", ready: true },
  { id: "memory-cards", name: "Memory Cards", description: "Flip cards and match the pairs in as few moves as possible.", categories: ["Memory"], label: "", image: art(133), color: "#a77dff", ready: true }
];
