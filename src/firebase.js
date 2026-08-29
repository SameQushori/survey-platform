// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
import { getAnalytics } from "firebase/analytics";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from "firebase/storage";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
// For Firebase JS SDK v7.20.0 and later, measurementId is optional
const firebaseConfig = {
  apiKey: "AIzaSyA8wrGSCkuKf3IjUmQZOCG_3qFctdfMRbk",
  authDomain: "oprosnik-app.firebaseapp.com",
  projectId: "oprosnik-app",
  storageBucket: "oprosnik-app.firebasestorage.app",
  messagingSenderId: "1062081910335",
  appId: "1:1062081910335:web:d0e696a3d6e741c9720a8a",
  measurementId: "G-EHX71KZ0DY"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Firebase services
const analytics = getAnalytics(app);
const db = getFirestore(app);
const auth = getAuth(app);
const storage = getStorage(app);

export { app, analytics, db, auth, storage };