import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs } from 'firebase/firestore';
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

const maSnap = await getDocs(collection(db, 'mitarbeiter'));
const maMap = new Map(maSnap.docs.map((d) => [d.id, d.data()]));

const fahrtenSnap = await getDocs(collection(db, 'fahrten'));
console.log(`Gesamt Fahrten: ${fahrtenSnap.docs.length}`);

const offen = fahrtenSnap.docs.filter((d) => !d.data().abrechnungsperiodeId);
console.log(`Ohne Periodenzuordnung (Abrechnung warnt vor diesen): ${offen.length}\n`);

for (const d of offen) {
  const f = d.data();
  const ma = maMap.get(f.mitarbeiterId);
  const status = !f.mitarbeiterId
    ? 'KEINE mitarbeiterId'
    : !ma
      ? 'MA GELÖSCHT / nicht gefunden'
      : ma.fahrtkostenerstattung
        ? 'MA ok, Flag gesetzt'
        : 'MA ok, ABER kein Fahrtkosten-Flag';
  console.log(`- id=${d.id}`);
  console.log(`    datum=${f.datum}  ziel=${f.ziel ?? '—'}  km=${f.streckKm}`);
  console.log(`    mitarbeiterId=${f.mitarbeiterId ?? '(leer)'}  name=${ma?.name ?? '?'}`);
  console.log(`    -> ${status}`);
}
process.exit(0);
