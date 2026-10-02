// Löscht Vorarbeit-Test-Arbeitszeit in KW 20 für MA „test neu minderjährig".
// Ausführen: node scripts/delete-test-vorarbeit-kw20.mjs [--dry]

import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  collection,
  getDocs,
  query,
  where,
  deleteDoc,
  doc,
} from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBGbMres7hAZLIaku_IAC4UAYKZyPNthNg',
  authDomain: 'mitarbeiterabrechnung-sdruck.firebaseapp.com',
  projectId: 'mitarbeiterabrechnung-sdruck',
  storageBucket: 'mitarbeiterabrechnung-sdruck.firebasestorage.app',
  messagingSenderId: '972533708202',
  appId: '1:972533708202:web:f180967ef9066e25f267d3',
};

const DRY = process.argv.includes('--dry');
const TARGET_NAME = 'test neu minderjährig';
const TARGET_KW = 20;

function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
function getISOYear(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  return d.getUTCFullYear();
}

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function main() {
  const maSnap = await getDocs(collection(db, 'mitarbeiter'));
  const treffer = maSnap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((m) => (m.name ?? '').trim().toLowerCase() === TARGET_NAME.toLowerCase());

  if (treffer.length === 0) {
    console.log(`Kein Mitarbeiter „${TARGET_NAME}" gefunden.`);
    process.exit(0);
  }
  if (treffer.length > 1) {
    console.log(`Mehrere Mitarbeiter „${TARGET_NAME}" gefunden:`);
    for (const m of treffer) console.log(`  ${m.id}  nummer=${m.nummer}`);
    process.exit(1);
  }
  const ma = treffer[0];
  console.log(`Mitarbeiter: ${ma.name} (id=${ma.id}, nummer=${ma.nummer})`);

  const azSnap = await getDocs(
    query(
      collection(db, 'arbeitszeiten'),
      where('mitarbeiterId', '==', ma.id),
      where('typ', '==', 'vorarbeit'),
    ),
  );
  const alle = azSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const kw20 = alle.filter((a) => getISOWeek(new Date(a.startTime)) === TARGET_KW);

  console.log(`\n${alle.length} Vorarbeit-Sessions gesamt, ${kw20.length} in KW ${TARGET_KW}.`);
  for (const a of kw20) {
    const d = new Date(a.startTime);
    console.log(
      `  ${a.id}  ${d.toISOString()}  KW${getISOWeek(d)}/${getISOYear(d)}  status=${a.status}  ausgabeId=${a.ausgabeId ?? '—'}`,
    );
  }

  if (kw20.length === 0) {
    console.log('\nNichts zu löschen.');
    process.exit(0);
  }

  if (DRY) {
    console.log('\n[DRY] Nichts gelöscht.');
    process.exit(0);
  }

  for (const a of kw20) {
    await deleteDoc(doc(db, 'arbeitszeiten', a.id));
    console.log(`gelöscht: ${a.id}`);
  }
  console.log(`\nFertig — ${kw20.length} Datensatz/-sätze gelöscht.`);
  process.exit(0);
}

main().catch((err) => {
  console.error('Fehler:', err);
  process.exit(1);
});
