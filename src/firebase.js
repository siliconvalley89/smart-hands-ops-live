import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";

// --- PASTE YOUR KEYS INSIDE THESE BRACKETS ---
const firebaseConfig = {
    apiKey: "AIzaSyA_7MVsNQ4jJU1eO-Yfv9M_WQILopF2evk",
    authDomain: "smart-hands-live.firebaseapp.com",
    projectId: "smart-hands-live",
    storageBucket: "smart-hands-live.firebasestorage.app",
    messagingSenderId: "859653333476",
    appId: "1:859653333476:web:36aafadce67815bac2c7f1"
};
// ----------------------------------------------

// Initialize Firebase
const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);