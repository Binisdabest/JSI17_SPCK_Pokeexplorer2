// Thin wrapper around Firebase Auth. Pages and games import from here, never from Firebase directly.
import { auth } from "./firebase-config.js";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword, signInWithPopup,
  GoogleAuthProvider, signOut, onAuthStateChanged, updateProfile, sendPasswordResetEmail
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";

export const signUp = (email, password) => createUserWithEmailAndPassword(auth, email, password);
export const logIn = (email, password) => signInWithEmailAndPassword(auth, email, password);
export const googleLogIn = () => signInWithPopup(auth, new GoogleAuthProvider());
export const logOut = () => signOut(auth);
export const onUser = (callback) => onAuthStateChanged(auth, callback);
export const displayName = (user) => user.displayName || user.email.split("@")[0];
export const setDisplayName = (user, name) => updateProfile(user, { displayName: name });

/** Firebase emails a reset link. Firebase answers the same way whether or not the address has an account. */
export const sendResetEmail = (email) => sendPasswordResetEmail(auth, email);

/* ---------- "log in, then come back to where you were" ---------- */

// Only plain pages of this site are accepted: "name.html", optionally with ?query and #hash. No slashes or schemes,
// so a crafted ?next= link can never send someone to another website.
const SAFE_NEXT = /^[a-z0-9_-]+\.html(\?[\w=&%.\-]*)?(#[\w-]*)?$/i;

/** Link to the login page that returns to the current page afterwards (or to `returnTo`, e.g. "games.html"). */
export function loginUrl(returnTo) {
  let target = returnTo;
  if (!target) {
    const page = location.pathname.split("/").pop() || "index.html";
    target = page + location.search + location.hash;
  }
  if (!SAFE_NEXT.test(target) || /^login\.html/i.test(target)) return "login.html";
  return "login.html?next=" + encodeURIComponent(target);
}

/** Where the login page should go after a successful login: the ?next= page if it is safe, otherwise the hub. */
export function afterLoginUrl() {
  const next = new URLSearchParams(location.search).get("next");
  return next && SAFE_NEXT.test(next) && !/^login\.html/i.test(next) ? next : "index.html";
}
