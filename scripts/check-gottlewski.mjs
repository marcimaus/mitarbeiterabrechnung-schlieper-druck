import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, query, where, orderBy, limit } from 'firebase/firestore';
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

const mitarbeiterId = 'IE73KdKE3a9hAda8DF35';

const snap = await getDocs(
  query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId),
    orderBy('startTime', 'desc'),
    limit(5)
  )
);
console.log(`Gefundene Arbeitszeiten für Gottlewski: ${snap.docs.length} (Vorschau, neueste zuerst)`);
for (const d of snap.docs) {
  const data = d.data();
  console.log(` - ${new Date(data.startTime).toISOString()} → ${new Date(data.endTime).toISOString()} | typ=${data.typ} | status=${data.status}`);
}

// Auch nach Periode 2026-05 filtern (was die App aktuell sieht)
const von = new Date(2026, 4, 1).getTime();
const bis = new Date(2026, 5, 1).getTime();
const periodeSnap = await getDocs(
  query(
    collection(db, 'arbeitszeiten'),
    where('mitarbeiterId', '==', mitarbeiterId),
    where('startTime', '>=', von),
    where('startTime', '<', bis),
  )
);
console.log(`\nIn Mai 2026: ${periodeSnap.docs.length} Einträge`);

// Gesamtanzahl in 2024, 2025, 2026
for (const jahr of [2020, 2021, 2022, 2023, 2024, 2025, 2026]) {
  const v = new Date(jahr, 0, 1).getTime();
  const b = new Date(jahr + 1, 0, 1).getTime();
  const s = await getDocs(
    query(
      collection(db, 'arbeitszeiten'),
      where('mitarbeiterId', '==', mitarbeiterId),
      where('startTime', '>=', v),
      where('startTime', '<', b),
    )
  );
  console.log(`  ${jahr}: ${s.docs.length} Einträge`);
}

process.exit(0);
