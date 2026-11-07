# PokéExplorer: mini-game hub (working name)

Built on the original class project. Plain HTML, CSS and JS modules. Open with a local server
(VS Code Live Server), not by double-clicking: modules and Google login need http.

## Pages
- `game.html`   runs any game: `game.html?id=pokedle`
- `index.html`  hub homepage: nav, hero, search + category chips, game grid, footer
- `login.html`  Firebase sign up / log in / Google login / forgot password (returns to the page you came from, else the homepage)
- `search.html` Pokédex (nav label "Pokédex")
- `leaderboard.html` top scores per game + overall (reads Firestore `scores`), `profile.html` your bests, ranks, display name
- `about.html`, `conditions.html`  info pages
- `community.html` the Community (feed, rooms, trainer search, alerts), `trainer.html?uid=...` trainer profiles (see "Community" below)
- Parked, not in the nav: `games.html` (Lucky Spin), `collection.html`, `cards.html`

## css/
`style.css` tokens + reset, `components.css` shared parts, `hub.css` homepage grid, `login.css` login page,
`games.css`, `boards.css`, `community.css`, `avatar-action.css`, `animations.css`, `responsive.css`

## js/
- `economy/` `config.js` (mode switch + numbers), `cards.js` (card model), `catalog.js`, `wallet.js` (the entry point), `backend-prototype.js`, `backend-trusted.js`
- `core/`    `api.js`, `cache.js` (memory + IndexedDB + localStorage metadata), `dex.js` (Pokédex index: search, filters, sorting), `storage.js`, `store.js` (scores), `ui.js` (safe `el()`, nav, toasts), `firebase-config.js`, `auth.js`
- `pages/`   `home.js`, `login.js`, `profile-wallet.js` (wallet panel), `search.js`, `search-suggest.js` (autocomplete), `search-filters.js` (filter panel + grid), `game.js`, `leaderboard.js`, `profile.js`, `community.js`, `trainer.js`, `static.js`
- `games/`   `registry.js` (THE game list), `common.js` (shared helpers), `_template.js`, one file per game: `pokedle`, `higher-lower`, `pixel-guess`, `emoji-riddle`, `memory-cards`
- `community/` the Community: `data.js` (ALL Firestore access), `media.js` (images + video links), `view.js` (shared UI), `post-card.js`, `composer.js`, `chat.js`, `people.js`, `notifications.js`, `pickers.js`, `share.js`, `sync.js`, `achievements.js`, `rooms.js`, `state.js`, `fb.js`
- `legacy/`  parked pages: `parked.js` (shared start-up and trainer strip), `spin.js`, `collection.js`, `cards.js`

## Pokédex search and caching (Phase 1)
- **Layers:** memory (this tab) > IndexedDB `pokeexplorer-cache` (big data: one compact record per Pokémon, names, API lists) > `localStorage` (only `pe_cache_meta` version info and `pe_search_prefs` sort/panel prefs). The whole Pokédex is never put in localStorage.
- **Expiry / versions:** records expire after 30 days; bump `CACHE_VERSION` in `js/core/cache.js` when a stored shape changes and old data is wiped on the next visit. "Clear saved Pokédex data" in the filter panel does it by hand.
- **Loading order:** names + the 18 type lists (about 20 small requests) make autocomplete, type, generation and number/name sorting work at once. Height, weight and base stats arrive afterwards in the background (one GraphQL request, or a throttled one-per-Pokémon fallback). Data Saver / 2G pauses the background step; a "Download now" button starts it.
- Alternate forms (ids above 1025) are ignored. Base Speed is the species stat, not a calculated battle Speed.

## Economy: PokéPoints, cards, inventory (Phase 2)
**Two modes, one switch** (`ECONOMY_MODE` in `js/economy/config.js`). Pages only call `js/economy/wallet.js`.
- `prototype` (default): balance, card inventory and history live in this browser's localStorage (`js/core/storage.js`). The profile page says so. It is **not cheat-resistant**: anyone can edit their own storage, and nothing follows you to another device.
- `trusted`: balance, inventory and history live in Firestore and only the Cloud Functions in `backend/functions` can change them. Browsers may *read* their own wallet and *ask* for changes; they never send a balance or a price.

**Data (extends the existing schema, nothing replaced)**
- `cards/{cardId}` global metadata: name, setCode/setName, number, rarity tier, rawRarity, imageUrl, finishType, pointValue. Read-only for browsers; filled by `backend/tools/seed_cards.py` from the Pokémon TCG API. `packs/{packId}` is reserved (read-only) for Phase 3.
- `users/{uid}/wallet/main` {points, origin, legacyMigration?}, `users/{uid}/cardInventory/{cardId}` {count, acquiredAt, finishType}, `users/{uid}/pointTransactions/{requestId}` {type, amount, balanceAfter, meta, result}. Owner can read; nobody can write from a browser.
- `users/{uid}.points` stays as the public display number; in trusted mode only the backend writes it.

**Rules the backend follows** (`backend/functions/ledger.py`): the player is `req.auth.uid`; values come from the server catalog; each change is one transaction (wallet + inventory + record); the transaction record id is the client's `requestId`, so a retry returns the first result and changes nothing; reusing an id for a different request is refused; the balance can't go outside 0 to 10,000,000; the first copy of a card can't be exchanged.

**Legacy PokéPoints migration** (trusted mode): one-time `initWallet`. If this browser holds old points the player can move them; the server credits at most `LEGACY_MIGRATION_CAP` (5,000; `economy_rules.py`) because a number kept in a browser can't be verified, and stores the claim and the cap. Otherwise the wallet starts at 1,000. The old Lucky Spin Pokémon collection stays in localStorage (it is a different thing from TCG cards). Lucky Spin picks rewards in the browser, so it is switched off in trusted mode.

**Going trusted (needs you)**
1. Cloud Functions need the Firebase **Blaze** (pay-as-you-go) plan; the Spark plan can't deploy them. Python is supported for 2nd-gen functions.
2. `firebase init functions` (Python), copy `backend/functions/*.py` + `requirements.txt` in, `firebase deploy --only functions`. Keep the region in step with `FUNCTIONS_REGION` (config.js) and `set_global_options` (main.py).
3. Seed the catalog: `python backend/tools/seed_cards.py <setId>` with a service account (never commit the key).
4. Publish `firestore.rules`, then change `economyTrusted()` to `true` (stops browsers writing their own profile `points`).
5. Set `ECONOMY_MODE = "trusted"` and redeploy the site.
Tests: `python3 -I -m unittest discover -s backend/functions/tests` and `node backend/functions/tests/parity.test.mjs` (browser and server rarity rules agree).

## Known issues / to do
- Phase 2 backend (`main.py`, `store.FirestoreStore`) has not been deployed or run against live Firebase, and the Firebase Python SDK could not be installed in the test sandbox, so the SDK calls are unverified. The ledger logic is tested against an in-memory Firestore stand-in. Firestore rules were reviewed by reading only (no emulator).
- Phase 1: the bulk stats download uses PokéAPI's GraphQL beta endpoint (`beta.pokeapi.co/graphql/v1beta`). Its query was written from the published schema but has only been tested against a fake server, not the live service. If it is wrong or changes, the code falls back to the slower REST crawl by itself (about 1,025 requests once, then cached). Check the browser network tab on the first real load.
- Parked pages (`games.html` Lucky Spin, `collection.html`, `cards.html`) now use the Firebase login (`js/legacy/parked.js`). PokéPoints and the collection still live in `localStorage` and are only mirrored to `users/{uid}`; they are per browser, not per account. Moving them to Firestore is the Phase 2 migration.
- Publish `firestore.rules` and `storage.rules` in the Firebase console (Firestore must be enabled), or logged-in scores only stay local.
- Firebase console > Authentication > Settings > Authorized domains must list `localhost` and `127.0.0.1` (Live Server), or login shows "This web address isn't allowed to log in yet".
- Restrict the web API key to your site addresses in Google Cloud console > APIs & Services > Credentials. (A Firebase web key is not a secret, but it should not be usable from anywhere.)
- Dynamic content is built with `el()` / DOM APIs; the only `innerHTML` left is one fixed SVG icon in `search.js`.

## Branding (working name stays PokéExplorer)
`Poké`, `Pokémon` and `Pokédex` are trademarks of The Pokémon Company, Nintendo, Creatures and GAME FREAK. Fine for a class project, not for a public or commercial launch, so the final-name candidates avoid them (trademark and domain availability not checked yet):
- **Route One**: the first path every trainer walks. Logo: `assets/brand/logo.svg` (compass).
- **Dexplorer**: explore + Dex. Logo: `assets/brand/logo-concept-b.svg` (lens over a pixel sprite).
- **Tallgrass**: wild encounters. Logo: `assets/brand/logo-concept-c.svg` (grass under a sunrise).

`assets/brand/logo.svg` (under 1 KB) is the favicon on every page: copy a concept over it to swap. The visible name is plain text in each page's nav and footer, so a final rename is one search-and-replace.

## Design (v2: bright Pokémon look)
- Tokens live in `css/style.css`: sky blue page, white "sticker" panels with 3px navy outlines and a hard offset shadow, Poké Ball red for actions, Pikachu yellow for highlights, navy (`--ink`) instead of black.
- Fonts: Fredoka (headings, buttons), Nunito (body), Press Start 2P (tiny tags and the points counter only).
- `.sticker-title` = white headline with navy outline. `.pokeball` = pure-CSS Poké Ball. `.band` = white section with a wavy top edge.
- Older `--void`, `--panel`, `--mist`... token names still exist as aliases so the parked pages keep working.

## Community (feed, trainer pages, rooms)

### One-time Firebase setup (all three are needed)
1. **Firestore rules**: paste `firestore.rules` in Firebase console > Firestore > Rules > Publish. (It still contains the original `scores` rule.)
2. **Firestore index** (chat only): the chat query needs one composite index. Either deploy `firestore.indexes.json`, or open a chat room once and click the link the page shows, then press Create. Takes about a minute.
3. **Storage** (photo uploads): Firebase console > Storage > Get started, paste `storage.rules`. Since Feb 2026 Cloud Storage for Firebase needs the **Blaze** (pay-as-you-go) plan; a small project stays inside the free allowance. If Storage is not available, uploads fall back to a smaller copy saved inside the post / profile document, so nothing breaks.

### Firestore data (adapted to the existing project, nothing duplicated)
- `scores/{uid_gameId}` existing; reused for game stats, ranks and badges.
- `users/{uid}` profile: username, photoURL, bio, favoritePokemon, team, points, collection summary (showcase, rareCards, rarityCounts).
- `users/{uid}/following/{target}` + `users/{uid}/followers/{follower}` follower counts come from counting these, no counter field to drift.
- `users/{uid}/notifications/{id}` likes, comments, replies, follows (only the owner can read).
- `posts/{id}` (+ `comments/{id}`, `likes/{uid}`) feed; `likeCount` / `commentCount` are stored for sorting.
- `messages/{id}` chat, tagged with `roomId` (rooms are listed in `js/community/rooms.js` and in `validRoom()` in the rules).

### How it connects to the rest of the site
- **PokéPoints and collection** still live in `localStorage` (`js/core/storage.js`). Opening the Community or your trainer page copies points, collection counts, showcase and rarest finds into `users/{uid}`. A browser with fewer Pokémon than your profile shows will not overwrite it.
- **Achievements** did not exist, so `js/community/achievements.js` derives 15 badges from scores, the collection and community activity. Edit the list there to add or change badges.
- **Leaderboard** names now link to trainer pages. **Lucky Spin** and **Collection** have a "Share to Community" button (parked pages, so they show up once those pages are in the nav).
- Showcase = Pokémon you favourited in the Collection, then the rarest.

### Known limits
- `commentCount` is client-maintained (rules cap it to small steps). A Cloud Function would make it tamper-proof.
- Trainer Stats / Badges read the whole `scores` collection once (same approach as the leaderboard and profile pages). Fine for a class project, aggregate it if the player count grows.
- Usernames are not unique (the leaderboard never required it). Rooms and chat have no moderation beyond deleting your own messages.
- Video posts are YouTube / Vimeo links (embedded), not uploads. Direct messages are not built (optional in the brief).
