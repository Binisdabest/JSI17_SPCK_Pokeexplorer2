/* ==========================================================
   api.js
   Every fetch call to PokéAPI lives here so no other file
   ever has to know a URL. Pages just import what they need.
   ========================================================== */

import { cachedJson, memoJson, dexGet, dexPut, DAY } from "./cache.js";

export const POKEAPI_BASE = "https://pokeapi.co/api/v2";

/**
 * Colors used for type badges across the whole site.
 * Kept here (not in CSS) because JS needs to read these
 * values when it builds cards dynamically.
 */
export const TYPE_COLORS = {
  normal: "#A8A77A", fire: "#EE8130", water: "#6390F0", electric: "#F7D02C",
  grass: "#7AC74C", ice: "#96D9D6", fighting: "#C22E28", poison: "#A33EA1",
  ground: "#E2BF65", flying: "#A98FF3", psychic: "#F95587", bug: "#A6B91A",
  rock: "#B6A136", ghost: "#735797", dragon: "#6F35FC", dark: "#705746",
  steel: "#B7B7CE", fairy: "#D685AD"
};

/**
 * Per-stat colors for the Search detail page — mirrors PokémonDB's
 * approach of giving each stat its own identity instead of one flat bar.
 */
export const STAT_COLORS = {
  hp: "#FF6B6B",
  attack: "#FFA168",
  defense: "#FFD23F",
  "special-attack": "#6FB1FC",
  "special-defense": "#7AC74C",
  speed: "#FF6BCB"
};

/**
 * Shared six-tier rarity ramp (colors + sort weight) used by the
 * collection grid, Lucky Spin rewards, and the TCG card grid so a
 * "Mythical" glows the same way everywhere in the app.
 */
export const RARITY_COLORS = {
  common: "#9AA3B8",
  uncommon: "#7AC74C",
  rare: "#6390F0",
  "ultra-rare": "#8B5CF6",
  legendary: "#FFD23F",
  mythical: "#E63950"
};

/**
 * The Pokémon TCG API returns free-text rarity strings ("Rare Holo",
 * "Rare Secret", "Amazing Rare"...) that don't map 1:1 onto our six
 * tiers. This buckets them so cards can still get a consistent
 * rarity color/glow instead of falling back to gray for everything.
 */
export function normalizeRarity(rawRarity) {
  const value = (rawRarity || "").toLowerCase();
  if (!value) return "common";
  if (value.includes("secret") || value.includes("hyper") || value.includes("rainbow")) return "mythical";
  if (value.includes("ultra") || value.includes("vmax") || value.includes("vstar") || value.includes("gx") || value.includes("ex")) return "legendary";
  if (value.includes("amazing") || value.includes("holo") || value.includes("full art") || value.includes("radiant")) return "ultra-rare";
  if (value.includes("rare")) return "rare";
  if (value.includes("uncommon")) return "uncommon";
  return "common";
}

export const MAX_DEX_ID = 1025;

/** Official artwork PNG for a Pokédex number (no API call needed). */
export const artworkUrl = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`;

/** Small pixel sprite (96px) for a Pokédex number: light enough for long lists and autocomplete. No API call needed. */
export const spriteUrl = (id) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/${id}.png`;

let namesCache = null;
/** All 1025 Pokémon names in Pokédex order, so names[id - 1] is the name of #id. One request, then cached for 30 days. */
export async function getAllNames() {
  if (!namesCache) {
    try {
      const data = await cachedJson(`${POKEAPI_BASE}/pokemon?limit=${MAX_DEX_ID}`);
      namesCache = data.results.map((p) => p.name);
    } catch {
      throw new Error("Could not reach PokéAPI");
    }
  }
  return namesCache;
}

/**
 * Fetches a single RAW Pokémon by name or Pokédex number (large response, kept in memory only).
 * Throws a readable error if it doesn't exist so the caller
 * can decide how to show that (toast, error state, etc.)
 * Most pages want getSimplifiedPokemon(), which is also cached on disk.
 */
export async function getPokemon(idOrName) {
  const query = String(idOrName).toLowerCase().trim();
  try {
    return await memoJson(`${POKEAPI_BASE}/pokemon/${encodeURIComponent(query)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) throw new Error(`Pokémon "${idOrName}" not found`);
    throw err;
  }
}

/**
 * Total number of Pokémon species currently in the Pokédex.
 * Used for the "live count" readout on the home page hero.
 */
export async function getPokemonCount() {
  try {
    const data = await cachedJson(`${POKEAPI_BASE}/pokemon-species?limit=1`, { ttl: DAY });
    return data.count;
  } catch {
    throw new Error("Could not reach PokéAPI");
  }
}

/**
 * Pulls out just the fields the UI actually needs from the
 * (very large) raw PokéAPI response. Every page should call
 * this instead of reaching into the raw object directly —
 * if PokéAPI ever changes shape, we only fix it in one place.
 */
export function simplifyPokemon(raw) {
  return {
    id: raw.id,
    name: raw.name,
    types: raw.types.map((t) => t.type.name),
    height: raw.height / 10, // decimetres -> metres
    weight: raw.weight / 10, // hectograms -> kilograms
    abilities: raw.abilities.map((a) => a.ability.name),
    stats: Object.fromEntries(
      raw.stats.map((s) => [s.stat.name, s.base_stat])
    ),
    artwork:
      raw.sprites?.other?.["official-artwork"]?.front_default ||
      raw.sprites?.front_default ||
      ""
  };
}

/**
 * Convenience helper: fetch + simplify in one call.
 * This is what most pages will actually use.
 */
export async function getSimplifiedPokemon(idOrName) {
  const query = String(idOrName).toLowerCase().trim();

  // Work out the Pokédex number so the on-disk Pokédex index can answer without any request.
  let id = /^\d+$/.test(query) ? Number(query) : null;
  if (id === null) {
    try {
      const index = (await getAllNames()).indexOf(query);
      if (index >= 0) id = index + 1;
    } catch { /* offline: fall through to the network path below */ }
  }

  if (id !== null && id >= 1 && id <= MAX_DEX_ID) {
    const stored = await dexGet(id);
    if (stored) return stored;
  }

  const simplified = simplifyPokemon(await getPokemon(id !== null && id <= MAX_DEX_ID ? id : query));
  if (simplified.id >= 1 && simplified.id <= MAX_DEX_ID) dexPut([simplified]); // base species only, never alternate forms
  return simplified;
}

/**
 * Species data holds flavor text and the evolution chain URL —
 * neither of which live on the base /pokemon endpoint.
 */
export async function getSpecies(idOrName) {
  const query = String(idOrName).toLowerCase().trim();
  try {
    return await memoJson(`${POKEAPI_BASE}/pokemon-species/${encodeURIComponent(query)}`);
  } catch (err) {
    if (err.status === 404 || err.status === 400) throw new Error(`Species "${idOrName}" not found`);
    throw err;
  }
}

/**
 * Walks a PokéAPI evolution chain and flattens it into a simple
 * ordered array of names: ["charmander", "charmeleon", "charizard"].
 * The chain is a nested linked structure (a Pokémon can branch into
 * multiple evolutions, e.g. Eevee), so this only follows the first
 * branch at each step — enough for a simple "evolution line" display.
 */
export function flattenEvolutionChain(chain) {
  const names = [];
  let node = chain;
  while (node) {
    names.push(node.species.name);
    node = node.evolves_to?.[0] || null;
  }
  return names;
}

/**
 * Convenience: name/id -> flat evolution line, in one call.
 */
export async function getEvolutionLine(idOrName) {
  const species = await getSpecies(idOrName);
  let chainData;
  try { chainData = await memoJson(species.evolution_chain.url); }
  catch { throw new Error("Could not load evolution data"); }
  return flattenEvolutionChain(chainData.chain);
}

/* ==========================================================
   Pokémon TCG API — card search + pricing
   Separate base URL/service from PokéAPI, but kept in this
   same file so every page still only imports from "./api.js".
   ========================================================== */

const TCG_BASE = "https://api.pokemontcg.io/v2";

export async function searchCards(query) {
  const response = await fetch(
    `${TCG_BASE}/cards?q=name:${encodeURIComponent(query)}*&pageSize=16&orderBy=-set.releaseDate`
  );
  if (!response.ok) throw new Error(`No cards found for "${query}"`);
  const data = await response.json();
  return data.data.map(simplifyCard);
}

export function simplifyCard(raw) {
  const variant = raw.tcgplayer?.prices
    ? Object.values(raw.tcgplayer.prices)[0]
    : null;

  return {
    id: raw.id,
    name: raw.name,
    set: raw.set?.name || "Unknown set",
    rarity: raw.rarity || "Unknown",
    image: raw.images?.large || raw.images?.small || "",
    prices: variant
      ? { low: variant.low, mid: variant.mid, high: variant.high, market: variant.market }
      : null
  };
}
