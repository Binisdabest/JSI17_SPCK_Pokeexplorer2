// Images (compress, upload to Firebase Storage, fall back to an inline copy) and video links (YouTube / Vimeo embeds).
import { storage, storageRef, uploadBytes, getDownloadURL, deleteObject } from "./fb.js";

export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const MAX_PICK_BYTES = 12 * 1024 * 1024;

export function validateImage(file) {
  if (!file) return "Pick an image first.";
  if (!IMAGE_TYPES.includes(file.type)) return "Use a JPG, PNG, WebP or GIF image.";
  if (file.size > MAX_PICK_BYTES) return "That image is over 12 MB. Pick a smaller one.";
  return null;
}

async function toBitmap(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file); } catch { /* fall through to <img> */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((ok, fail) => {
      const img = new Image();
      img.onload = () => ok(img);
      img.onerror = () => fail(new Error("Could not read that image."));
      img.src = url;
    });
  } finally { URL.revokeObjectURL(url); }
}

/** Resizes to JPEG until it fits under maxBytes. `square` centre-crops (avatars). */
export async function compressImage(file, { maxDim = 1600, maxBytes = 1500000, square = false } = {}) {
  const bmp = await toBitmap(file);
  const sw = bmp.width, sh = bmp.height;
  const side = Math.min(sw, sh);
  const sx = square ? (sw - side) / 2 : 0, sy = square ? (sh - side) / 2 : 0;
  const cw = square ? side : sw, ch = square ? side : sh;
  let scale = Math.min(1, maxDim / Math.max(cw, ch)), quality = 0.86;
  for (let i = 0; i < 7; i++) {
    const w = Math.max(1, Math.round(cw * scale)), h = Math.max(1, Math.round(ch * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
    ctx.drawImage(bmp, sx, sy, cw, ch, 0, 0, w, h);
    const blob = await new Promise((ok) => canvas.toBlob(ok, "image/jpeg", quality));
    if (blob && blob.size <= maxBytes) return blob;
    quality = Math.max(0.5, quality - 0.08);
    scale *= 0.85;
  }
  throw new Error("That image is too large to share. Try a smaller one.");
}

const toDataUrl = (blob) => new Promise((ok, fail) => {
  const r = new FileReader();
  r.onload = () => ok(r.result);
  r.onerror = () => fail(new Error("Could not read that image."));
  r.readAsDataURL(blob);
});

const withTimeout = (promise, ms) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error("timeout")), ms))]);

const PROFILES = {
  post: { folder: "posts", main: { maxDim: 1600, maxBytes: 1500000 }, inline: { maxDim: 900, maxBytes: 420000 } },
  avatar: { folder: "avatars", main: { maxDim: 320, maxBytes: 300000, square: true }, inline: { maxDim: 192, maxBytes: 55000, square: true } }
};

/**
 * Uploads to Firebase Storage. If Storage is not available (not enabled, Spark plan, offline, rules),
 * stores a smaller copy inline instead so the feature still works. Returns { url, path, inline }.
 */
export async function storeImage(file, { kind, uid }) {
  const cfg = PROFILES[kind];
  const blob = await compressImage(file, cfg.main);
  const path = `${cfg.folder}/${uid}/${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`;
  try {
    const r = storageRef(storage, path);
    await withTimeout(uploadBytes(r, blob, { contentType: "image/jpeg" }), 15000);
    const url = await withTimeout(getDownloadURL(r), 8000);
    return { url, path, inline: false };
  } catch (e) {
    console.warn("Firebase Storage unavailable, saving a smaller inline copy:", e.code || e.message);
    const small = await compressImage(file, cfg.inline);
    return { url: await toDataUrl(small), path: null, inline: true };
  }
}

export async function removeStored(path) {
  if (!path) return;
  try { await deleteObject(storageRef(storage, path)); } catch (e) { console.warn("Could not delete stored file:", e.code || e.message); }
}

/* ---------- video links ---------- */

export function parseVideoUrl(raw) {
  let u;
  try { u = new URL(String(raw).trim()); } catch { return null; }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  const host = u.hostname.replace(/^(www|m)\./, "");
  let id = null;
  if (host === "youtu.be") id = u.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "music.youtube.com") {
    if (u.pathname === "/watch") id = u.searchParams.get("v");
    else { const m = u.pathname.match(/^\/(shorts|embed|live)\/([\w-]{11})/); if (m) id = m[2]; }
  }
  if (id && /^[\w-]{11}$/.test(id)) return { provider: "youtube", id };
  if (host === "vimeo.com") {
    const m = u.pathname.match(/^\/(\d{6,12})(\/|$)/);
    if (m) return { provider: "vimeo", id: m[1] };
  }
  return null;
}

export const validVideo = (v) => !!v && ((v.provider === "youtube" && /^[\w-]{11}$/.test(v.id)) || (v.provider === "vimeo" && /^\d{6,12}$/.test(v.id)));
export const embedSrc = (v) => v.provider === "youtube" ? `https://www.youtube-nocookie.com/embed/${v.id}` : `https://player.vimeo.com/video/${v.id}`;
export const videoLabel = (v) => v.provider === "youtube" ? "YouTube video" : "Vimeo video";
