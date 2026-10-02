/**
 * Schreibt die externen Links (Google-Drive-Ordner je Ausgabe) in die
 * Statistik-Zellen. Quelle: scripts/statistik-links.json ({ "JJJJ-KW": url }).
 *
 * Setzt den Link auf jede VORHANDENE Werte-Zelle (wert != null) beider
 * Tabellen (seiten + beilagen) der passenden KW/Jahr. Idempotent.
 *
 * Aufruf: node scripts/import-statistik-links.mjs
 */

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, doc, setDoc } from 'firebase/firestore';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { config as dotenvConfig } from 'dotenv';

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(__dirname, '..');
dotenvConfig({ path: join(projectRoot, '.env') });

const app = initializeApp({
  apiKey: process.env.VITE_FIREBASE_API_KEY,
  authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.VITE_FIREBASE_APP_ID,
});
const db = getFirestore(app);

const links = JSON.parse(readFileSync(join(__dirname, 'statistik-links.json'), 'utf8'));

async function main() {
  console.log('Projekt:', process.env.VITE_FIREBASE_PROJECT_ID);
  console.log('Links insgesamt:', Object.keys(links).length);

  const snap = await getDocs(collection(db, 'statistik'));
  let gesetzt = 0;
  let docsAktualisiert = 0;

  for (const d of snap.docs) {
    const data = d.data();
    const { typ, jahr, zellen } = data;
    if (!zellen) continue;
    const zellenUpdate = {};
    for (const [kwStr, zelle] of Object.entries(zellen)) {
      if (!zelle || zelle.wert == null) continue; // nur vorhandene Werte
      const url = links[`${jahr}-${Number(kwStr)}`];
      if (!url) continue;
      if (zelle.link === url) continue; // schon gesetzt
      zellenUpdate[kwStr] = { link: url };
      gesetzt++;
    }
    if (Object.keys(zellenUpdate).length > 0) {
      await setDoc(
        doc(db, 'statistik', d.id),
        { typ, jahr, aktualisiertAm: Date.now(), zellen: zellenUpdate },
        { merge: true },
      );
      docsAktualisiert++;
      console.log(`• ${d.id}: ${Object.keys(zellenUpdate).length} Links gesetzt`);
    }
  }

  console.log(`Fertig. ${gesetzt} Links in ${docsAktualisiert} Dokumenten.`);
  process.exit(0);
}

main().catch((e) => { console.error('Fehler:', e); process.exit(1); });
