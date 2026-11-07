// Login / sign-up page logic (ported from app.js to the modular SDK).
import { signUp, logIn, googleLogIn, logOut, onUser, sendResetEmail, afterLoginUrl } from "../core/auth.js";

const $ = (id) => document.getElementById(id);
const form = $("loginForm");
const emailInput = $("email");
const passwordInput = $("password");
const toggleBtn = $("togglePassword");
const messageBox = $("message");
const userInfo = $("userInfo");
const signupBtn = $("signupBtn"), loginBtn = $("loginBtn"), googleBtn = $("googleBtn"), forgotBtn = $("forgotBtn"), logoutBtn = $("logoutBtn");
const actionButtons = [signupBtn, loginBtn, googleBtn, forgotBtn, logoutBtn];

/* ---------- messages ---------- */

// Friendly text for the Firebase error codes a visitor can actually hit. Anything unknown falls back to a generic line
// (and the real code goes to the console), so raw SDK text like "Firebase: Error (auth/...)" is never shown.
const ERRORS = {
  "auth/email-already-in-use": "That email already has an account. Try Log In, or use Forgot password.",
  "auth/invalid-email": "That email doesn't look right. Check it for typos.",
  "auth/missing-email": "Enter your email first.",
  "auth/missing-password": "Enter your password.",
  "auth/weak-password": "That password is too weak. Use at least 6 characters.",
  // Firebase merges "no such account" and "wrong password" into this one code on purpose, so we say both.
  "auth/invalid-credential": "Wrong email or password. If you signed up with Google, use the Google button instead.",
  "auth/user-not-found": "Wrong email or password.",
  "auth/wrong-password": "Wrong email or password.",
  "auth/user-disabled": "This account has been disabled.",
  "auth/too-many-requests": "Too many tries. Wait a few minutes and try again.",
  "auth/network-request-failed": "Can't reach the server. Check your internet connection and try again.",
  "auth/operation-not-allowed": "This login method is switched off in the Firebase console (Authentication > Sign-in method).",
  "auth/unauthorized-domain": "This web address isn't allowed to log in yet. In Firebase console > Authentication > Settings > Authorized domains, add localhost and 127.0.0.1.",
  "auth/popup-blocked": "Your browser blocked the Google window. Allow pop-ups for this site and try again.",
  "auth/account-exists-with-different-credential": "That email is already registered with a different login method. Try the other one.",
  "auth/internal-error": "Something went wrong on the server. Try again in a moment."
};
// Not real failures: the person just closed the Google window.
const CANCELLED = new Set(["auth/popup-closed-by-user", "auth/cancelled-popup-request", "auth/user-cancelled"]);

function showMessage(text, type) {
  messageBox.textContent = text;
  messageBox.className = "message " + type;
  messageBox.setAttribute("role", type === "error" ? "alert" : "status");
}

function showError(e) {
  if (CANCELLED.has(e?.code)) return showMessage("Google login was cancelled.", "info");
  if (!ERRORS[e?.code]) console.error("Unexpected auth error:", e);
  showMessage(ERRORS[e?.code] || "Something went wrong. Please try again.", "error");
}

/* ---------- validation ---------- */

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const validEmail = (v) => EMAIL_RE.test(v);

// Password rules apply to SIGN UP only, so older accounts can still log in. All missing rules are listed at once.
function passwordProblems(password) {
  const missing = [];
  if (password.length < 6) missing.push("at least 6 characters");
  if (!/[A-Z]/.test(password)) missing.push("an uppercase letter");
  if (!/[a-z]/.test(password)) missing.push("a lowercase letter");
  if (!/[0-9]/.test(password)) missing.push("a number");
  return missing;
}

/* ---------- show / hide password ---------- */

function setPasswordVisible(visible) {
  passwordInput.type = visible ? "text" : "password";
  toggleBtn.textContent = visible ? "Hide" : "Show";
  toggleBtn.setAttribute("aria-label", visible ? "Hide password" : "Show password");
  toggleBtn.setAttribute("aria-pressed", String(visible));
}
toggleBtn.addEventListener("click", () => setPasswordVisible(passwordInput.type === "password"));

/* ---------- running one action at a time ---------- */

let busy = false;

/**
 * Runs one auth action. While it runs every button is disabled (no double clicks, no two requests at once) and the
 * clicked one shows a spinner and `busyLabel`. On failure everything is restored; on success we leave the page.
 */
async function run(button, busyLabel, action, okText) {
  if (busy) return;
  busy = true;
  const label = button.textContent;
  actionButtons.forEach((b) => (b.disabled = true));
  button.setAttribute("aria-busy", "true");
  button.textContent = busyLabel;
  setPasswordVisible(false);
  showMessage(busyLabel, "info");
  try {
    const { user } = await action();
    showMessage(okText + " Welcome, " + (user.displayName || user.email) + ".", "success");
    setTimeout(() => (location.href = afterLoginUrl()), 1000); // buttons stay disabled until the page changes
  } catch (e) {
    showError(e);
    busy = false;
    button.removeAttribute("aria-busy");
    button.textContent = label;
    actionButtons.forEach((b) => (b.disabled = false));
    startResetCooldown(); // re-applies the reset button's cooldown if one is still running
  }
}

/* ---------- handlers ---------- */

signupBtn.addEventListener("click", () => {
  if (busy) return;
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!validEmail(email)) { emailInput.focus(); return showMessage("Enter a valid email, like trainer@example.com.", "error"); }
  const missing = passwordProblems(password);
  if (missing.length) { passwordInput.focus(); return showMessage("Your password needs " + missing.join(", ") + ".", "error"); }
  run(signupBtn, "Signing up...", () => signUp(email, password), "Account created!");
});

// Enter in either field submits the form, which is "Log In".
form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (busy) return;
  const email = emailInput.value.trim(), password = passwordInput.value;
  if (!email) { emailInput.focus(); return showMessage("Enter your email.", "error"); }
  if (!validEmail(email)) { emailInput.focus(); return showMessage("That email doesn't look right. Check it for typos.", "error"); }
  if (!password) { passwordInput.focus(); return showMessage("Enter your password.", "error"); }
  run(loginBtn, "Logging in...", () => logIn(email, password), "Logged in!");
});

// Google login needs the provider enabled in Firebase and a real http(s) origin, not file://.
googleBtn.addEventListener("click", () => run(googleBtn, "Opening Google...", googleLogIn, "Google login worked!"));

logoutBtn.addEventListener("click", async () => {
  if (busy) return;
  busy = true;
  logoutBtn.setAttribute("aria-busy", "true");
  try { await logOut(); showMessage("Logged out.", "success"); }
  catch (e) { showError(e); }
  finally { busy = false; logoutBtn.removeAttribute("aria-busy"); }
});

/* ---------- forgot password ---------- */

const RESET_COOLDOWN_S = 30;
let resetUntil = 0; // timestamp until which the reset button stays locked (stops mail spamming)
let resetTimer = 0;

function startResetCooldown() {
  clearInterval(resetTimer);
  const tick = () => {
    const left = Math.ceil((resetUntil - Date.now()) / 1000);
    if (left <= 0) {
      clearInterval(resetTimer);
      forgotBtn.textContent = "Forgot password?";
      if (!busy) forgotBtn.disabled = false;
      return;
    }
    forgotBtn.disabled = true;
    forgotBtn.textContent = `Send again in ${left}s`;
  };
  if (resetUntil > Date.now()) { tick(); resetTimer = setInterval(tick, 1000); }
}

forgotBtn.addEventListener("click", async () => {
  if (busy || resetUntil > Date.now()) return;
  const email = emailInput.value.trim();
  if (!validEmail(email)) {
    emailInput.focus();
    return showMessage("Type your email in the box above first, then press Forgot password.", "error");
  }
  busy = true;
  actionButtons.forEach((b) => (b.disabled = true));
  forgotBtn.setAttribute("aria-busy", "true");
  showMessage("Sending...", "info");
  try {
    await sendResetEmail(email);
    // Same wording whether or not the address has an account, so nobody can use this box to find out who is registered.
    showMessage("If " + email + " has an account, a reset link is on its way. Check your inbox and spam folder.", "success");
    resetUntil = Date.now() + RESET_COOLDOWN_S * 1000;
  } catch (e) {
    showError(e);
  } finally {
    busy = false;
    forgotBtn.removeAttribute("aria-busy");
    actionButtons.forEach((b) => (b.disabled = false));
    startResetCooldown();
  }
});

// Keeps the trainer card in sync, including after a page refresh.
onUser((user) => {
  userInfo.style.display = user ? "block" : "none";
  if (!user) return;
  $("userEmail").textContent = user.email;
  $("userUID").textContent = user.uid;
  $("userProvider").textContent = user.providerData[0] ? user.providerData[0].providerId : "unknown";
});
