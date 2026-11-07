// Discussion rooms. Fixed list on purpose: no extra Firestore collection, and the rules only accept these ids.
// To add a room: add it here AND to the `validRoom()` list in firestore.rules.
export const ROOMS = [
  { id: "lounge", name: "Trainer Lounge", blurb: "Anything Pokémon. Say hi, ask questions, hang out.", mon: 25, color: "#ffcb05" },
  { id: "pulls", name: "Pull Parade", blurb: "Brag about Lucky Spin pulls and rare finds.", mon: 6, color: "#ff8a3d" },
  { id: "teams", name: "Team Builder", blurb: "Share teams, swap movesets, argue about starters.", mon: 143, color: "#6fb1fc" },
  { id: "games", name: "Game Corner", blurb: "Scores, streaks and tips for every mini game.", mon: 201, color: "#a77dff" },
  { id: "dex", name: "Pokédex Talk", blurb: "Lore, stats, evolutions and favourite Pokémon.", mon: 137, color: "#ff6fa3" }
];
export const roomById = (id) => ROOMS.find((r) => r.id === id);
