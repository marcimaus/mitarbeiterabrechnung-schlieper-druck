import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where } from 'firebase/firestore';
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

const suchName = process.argv[2];
const mitarbeiterSnap = await getDocs(collection(db, 'mitarbeiter'));
const treffer = mitarbeiterSnap.docs.filter((d) =>
  (d.data().name ?? '').toLowerCase().includes(suchName.toLowerCase())
);
for (const t of treffer) {
  const maId = t.id;
  const maName = t.data().name;
  const azSnap = await getDocs(
    query(collection(db, 'arbeitszeiten'), where('mitarbeiterId', '==', maId))
  );
  console.log(`${maName} (${maId}): ${azSnap.docs.length} Arbeitszeiten`);
  for (const jahr of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
    const v = new Date(jahr, 0, 1).getTime();
    const b = new Date(jahr + 1, 0, 1).getTime();
    const s = await getDocs(
      query(
        collection(db, 'arbeitszeiten'),
        where('mitarbeiterId', '==', maId),
        where('startTime', '>=', v),
        where('startTime', '<', b),
      )
    );
    if (s.docs.length > 0) console.log(`  ${jahr}: ${s.docs.length}`);
  }
}
process.exit(0);
