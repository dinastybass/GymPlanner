import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyAuItH8VNFpyCxpFaN27-db-aoWiQg1FMk",
    authDomain: "gymapp-d8ae7.firebaseapp.com",
    projectId: "gymapp-d8ae7",
    storageBucket: "gymapp-d8ae7.firebasestorage.app",
    messagingSenderId: "598913655005",
    appId: "1:598913655005:web:a4b1938a4941a81375fb34",
    measurementId: "G-B4195XMGV3"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth };
