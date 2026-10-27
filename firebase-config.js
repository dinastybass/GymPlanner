import { initializeApp } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/13.0.0/firebase-auth.js";

// Configuración de PRODUCCIÓN (gymapp-d8ae7)
const firebaseConfigProd = {
    apiKey: "AIzaSyAuItH8VNFpyCxpFaN27-db-aoWiQg1FMk",
    authDomain: "gymapp-d8ae7.firebaseapp.com",
    projectId: "gymapp-d8ae7",
    storageBucket: "gymapp-d8ae7.firebasestorage.app",
    messagingSenderId: "598913655005",
    appId: "1:598913655005:web:a4b1938a4941a81375fb34",
    measurementId: "G-B4195XMGV3"
};

// Configuración de DESARROLLO (gymplanner-dev-574ea)
const firebaseConfigDev = {
    apiKey: "AIzaSyDzsT65yyjzKXoQe-1mzrT5CEWt2HPfF_U",
    authDomain: "gymplanner-dev-574ea.firebaseapp.com",
    projectId: "gymplanner-dev-574ea",
    storageBucket: "gymplanner-dev-574ea.firebasestorage.app",
    messagingSenderId: "720938066838",
    appId: "1:720938066838:web:f2cf176f243cc66af533b7"
};

// Detectar entorno automáticamente por la URL del navegador
const hostname = window.location.hostname;
const isDev =
    hostname === "gymplanner-dev-574ea.web.app" ||
    hostname === "gymplanner-dev-574ea.firebaseapp.com" ||
    hostname === "localhost" ||
    hostname === "127.0.0.1";

const firebaseConfig = isDev ? firebaseConfigDev : firebaseConfigProd;

console.log(`🔥 Firebase [${isDev ? "DEV" : "PROD"}] -> ${firebaseConfig.projectId}`);

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);

export { app, db, auth, isDev };
