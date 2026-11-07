// All Firestore access for the Community. Pages and UI modules call these functions and never touch Firestore directly.
//
// Collections (adapted to the existing project: `scores` is reused for game stats, nothing is duplicated):
//   users/{uid}                          trainer profile (public)
//   users/{uid}/following/{targetUid}    who this trainer follows
//   users/{uid}/followers/{followerUid}  mirror of the above, so follower counts need no counter field
//   users/{uid}/notifications/{id}       likes, comments, replies, follows (only the owner can read)
//   posts/{postId}                       feed posts (+ likeCount / commentCount for sorting)
//   posts/{postId}/comments/{commentId}  comments and one level of replies (parentId)
//   posts/{postId}/likes/{uid}           one document per like
//   messages/{messageId}                 chat messages, tagged with roomId
import {
  db, doc, collection, query, where, orderBy, limit, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, writeBatch, serverTimestamp, increment, getCountFromServer
} from "./fb.js";
import { displayName } from "../core/auth.js";
import { removeStored } from "./media.js";

export const LIMITS = { post: 500, comment: 300, message: 400, bio: 160, name: 20 };

const SNAP = { serverTimestamps: "estimate" }; // pending writes get an estimated time, so ordering works instantly
const toMs = (v) => (v && typeof v.toMillis === "function" ? v.toMillis() : typeof v === "number" ? v : Date.now());
const shape = (d) => { const x = d.data(SNAP); return { id: d.id, ...x, createdMs: toMs(x.createdAt) }; };

/* ---------------------------------------------------------- */
/* Trainer profiles                                             */
/* ---------------------------------------------------------- */
const userCache = new Map();
const pending = new Map();

/** undefined = not loaded yet, null = no such trainer, object = profile. */
export const cachedUser = (uid) => userCache.get(uid);
export const primeUser = (uid, data) => userCache.set(uid, data ? { uid, ...data } : null);

export function loadUser(uid, force = false) {
  if (!uid) return Promise.resolve(null);
  if (!force && userCache.has(uid)) return Promise.resolve(userCache.get(uid));
  if (pending.has(uid)) return pending.get(uid);
  const p = getDoc(doc(db, "users", uid))
    .then((s) => { const v = s.exists() ? { uid, ...s.data(SNAP) } : null; userCache.set(uid, v); return v; })
    .catch((e) => { console.warn("Could not load trainer:", e.code || e.message); return null; })
    .finally(() => pending.delete(uid));
  pending.set(uid, p);
  return p;
}

export const userMs = (u) => toMs(u?.createdAt);

/** Makes sure users/{uid} exists and its username matches the Firebase Auth display name (the source of truth). */
export async function ensureUser(user) {
  const ref = doc(db, "users", user.uid);
  const snap = await getDoc(ref);
  const name = displayName(user).slice(0, 24).padEnd(2, "_");
  if (!snap.exists()) {
    const photo = typeof user.photoURL === "string" && user.photoURL.startsWith("https://") ? user.photoURL : null;
    const data = {
      uid: user.uid, username: name, usernameLower: name.toLowerCase(), photoURL: photo, photoPath: null,
      bio: "", favoritePokemon: null, team: [], points: 0, createdAt: serverTimestamp(), updatedAt: serverTimestamp()
    };
    await setDoc(ref, data);
    const { updatedAt, ...plain } = data;
    primeUser(user.uid, { ...plain, createdAt: Date.now() });
    return userCache.get(user.uid);
  }
  let data = { uid: user.uid, ...snap.data(SNAP) };
  if (data.username !== name) {
    await updateDoc(ref, { username: name, usernameLower: name.toLowerCase(), updatedAt: serverTimestamp() });
    data = { ...data, username: name, usernameLower: name.toLowerCase() };
  }
  userCache.set(user.uid, data);
  return data;
}

/** Writes changes to your own profile document and keeps the local cache in step. */
export async function saveProfile(uid, patch) {
  const p = { ...patch, updatedAt: serverTimestamp() };
  if (p.username) p.usernameLower = p.username.toLowerCase();
  await updateDoc(doc(db, "users", uid), p);
  const { updatedAt, ...plain } = p;
  userCache.set(uid, { ...(userCache.get(uid) || { uid }), ...plain });
  return userCache.get(uid);
}

export async function searchUsers(term) {
  const t = term.trim().toLowerCase();
  if (!t) return [];
  const snap = await getDocs(query(collection(db, "users"),
    where("usernameLower", ">=", t), where("usernameLower", "<=", t + "\uf8ff"), orderBy("usernameLower"), limit(20)));
  return snap.docs.map((d) => { const u = { uid: d.id, ...d.data(SNAP) }; userCache.set(u.uid, u); return u; });
}

export async function topTrainers(n = 12) {
  const snap = await getDocs(query(collection(db, "users"), orderBy("points", "desc"), limit(n)));
  return snap.docs.map((d) => { const u = { uid: d.id, ...d.data(SNAP) }; userCache.set(u.uid, u); return u; });
}

export async function loadUsers(uids) {
  return (await Promise.all(uids.map((u) => loadUser(u)))).filter(Boolean);
}

/* ---------------------------------------------------------- */
/* Follows                                                      */
/* ---------------------------------------------------------- */
export function subscribeFollowing(uid, onData, onError) {
  return onSnapshot(collection(db, "users", uid, "following"), (s) => onData(new Set(s.docs.map((d) => d.id))), onError);
}

export async function setFollow(user, targetUid, follow) {
  const mine = doc(db, "users", user.uid, "following", targetUid);
  const theirs = doc(db, "users", targetUid, "followers", user.uid);
  const batch = writeBatch(db);
  if (follow) {
    batch.set(mine, { uid: targetUid, createdAt: serverTimestamp() });
    batch.set(theirs, { uid: user.uid, createdAt: serverTimestamp() });
  } else {
    batch.delete(mine);
    batch.delete(theirs);
  }
  await batch.commit();
  const nid = `follow_${user.uid}`;
  if (follow) notify(targetUid, nid, { type: "follow" }, user);
  else unnotify(targetUid, nid);
}

export async function listFollow(uid, kind) {
  const snap = await getDocs(query(collection(db, "users", uid, kind), limit(100)));
  return loadUsers(snap.docs.map((d) => d.id));
}

export async function counts(uid) {
  const n = (q) => getCountFromServer(q).then((s) => s.data().count).catch(() => 0);
  const [posts, followers, following] = await Promise.all([
    n(query(collection(db, "posts"), where("authorUid", "==", uid))),
    n(collection(db, "users", uid, "followers")),
    n(collection(db, "users", uid, "following"))
  ]);
  return { posts, followers, following };
}

/* ---------------------------------------------------------- */
/* Notifications                                                */
/* ---------------------------------------------------------- */
// Best effort on purpose: a failed notification must never make a like, comment or follow fail.
function notify(toUid, id, fields, fromUser) {
  if (!toUid || toUid === fromUser.uid) return;
  const data = { type: fields.type, fromUid: fromUser.uid, fromName: displayName(fromUser).slice(0, 40), read: false, createdAt: serverTimestamp() };
  if (fields.postId) data.postId = fields.postId;
  if (fields.snippet) data.snippet = String(fields.snippet).slice(0, 80);
  const ref = id ? doc(db, "users", toUid, "notifications", id) : doc(collection(db, "users", toUid, "notifications"));
  setDoc(ref, data).catch((e) => console.warn("Notification not sent:", e.code || e.message));
}
const unnotify = (toUid, id) => deleteDoc(doc(db, "users", toUid, "notifications", id)).catch(() => {});

export function subscribeNotifications(uid, onData, onError) {
  const q = query(collection(db, "users", uid, "notifications"), orderBy("createdAt", "desc"), limit(50));
  return onSnapshot(q, (s) => onData(s.docs.map(shape)), onError);
}
export const markRead = (uid, id) => updateDoc(doc(db, "users", uid, "notifications", id), { read: true });
export async function markAllRead(uid, list) {
  const batch = writeBatch(db);
  list.filter((n) => !n.read).forEach((n) => batch.update(doc(db, "users", uid, "notifications", n.id), { read: true }));
  await batch.commit();
}

/* ---------------------------------------------------------- */
/* Posts                                                        */
/* ---------------------------------------------------------- */
/** Engagement score that fades with age. Powers "Popular" and the Trending box. */
export const hotScore = (p, now = Date.now()) => ((p.likeCount || 0) + 2 * (p.commentCount || 0) + 1) / Math.pow((now - p.createdMs) / 3.6e6 + 2, 1.35);

export function sortPosts(list, mode) {
  const a = [...list];
  if (mode === "liked") a.sort((x, y) => (y.likeCount || 0) - (x.likeCount || 0) || y.createdMs - x.createdMs);
  else if (mode === "popular") { const now = Date.now(); a.sort((x, y) => hotScore(y, now) - hotScore(x, now)); }
  else a.sort((x, y) => y.createdMs - x.createdMs);
  return a;
}

/**
 * Live feed. sort "liked" asks Firestore for the most liked; anything else loads the newest `n` (sorted in the browser).
 * `authors` (array of uids) switches to the Following feed: Firestore allows 30 values per `in` query, so it is chunked.
 */
export function subscribePosts({ sort = "newest", n = 30, authors = null }, onData, onError) {
  const posts = collection(db, "posts");
  if (authors) {
    const chunks = [];
    for (let i = 0; i < authors.length; i += 30) chunks.push(authors.slice(i, i + 30));
    if (!chunks.length) { onData([]); return () => {}; }
    const parts = chunks.map(() => []);
    const unsubs = chunks.map((c, i) => onSnapshot(query(posts, where("authorUid", "in", c), limit(60)),
      (s) => { parts[i] = s.docs.map(shape); onData(parts.flat()); }, onError));
    return () => unsubs.forEach((u) => u());
  }
  const q = sort === "liked" ? query(posts, orderBy("likeCount", "desc"), limit(n)) : query(posts, orderBy("createdAt", "desc"), limit(n));
  return onSnapshot(q, (s) => onData(s.docs.map(shape)), onError);
}

export function subscribeUserPosts(uid, onData, onError) {
  // Equality only (no orderBy) so Firestore needs no extra index; sorted in the browser.
  return onSnapshot(query(collection(db, "posts"), where("authorUid", "==", uid), limit(200)),
    (s) => onData(s.docs.map(shape).sort((a, b) => b.createdMs - a.createdMs)), onError);
}

export function subscribePost(id, onData, onError) {
  return onSnapshot(doc(db, "posts", id), (s) => onData(s.exists() ? shape(s) : null), onError);
}

export async function createPost(user, { text = "", image = null, video = null, attachment = null }) {
  const type = image ? "image" : video ? "video"
    : attachment ? (attachment.kind === "pokemon" ? (attachment.from === "spin" ? "pack" : "card") : attachment.kind) : "text";
  const data = {
    authorUid: user.uid, authorName: displayName(user).slice(0, 40), text: text.trim().slice(0, LIMITS.post), type,
    likeCount: 0, commentCount: 0, createdAt: serverTimestamp()
  };
  if (image) { data.imageURL = image.url; if (image.path) data.imagePath = image.path; }
  if (video) data.video = { provider: video.provider, id: video.id };
  if (attachment) data.attachment = attachment;
  const ref = await addDoc(collection(db, "posts"), data);
  return ref.id;
}

async function deleteAll(refs) {
  for (let i = 0; i < refs.length; i += 400) {
    const batch = writeBatch(db);
    refs.slice(i, i + 400).forEach((r) => batch.delete(r));
    await batch.commit();
  }
}

/** Deletes a post, its comments and likes, and its uploaded image. Children go first, while the post still exists for the rules. */
export async function deletePost(post) {
  const [comments, likes] = await Promise.all([
    getDocs(collection(db, "posts", post.id, "comments")),
    getDocs(collection(db, "posts", post.id, "likes"))
  ]);
  await deleteAll([...comments.docs, ...likes.docs].map((d) => d.ref));
  await deleteDoc(doc(db, "posts", post.id));
  await removeStored(post.imagePath);
}

export const hasLiked = (uid, postId) => getDoc(doc(db, "posts", postId, "likes", uid)).then((s) => s.exists()).catch(() => false);

/** like = true adds your like, false removes it. The like document and the counter change in one atomic batch. */
export async function setLike(user, post, like) {
  const postRef = doc(db, "posts", post.id);
  const likeRef = doc(db, "posts", post.id, "likes", user.uid);
  const batch = writeBatch(db);
  if (like) {
    batch.set(likeRef, { uid: user.uid, createdAt: serverTimestamp() });
    batch.update(postRef, { likeCount: increment(1) });
  } else {
    batch.delete(likeRef);
    batch.update(postRef, { likeCount: increment(-1) });
  }
  await batch.commit();
  const nid = `like_${post.id}_${user.uid}`;
  if (like) notify(post.authorUid, nid, { type: "like", postId: post.id, snippet: post.text }, user);
  else if (post.authorUid !== user.uid) unnotify(post.authorUid, nid);
}

/* ---------------------------------------------------------- */
/* Comments                                                     */
/* ---------------------------------------------------------- */
export function subscribeComments(postId, onData, onError) {
  const q = query(collection(db, "posts", postId, "comments"), orderBy("createdAt", "asc"), limit(200));
  return onSnapshot(q, (s) => onData(s.docs.map(shape)), onError);
}

/** reply = { topId, toUid } when answering a comment. Replies hang off the top-level comment (one level deep). */
export async function addComment(user, post, text, reply = null) {
  const clean = text.trim().slice(0, LIMITS.comment);
  const ref = doc(collection(db, "posts", post.id, "comments"));
  const batch = writeBatch(db);
  batch.set(ref, { authorUid: user.uid, authorName: displayName(user).slice(0, 40), text: clean, parentId: reply ? reply.topId : null, createdAt: serverTimestamp() });
  batch.update(doc(db, "posts", post.id), { commentCount: increment(1) });
  await batch.commit();

  const targets = new Map();
  if (post.authorUid !== user.uid) targets.set(post.authorUid, reply && reply.toUid === post.authorUid ? "reply" : "comment");
  if (reply && reply.toUid !== user.uid && !targets.has(reply.toUid)) targets.set(reply.toUid, "reply");
  targets.forEach((type, uid) => notify(uid, null, { type, postId: post.id, snippet: clean }, user));
}

export async function deleteComments(postId, ids) {
  const batch = writeBatch(db);
  ids.forEach((id) => batch.delete(doc(db, "posts", postId, "comments", id)));
  batch.update(doc(db, "posts", postId), { commentCount: increment(-ids.length) });
  await batch.commit();
}

/* ---------------------------------------------------------- */
/* Chat                                                         */
/* ---------------------------------------------------------- */
/** Needs the composite index in firestore.indexes.json (roomId + createdAt). The error message links to create it. */
export function subscribeMessages(roomId, onData, onError) {
  const q = query(collection(db, "messages"), where("roomId", "==", roomId), orderBy("createdAt", "desc"), limit(80));
  return onSnapshot(q, (s) => onData(s.docs.map(shape).reverse()), onError);
}

export const sendMessage = (user, roomId, text) => addDoc(collection(db, "messages"), {
  roomId, authorUid: user.uid, authorName: displayName(user).slice(0, 40), text: text.trim().slice(0, LIMITS.message), createdAt: serverTimestamp()
});

export const deleteMessage = (id) => deleteDoc(doc(db, "messages", id));
