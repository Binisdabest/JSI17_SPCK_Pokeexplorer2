// Tiny shared state for the Community pages: who is logged in, their profile doc, who they follow, their notifications.
export const S = { user: null, doc: null, following: new Set(), notifs: [] };

const listeners = new Set();
export const onState = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export const emit = () => listeners.forEach((fn) => { try { fn(S); } catch (e) { console.error(e); } });
