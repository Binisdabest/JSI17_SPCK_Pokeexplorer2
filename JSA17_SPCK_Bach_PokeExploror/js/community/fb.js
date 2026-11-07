// One place that re-exports every Firebase function the Community uses, so SDK URLs and versions live here only.
export { app, auth, db, storage } from "../core/firebase-config.js";
export {
  doc, collection, query, where, orderBy, limit, getDoc, getDocs, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, writeBatch, serverTimestamp, increment, getCountFromServer
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
export {
  ref as storageRef, uploadBytes, getDownloadURL, deleteObject
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
