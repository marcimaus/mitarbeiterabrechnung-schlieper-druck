import { initializeApp } from 'firebase/app';
import { getFirestore, doc, getDoc, deleteDoc } from 'firebase/firestore';
import { config } from 'dotenv';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const id = process.argv[2];
if (!id) { console.error('Bitte Fahrt-ID übergeben.'); process.exit(1); }

const ref = doc(db, 'fahrten', id);
const snap = await getDoc(ref);
if (!snap.exists()) {
  console.log(`Fahrt ${id} existiert nicht (mehr).`);
  process.exit(0);
}
console.log('Lösche:', JSON.stringify(snap.data()));
await deleteDoc(ref);
console.log(`Fahrt ${id} gelöscht.`);
process.exit(0);
