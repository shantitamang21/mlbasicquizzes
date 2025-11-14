// src/firebase.ts
import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAnalytics } from "firebase/analytics";
import { getStorage } from "firebase/storage";
import { getAuth, signInAnonymously } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyA-CkLqnKiLs5xuWFmlA542Z0q9xO3UcSk",
  authDomain: "teachtoolbox-ada60.firebaseapp.com",
  projectId: "teachtoolbox-ada60",
  storageBucket: "teachtoolbox-ada60.appspot.com", 
  messagingSenderId: "473840196631",
  appId: "1:473840196631:web:953d4093ff7d9e05cbd052",
  measurementId: "G-N0RQJ8FFCD",
};

export const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const storage = getStorage(app);

// --- Auth (anonymous) ---
export const auth = getAuth(app);
export async function ensureAnon(): Promise<string> {
  if (!auth.currentUser) await signInAnonymously(auth);
  return auth.currentUser!.uid;
}

export const analytics = (() => {
  try {
    if (typeof window !== "undefined" && typeof document !== "undefined") {
      return getAnalytics(app);
    }
  } catch (e) {
    console.warn("Firebase analytics not initialized:", e);
  }
  return null as ReturnType<typeof getAnalytics> | null;
})();
