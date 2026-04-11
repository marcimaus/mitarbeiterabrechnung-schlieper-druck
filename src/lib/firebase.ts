import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  enableIndexedDbPersistence,
  connectFirestoreEmulator,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);

// Offline-Persistenz aktivieren (IndexedDB)
enableIndexedDbPersistence(db).catch((err) => {
  if (err.code === 'failed-precondition') {
    // Mehrere Tabs gleichzeitig geöffnet – Persistenz nur in einem Tab möglich
    console.warn('Firestore-Persistenz: Mehrere Tabs aktiv, Offline-Support eingeschränkt.');
  } else if (err.code === 'unimplemented') {
    // Browser unterstützt kein IndexedDB
    console.warn('Firestore-Persistenz: Browser unterstützt kein IndexedDB.');
  }
});

// Emulator (nur lokal, falls VITE_USE_EMULATOR=true)
if (import.meta.env.VITE_USE_EMULATOR === 'true') {
  connectFirestoreEmulator(db, 'localhost', 8080);
}

export default app;
