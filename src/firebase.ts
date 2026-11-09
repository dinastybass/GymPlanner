import { initializeApp, getApps } from 'firebase/app';
import { getFirestore, initializeFirestore, Firestore, setLogLevel } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

const firebaseConfigProd = {
  apiKey: "AIzaSyAuItH8VNFpyCxpFaN27-db-aoWiQg1FMk",
  authDomain: "gymapp-d8ae7.firebaseapp.com",
  projectId: "gymapp-d8ae7",
  storageBucket: "gymapp-d8ae7.firebasestorage.app",
  messagingSenderId: "598913655005",
  appId: "1:598913655005:web:a4b1938a4941a81375fb34",
  measurementId: "G-B4195XMGV3"
};

const firebaseConfigDev = {
  apiKey: "AIzaSyDzsT65yyjzKXoQe-1mzrT5CEWt2HPfF_U",
  authDomain: "gymplanner-dev-574ea.firebaseapp.com",
  projectId: "gymplanner-dev-574ea",
  storageBucket: "gymplanner-dev-574ea.firebasestorage.app",
  messagingSenderId: "720938066838",
  appId: "1:720938066838:web:f2cf176f243cc66af533b7"
};

const hostname = typeof window !== 'undefined' ? window.location.hostname : '';
const isDev =
  hostname === "gymplanner-dev-574ea.web.app" ||
  hostname === "gymplanner-dev-574ea.firebaseapp.com";

const activeConfig = isDev ? firebaseConfigDev : firebaseConfigProd;

console.log(`🔥 Firebase [${isDev ? "DEV" : "PROD"}] -> ${activeConfig.projectId}`);

const app = getApps().length > 0 ? getApps()[0] : initializeApp(activeConfig);

// Evitar falsos errores de conexión WebChannel en entornos con proxy / iframe
setLogLevel('silent');

let db: Firestore;
try {
  db = initializeFirestore(app, {
    experimentalAutoDetectLongPolling: true,
  });
} catch {
  db = getFirestore(app);
}

const auth = getAuth(app);

const isProduction = !isDev;

export { app, db, auth, isDev, isProduction };

