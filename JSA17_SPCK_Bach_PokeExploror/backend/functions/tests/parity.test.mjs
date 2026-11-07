// Checks that the browser's rarity/finish rules (js/economy/cards.js) match the shared cases the Python server is tested with.
// Run: node backend/functions/tests/parity.test.mjs
import { readFileSync } from "node:fs";
import { cardRarity, cardFinish, normalizeTcgCard, collectionStats, topRarest, exchangeValue } from "../../../js/economy/cards.js";

const cases = JSON.parse(readFileSync(new URL("./rarity_cases.json", import.meta.url)));
let bad = 0;
const check = (name, ok, extra) => { if (!ok) { bad++; console.log("FAIL", name, extra ?? ""); } };
for (const [raw, want] of cases.rarity) check("rarity " + raw, cardRarity(raw) === want, cardRarity(raw));
for (const [raw, keys, want] of cases.finish) check("finish " + raw + keys, cardFinish(raw, keys) === want, cardFinish(raw, keys));

const card = normalizeTcgCard({ id: "test-9", name: "Testmon", number: "9", rarity: "Rare Holo", set: { id: "test", name: "Test Set" }, images: { large: "https://example.com/l.png" }, tcgplayer: { prices: { holofoil: {} } } });
check("normalize", card.rarity === "holo-rare" && card.pointValue === 60 && card.finishType === "holo" && card.setCode === "test", card);
check("unsafe image dropped", normalizeTcgCard({ id: "x", name: "N", images: { large: "javascript:alert(1)" } }).imageUrl === "");
check("unusable card -> null", normalizeTcgCard({ name: "n" }) === null && normalizeTcgCard(null) === null);

const catalog = new Map([
  ["a-1", { cardId: "a-1", setCode: "a", setName: "Set A", rarity: "common", pointValue: 5 }],
  ["a-2", { cardId: "a-2", setCode: "a", setName: "Set A", rarity: "chase", pointValue: 1000 }],
  ["b-1", { cardId: "b-1", setCode: "b", setName: "Set B", rarity: "rare", pointValue: 25 }]
]);
const inv = [{ cardId: "a-1", count: 3 }, { cardId: "a-2", count: 1 }, { cardId: "b-1", count: 2 }, { cardId: "zzz", count: 4 }, { cardId: "a-9", count: 0 }];
const st = collectionStats(inv, catalog, { a: 4, b: 100 });
check("stats totals", st.copies === 10 && st.unique === 4 && st.duplicates === 6 && st.value === 5 * 3 + 1000 + 25 * 2, st);
check("stats per set", st.sets[0].setCode === "a" && st.sets[0].owned === 2 && st.sets[0].percent === 50 && st.sets[1].percent === 1, st.sets);
check("rarest first", topRarest(inv, catalog, 2).map((c) => c.cardId).join() === "a-2,b-1");
check("exchange value matches server (60*0.5=30 each; 1*0.5 -> 1 each)", exchangeValue(60, 3, 0.5) === 90 && exchangeValue(1, 2, 0.5) === 2);
console.log(bad ? bad + " failed" : "parity ok (" + (cases.rarity.length + cases.finish.length) + " shared cases)");
process.exit(bad ? 1 : 0);
