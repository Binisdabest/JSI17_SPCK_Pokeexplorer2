// Firebase connection (modular SDK). Every page that needs login imports `auth` from here.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-auth.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyBaMqyjWHfrPiq4d6V_6f0x2fJfx33JW-o",
  authDomain: "pokeexplorer-627e5.firebaseapp.com",
  projectId: "pokeexplorer-627e5",
  storageBucket: "pokeexplorer-627e5.firebasestorage.app",
  messagingSenderId: "342216827292",
  appId: "1:342216827292:web:c6c80561ad6b19561c6859",
  measurementId: "G-GHC8JV709G"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);



export const db = getFirestore(app);

// Community image uploads (needs Storage enabled in the Firebase console; see README).
export const storage = getStorage(app);
