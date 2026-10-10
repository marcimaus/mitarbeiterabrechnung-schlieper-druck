import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, writeBatch } from 'firebase/firestore';
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

const snap = await getDocs(collection(db, 'arbeitzeiten'));
console.log(`Einträge in falscher Collection 'arbeitzeiten': ${snap.docs.length}`);

let batch = writeBatch(db);
let i = 0;
for (const d of snap.docs) {
  batch.delete(d.ref);
  i++;
  if (i % 499 === 0) { await batch.commit(); batch = writeBatch(db); }
}
if (i > 0 && i % 499 !== 0) await batch.commit();

console.log(`Gelöscht: ${i}`);
process.exit(0);
