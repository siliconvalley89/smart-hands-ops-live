import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";
import { getMessaging } from "firebase/messaging";

// --- YOUR KEYS (Keep them exactly as they were) ---
const firebaseConfig = {
  // PASTE YOUR REAL KEYS HERE AGAIN IF THEY ARE MISSING
  // (Use the ones from your last successful step)
  apiKey: "AIzaSyA_7MVsNQ4jJU1eO-Yfv9M_WQILopF2evk",
  authDomain: "smart-hands-live.firebaseapp.com",
  projectId: "smart-hands-live",
  storageBucket: "smart-hands-live.firebasestorage.app",
  messagingSenderId: "859653333476",
  appId: "1:859653333476:web:36aafadee67815bae2e7f1"

};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const storage = getStorage(app);
export const auth = getAuth(app);

// Firebase Cloud Messaging — used for push notifications to technicians.
// REQUIRED: paste your Web Push VAPID key below.
// Get it from: Firebase Console → Project Settings → Cloud Messaging → Web Push certificates → Generate key pair
export const VAPID_KEY = 'BOT0__LZ2hzUG4Gam6uZ-Fa7fSn8awLDSX-w0njEG7tHsUi0e_2FBmD9Kvif1zjz7WM5l_OVciCv7Rp4VFzU-Wg';
export const messaging = getMessaging(app);