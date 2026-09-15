// cleanup-kw.mjs — löscht Duplikat-Ausgaben für KW 15, 16, 17
// Ausführen: node scripts/cleanup-kw.mjs

import { initializeApp } from 'firebase/app';
import { getFirestore, collection, getDocs, deleteDoc, doc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: 'AIzaSyBGbMres7hAZLIaku_IAC4UAYKZyPNthNg',
  authDomain: 'mitarbeiterabrechnung-sdruck.firebaseapp.com',
  projectId: 'mitarbeiterabrechnung-sdruck',
  storageBucket: 'mitarbeiterabrechnung-sdruck.firebasestorage.app',
  messagingSenderId: '972533708202',
  appId: '1:972533708202:web:f180967ef9066e25f267d3',
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const TARGET_KWS = [15, 16, 17];

async function cleanup() {
  console.log('Lade alle Ausgaben...');
  const snap = await getDocs(collection(db, 'ausgaben'));
  const alle = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

  console.log(`Gefunden: ${alle.length} Ausgaben gesamt\n`);

  // Für jede KW: Duplikate finden
  for (const kw of TARGET_KWS) {
    const treffer = alle
      .filter((a) => a.kw === kw)
      .sort((a, b) => a.erstelltAm - b.erstelltAm); // ältester zuerst

    if (treffer.length === 0) {
      console.log(`KW ${kw}: keine Einträge gefunden`);
      continue;
    }

    if (treffer.length === 1) {
      console.log(`KW ${kw}: nur 1 Eintrag — OK, nichts zu tun`);
      continue;
    }

    // Den ersten (ältesten) behalten, alle weiteren löschen
    const [behalten, ...loeschen] = treffer;
    console.log(`KW ${kw}: ${treffer.length} Einträge — behalte id=${behalten.id} (${new Date(behalten.erstelltAm).toISOString()})`);

    for (const a of loeschen) {
      console.log(`  → lösche id=${a.id} (${new Date(a.erstelltAm).toISOString()})`);
      await deleteDoc(doc(db, 'ausgaben', a.id));
    }
  }

  console.log('\nFertig.');
  process.exit(0);
}

cleanup().catch((err) => {
  console.error('Fehler:', err);
  process.exit(1);
});
